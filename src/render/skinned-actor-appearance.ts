import {
  AnimationGroup,
  LoadAssetContainerAsync,
  TransformNode,
} from "@babylonjs/core";
import { RegisterSceneLoaderPlugin } from "@babylonjs/core/Loading/sceneLoader.js";
import { GLTFFileLoaderMetadata } from "@babylonjs/loaders/glTF/glTFFileLoader.metadata.js";

import { isId, isRecord } from "../simulation/validation";
import { ACTOR_TRIGGERS } from "./actor";
import { createGaitState, stepGait } from "./actor-gait";
import { isRgb } from "./color";

import type { AssetContainer, Scene } from "@babylonjs/core";
import type { ActorAppearance, ActorInstance, ActorTrigger } from "./actor";
import type { Rgb } from "./color";

/**
 * Clips by animation role. A trigger's clip, such as `attack`, plays once
 * each time the trigger fires, layered as its difference from its first frame.
 */
type ClipRoles<T> = {
  idle: T;
  locomotion: T;
  turn?: { left: T; right: T };
  /** Plays once on the actor's remains and holds its last frame. */
  death?: T;
} & Partial<Record<ActorTrigger, T>>;

/** Renderer-owned GLB and animation configuration for one actor definition. */
export type ActorGraphics = {
  url: string;
  minimapColor?: Rgb;
  bounds: { radius: number; height: number };
  /** Clip names in the GLB. */
  clips: ClipRoles<string>;
  /** Ground units traveled during one locomotion clip cycle. */
  cycleDistance: number;
};

// Actor assets use core glTF 2.0. Register more extensions here only when an
// authored asset requires them, so unrelated formats stay out of startup.
RegisterSceneLoaderPlugin({
  ...GLTFFileLoaderMetadata,
  createPlugin: async (options) => {
    const [{ GLTFFileLoader, RegisterGLTF2Loader }, { RegisterInstancedMesh }] =
      await Promise.all([
        import("@babylonjs/loaders/glTF/2.0/glTFLoader.pure.js"),
        import("@babylonjs/core/Meshes/instancedMesh.pure.js"),
      ]);
    RegisterInstancedMesh();
    RegisterGLTF2Loader();
    return new GLTFFileLoader(options[GLTFFileLoaderMetadata.name]);
  },
});

type ClipGroups = ClipRoles<AnimationGroup>;

/** Every clip a model uses, in role order. */
function clipList<T>(clips: ClipRoles<T>): T[] {
  return [
    clips.idle,
    clips.locomotion,
    ...(clips.turn ? [clips.turn.left, clips.turn.right] : []),
    ...ACTOR_TRIGGERS.flatMap((trigger) => clips[trigger] ?? []),
    ...(clips.death ? [clips.death] : []),
  ];
}

export type SkinnedActorOptions = {
  /** Skips triggered clips and shows death clips' last frame at once. */
  reducedMotion?: () => boolean;
};

/**
 * Loads a skinned model and its named clips from one GLB. Rejects a model
 * that lacks a skin or a clip, or whose clips animate nodes outside it.
 */
export async function loadSkinnedActorAppearance(
  scene: Scene,
  graphics: ActorGraphics,
  { reducedMotion = () => false }: SkinnedActorOptions = {},
): Promise<ActorAppearance> {
  validateActorGraphics(graphics);
  const assets = await LoadAssetContainerAsync(graphics.url, scene);
  let clips: ClipGroups;
  try {
    clips = prepareClips(assets, graphics);
  } catch (error) {
    assets.dispose();
    throw error;
  }
  return {
    bounds: graphics.bounds,
    minimapColor: graphics.minimapColor,
    instantiate: (name, seed) =>
      instantiate(
        assets,
        clips,
        graphics.cycleDistance,
        reducedMotion,
        name,
        seed,
      ),
    dispose: () => assets.dispose(),
  };
}

