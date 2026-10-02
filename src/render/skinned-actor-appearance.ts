import {
  AnimationGroup,
  LoadAssetContainerAsync,
  TransformNode,
} from "@babylonjs/core";
import { RegisterSceneLoaderPlugin } from "@babylonjs/core/Loading/sceneLoader.js";
import { GLTFFileLoaderMetadata } from "@babylonjs/loaders/glTF/glTFFileLoader.metadata.js";

import { createGaitState, stepGait } from "./actor-gait";
import { isRgb } from "./color";

import type { AssetContainer, Scene } from "@babylonjs/core";
import type { ActorAppearance, ActorInstance } from "./actor";
import type { Rgb } from "./color";

/** Renderer-owned GLB and animation configuration for one actor definition. */
export type ActorGraphics = {
  url: string;
  minimapColor?: Rgb;
  bounds: { radius: number; height: number };
  clips: {
    idle: string;
    locomotion: string;
    turn?: { left: string; right: string };
  };
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

type ClipGroups = {
  idle: AnimationGroup;
  locomotion: AnimationGroup;
  turn?: { left: AnimationGroup; right: AnimationGroup };
};

/**
 * Loads a skinned model and its named clips from one GLB. Rejects a model
 * that lacks a skin or a clip, or whose clips animate nodes outside it.
 */
export async function loadSkinnedActorAppearance(
  scene: Scene,
  graphics: ActorGraphics,
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
      instantiate(assets, clips, graphics.cycleDistance, name, seed),
    dispose: () => assets.dispose(),
  };
}

export function validateActorGraphics({
  url,
  bounds,
  cycleDistance,
  minimapColor,
}: ActorGraphics): void {
  if (!(cycleDistance > 0 && Number.isFinite(cycleDistance))) {
    throw new RangeError(`Actor model ${url} needs a positive cycle distance`);
  }
  if (
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
  const clipNames = [
    clips.idle,
    clips.locomotion,
    ...(clips.turn ? [clips.turn.left, clips.turn.right] : []),
  ];
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
    return found;
  };
  const lean = (name: string) => {
    const found = group(name);
    if (!(found.to > found.from)) {
      throw invalid(`turn clip ${name} needs a neutral and a leaning frame`);
    }
    // The lean is its difference from the first frame, layered on top.
    return AnimationGroup.MakeAnimationAdditive(found, {
      referenceFrame: found.from,
    });
  };
  for (const each of assets.animationGroups) each.stop();
  return {
    idle: group(clips.idle),
    locomotion: group(clips.locomotion),
    turn: clips.turn && {
      left: lean(clips.turn.left),
      right: lean(clips.turn.right),
    },
  };
}

function instantiate(
  assets: AssetContainer,
  clips: ClipGroups,
  cycleDistance: number,
  name: string,
  seed: number,
): ActorInstance {
  const used = [
    clips.idle,
    clips.locomotion,
    ...(clips.turn ? [clips.turn.left, clips.turn.right] : []),
  ];
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

  idle.start(true);
  idle.goToFrame(idle.from + seed * (idle.to - idle.from));
  idle.weight = 1;
  // Paused clips only blend on frames that seek them with their weight.
  const posed = [locomotion, ...(turn ? [turn.left, turn.right] : [])];
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
    },
    dispose: () => {
      entries.dispose();
      root.dispose();
    },
  };
}
