import { AnimationGroup, VertexBuffer } from "@babylonjs/core";

import { isId, isPositive, isRecord } from "../simulation/validation";
import { ACTOR_TRIGGERS } from "./actor";
import { createGaitState, stepGait } from "./actor-gait";
import { isRgb } from "./color";
import {
  clipChannels,
  clipSeconds,
  findClip,
  findTimedClip,
  instantiateContainer,
  loadContainer,
} from "./glb-model";

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
  work?: T;
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
  rig?: "skeletal" | "rigid";
  scale?: number;
};

type ClipGroups = ClipRoles<AnimationGroup>;

/** Every clip a model uses, in role order. */
function clipList<T>(clips: ClipRoles<T>): T[] {
  return [
    clips.idle,
    clips.locomotion,
    ...(clips.turn ? [clips.turn.left, clips.turn.right] : []),
    ...ACTOR_TRIGGERS.flatMap((trigger) => clips[trigger] ?? []),
    ...(clips.death ? [clips.death] : []),
    ...(clips.work ? [clips.work] : []),
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
  const { assets, prepared: clips } = await loadContainer(
    scene,
    graphics.url,
    (assets) => prepareClips(assets, graphics),
  );
  return {
    bounds: graphics.bounds,
    minimapColor: graphics.minimapColor,
    instantiate: (name, seed) => {
      const instance = instantiate(
        assets,
        clips,
        graphics.cycleDistance,
        reducedMotion,
        name,
        seed,
      );
      instance.root.scaling.setAll(graphics.scale ?? 1);
      return instance;
    },
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
    Object.keys(clips).some(
      (role) =>
        ![
          "idle",
          "locomotion",
          "turn",
          "death",
          "work",
          ...ACTOR_TRIGGERS,
        ].includes(role),
    ) ||
    (clips.turn !== undefined &&
      !(isId(clips.turn?.left) && isId(clips.turn?.right))) ||
    [
      ...ACTOR_TRIGGERS.map((trigger) => clips[trigger]),
      clips.death,
      clips.work,
    ].some((name) => name !== undefined && !isId(name))
  )
    throw new RangeError(`Actor model ${url} needs a URL and named clips`);
  const names = clipList(clips);
  if (new Set(names).size !== names.length)
    throw new RangeError(
      `Actor model ${url} uses one clip for multiple animation roles`,
    );
  if (
    graphics.rig !== undefined &&
    !["skeletal", "rigid"].includes(graphics.rig)
  )
    throw new RangeError(`Actor model ${url} needs a valid rig type`);
  if (graphics.scale !== undefined && !isPositive(graphics.scale))
    throw new RangeError(`Actor model ${url} needs a positive model scale`);
  if (!isPositive(cycleDistance)) {
    throw new RangeError(`Actor model ${url} needs a positive cycle distance`);
  }
  if (!bounds || !isPositive(bounds.radius) || !isPositive(bounds.height)) {
    throw new RangeError(`Actor model ${url} needs positive finite bounds`);
  }
  if (minimapColor !== undefined && !isRgb(minimapColor)) {
    throw new RangeError(`Actor model ${url} needs a valid minimap color`);
  }
}

function prepareClips(
  assets: AssetContainer,
  { url, clips, rig }: ActorGraphics,
): ClipGroups {
  const invalid = (problem: string) =>
    new Error(`Actor model ${url} ${problem}`);
  if (!assets.meshes.some((mesh) => mesh.getTotalVertices() > 0))
    throw invalid("has no geometry");
  if (
    rig !== "rigid" &&
    !assets.meshes.some(
      (mesh) =>
        mesh.getTotalVertices() > 0 &&
        mesh.skeleton &&
        assets.skeletons.includes(mesh.skeleton) &&
        mesh.isVerticesDataPresent(VertexBuffer.MatricesIndicesKind) &&
        mesh.isVerticesDataPresent(VertexBuffer.MatricesWeightsKind),
    )
  ) {
    throw invalid("has no skin");
  }
  const group = (name: string) => findClip(assets, name, invalid);
  const timed = (name: string) => findTimedClip(assets, name, invalid);
  // A layered clip is its difference from the first frame, added on top.
  const layered = (name: string) => {
    const found = timed(name);
    return AnimationGroup.MakeAnimationAdditive(found, {
      referenceFrame: found.from,
    });
  };
  const idle = group(clips.idle);
  const locomotion = timed(clips.locomotion);
  const idleChannels = clipChannels(idle);
  const requirePose = (clip: AnimationGroup, exact: boolean) => {
    const keyed = clipChannels(clip);
    if (
      (exact && keyed.size !== idleChannels.size) ||
      [...idleChannels.keys()].some((channel) => !keyed.has(channel))
    )
      throw invalid(
        `clip ${clip.name} must key ${exact ? "the same" : "all idle"} pose channels`,
      );
  };
  requirePose(locomotion, true);
  if (clips.work) requirePose(timed(clips.work), true);
  if (clips.death) requirePose(timed(clips.death), false);
  for (const each of assets.animationGroups) each.stop();
  return {
    idle,
    locomotion,
    turn: clips.turn && {
      left: layered(clips.turn.left),
      right: layered(clips.turn.right),
    },
    death: clips.death === undefined ? undefined : timed(clips.death),
    work: clips.work === undefined ? undefined : timed(clips.work),
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
  const { root, entries, dispose } = instantiateContainer(assets, name, used);
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
  const work = clips.work && clone(clips.work);
  const indicators = (suffix: string) =>
    root.getChildMeshes().filter((node) => node.name.endsWith(suffix));
  const idleIndicators = indicators("idle-signal");
  const workIndicators = indicators("working-signal");
  for (const node of workIndicators) node.setEnabled(false);

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
  let working = false;
  let workSeconds = 0;
  let still = false;
  return {
    root,
    setWorking:
      work &&
      ((next) => {
        working = next;
        for (const node of idleIndicators) node.setEnabled(!next);
        for (const node of workIndicators) node.setEnabled(next);
      }),
    animate: (motion) => {
      stepGait(gait, motion, cycleDistance);
      const reduced = reducedMotion();
      if (reduced) {
        idle.pause();
        idle.goToFrame(idle.from);
      } else if (still) idle.restart();
      still = reduced;
      idle.weight = working ? 0 : 1 - gait.locomotion;
      locomotion.weight = working ? 0 : gait.locomotion;
      seek(locomotion, gait.cycle);
      if (work) {
        workSeconds += motion.seconds;
        work.weight = working ? 1 : 0;
        seek(work, reduced ? 0 : (workSeconds / clipSeconds(work)) % 1);
      }
      if (turn) {
        turn.left.weight = Math.max(0, -gait.lean);
        turn.right.weight = Math.max(0, gait.lean);
        seek(turn.left, 1);
        seek(turn.right, 1);
      }
      for (const [group, seconds] of playing) {
        if (reduced) {
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
        for (const node of [...idleIndicators, ...workIndicators])
          node.setEnabled(false);
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
    dispose,
  };
}