export function validateActorGraphics(graphics: ActorGraphics): void {
  const { url, bounds, cycleDistance, minimapColor, clips } = graphics ?? {};
  if (
    !isId(url) ||
    !isRecord(clips) ||
    !isId(clips.idle) ||
    !isId(clips.locomotion) ||
    (clips.turn !== undefined &&
      !(isId(clips.turn?.left) && isId(clips.turn?.right))) ||
    [...ACTOR_TRIGGERS.map((trigger) => clips[trigger]), clips.death].some(
      (name) => name !== undefined && !isId(name),
    )
  )
    throw new RangeError(`Actor model ${url} needs a URL and named clips`);
  if (!(cycleDistance > 0 && Number.isFinite(cycleDistance))) {
    throw new RangeError(`Actor model ${url} needs a positive cycle distance`);
  }
  if (
    !bounds ||
    !Number.isFinite(bounds.radius) ||
    !Number.isFinite(bounds.height) ||
    bounds.radius <= 0 ||
    bounds.height <= 0
  ) {
    throw new RangeError(`Actor model ${url} needs positive finite bounds`);
  }
  if (minimapColor !== undefined && !isRgb(minimapColor)) {
    throw new RangeError(`Actor model ${url} needs a valid minimap color`);
  }
}

function prepareClips(
  assets: AssetContainer,
  { url, clips }: ActorGraphics,
): ClipGroups {
  const invalid = (problem: string) =>
    new Error(`Actor model ${url} ${problem}`);
  if (assets.skeletons.length === 0) {
    throw invalid("has no skin");
  }
  const clipNames = clipList(clips);
  if (new Set(clipNames).size !== clipNames.length) {
    throw invalid("uses one clip for multiple animation roles");
  }
  const owned = new Set<unknown>([...assets.transformNodes, ...assets.meshes]);
  for (const manager of assets.morphTargetManagers) {
    for (let index = 0; index < manager.numTargets; index++) {
      owned.add(manager.getTarget(index));
    }
  }
  const group = (name: string) => {
    const found = assets.animationGroups.find((each) => each.name === name);
    if (!found) {
      throw invalid(`is missing clip ${name}`);
    }
    // Instances retarget clips by clone, so an outside target would animate
    // the shared original.
    for (const { target } of found.targetedAnimations) {
      if (!owned.has(target)) {
        throw invalid(`clip ${name} animates ${target?.name ?? "a target"}`);
      }
    }
    const rates = found.targetedAnimations.map(
      ({ animation }) => animation.framePerSecond,
    );
    if (
      !Number.isFinite(found.from) ||
      !Number.isFinite(found.to) ||
      rates.length === 0 ||
      rates.some(
        (rate) => !Number.isFinite(rate) || rate <= 0 || rate !== rates[0],
      )
    )
      throw invalid(
        `clip ${name} needs finite frames and a shared positive frame rate`,
      );
    return found;
  };
  const timed = (name: string) => {
    const found = group(name);
    if (!(found.to > found.from))
      throw invalid(`clip ${name} needs more than one frame`);
    return found;
  };
  // A layered clip is its difference from the first frame, added on top.
  const layered = (name: string) => {
    const found = timed(name);
    return AnimationGroup.MakeAnimationAdditive(found, {
      referenceFrame: found.from,
    });
  };
  for (const each of assets.animationGroups) each.stop();
  return {
    idle: group(clips.idle),
    locomotion: timed(clips.locomotion),
    turn: clips.turn && {
      left: layered(clips.turn.left),
      right: layered(clips.turn.right),
    },
    death: clips.death === undefined ? undefined : timed(clips.death),
    ...Object.fromEntries(
      ACTOR_TRIGGERS.flatMap((trigger) => {
        const name = clips[trigger];
        return name === undefined ? [] : [[trigger, layered(name)]];
      }),
    ),
  };
}

function instantiate(
  assets: AssetContainer,
  clips: ClipGroups,
  cycleDistance: number,
  reducedMotion: () => boolean,
  name: string,
  seed: number,
): ActorInstance {
  const used = clipList(clips);
  // Clones skeletons linked to the cloned joints and retargets the clips.
  const entries = assets.instantiateModelsToScene(
    (source) => `${name}-${source}`,
    false,
    {
      doNotInstantiate: true,
      predicate: (entity) =>
        !(entity instanceof AnimationGroup) || used.includes(entity),
    },
  );
  const root = new TransformNode(name, assets.scene);
  for (const node of entries.rootNodes) {
    node.parent = root;
  }
  const sources = assets.animationGroups.filter((each) => used.includes(each));
  const clone = (source: AnimationGroup) =>
    entries.animationGroups[sources.indexOf(source)];
  const idle = clone(clips.idle);
  const locomotion = clone(clips.locomotion);
  const turn = clips.turn && {
    left: clone(clips.turn.left),
    right: clone(clips.turn.right),
  };
  const triggered = new Map(
    ACTOR_TRIGGERS.flatMap((trigger) => {
      const group = clips[trigger];
      return group ? [[trigger, clone(group)] as const] : [];
    }),
  );
  const death = clips.death && clone(clips.death);

  idle.start(true);
  idle.goToFrame(idle.from + seed * (idle.to - idle.from));
  idle.weight = 1;
  // Paused clips only blend on frames that seek them with their weight.
  const posed = used.map(clone).filter((group) => group !== idle);
  for (const group of posed) {
    group.start(true);
    group.pause();
    group.weight = 0;
  }
  const seek = (group: AnimationGroup, progress: number) => {
    if (group.weight > 0) {
      group.goToFrame(group.from + progress * (group.to - group.from), true);
    }
  };

  const gait = createGaitState();
  /** Seconds into each triggered clip that is playing. */
  const playing = new Map<AnimationGroup, number>();
  let deathProgress = 0;
  return {
    root,
    animate: (motion) => {
      stepGait(gait, motion, cycleDistance);
      idle.weight = 1 - gait.locomotion;
      locomotion.weight = gait.locomotion;
      seek(locomotion, gait.cycle);
      if (turn) {
        turn.left.weight = Math.max(0, -gait.lean);
        turn.right.weight = Math.max(0, gait.lean);
        seek(turn.left, 1);
        seek(turn.right, 1);
      }
      for (const [group, seconds] of playing) {
        if (reducedMotion()) {
          group.weight = 0;
          playing.delete(group);
          continue;
        }
        const elapsed = seconds + motion.seconds;
        const progress = elapsed / clipSeconds(group);
        group.weight = progress < 1 ? 1 : 0;
        if (progress < 1) {
          playing.set(group, elapsed);
          seek(group, progress);
        } else playing.delete(group);
      }
    },
    play: (trigger) => {
      const group = triggered.get(trigger);
      // A repeated trigger restarts its clip.
      if (group && !reducedMotion()) {
        playing.set(group, 0);
        group.weight = 1;
        seek(group, 0);
      }
    },
    die:
      death &&
      ((seconds) => {
        playing.clear();
        for (const group of [idle, ...posed]) {
          group.pause();
          group.weight = 0;
        }
        death.weight = 1;
        // A preference change must not stand fallen remains back up.
        deathProgress = Math.max(
          deathProgress,
          reducedMotion() ? 1 : Math.min(seconds / clipSeconds(death), 1),
        );
        seek(death, deathProgress);
      }),
    freeze: () => {
      for (const group of [idle, ...posed]) group.pause();
    },
    dispose: () => {
      entries.dispose();
      root.dispose();
    },
  };
}

/** A clip's length at its shared frame rate, which loading checks. */
function clipSeconds(group: AnimationGroup): number {
  const fps = group.targetedAnimations[0]!.animation.framePerSecond;
  return (group.to - group.from) / fps;
}
