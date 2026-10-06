import {
  AbstractMesh,
  AnimationGroup,
  LoadAssetContainerAsync,
  MeshBuilder,
  TransformNode,
} from "@babylonjs/core";
import { RegisterSceneLoaderPlugin } from "@babylonjs/core/Loading/sceneLoader.js";
import { GLTFFileLoaderMetadata } from "@babylonjs/loaders/glTF/glTFFileLoader.metadata.js";

import { isId, isOneOf, isRecord } from "../simulation/validation";
import { BUILDING_ACTIVITY_KINDS } from "../simulation/production";

import type { AssetContainer, Material, Scene } from "@babylonjs/core";
import type { BuildingActivityKind } from "../simulation/production";
import type {
  BuildingMotions,
  TilePlacedActorDetailsFactory,
} from "./tile-placed-actor-view";

// Generated eyes and weapon effects use unlit materials.
RegisterSceneLoaderPlugin({
  ...GLTFFileLoaderMetadata,
  createPlugin: async (options) => {
    const [
      { GLTFFileLoader, RegisterGLTF2Loader },
      { RegisterInstancedMesh },
      { RegisterKHR_materials_unlit },
    ] = await Promise.all([
      import("@babylonjs/loaders/glTF/2.0/glTFLoader.pure.js"),
      import("@babylonjs/core/Meshes/instancedMesh.pure.js"),
      import("@babylonjs/loaders/glTF/2.0/Extensions/KHR_materials_unlit.pure.js"),
    ]);
    RegisterInstancedMesh();
    RegisterGLTF2Loader();
    RegisterKHR_materials_unlit();
    return new GLTFFileLoader(options[GLTFFileLoaderMetadata.name]);
  },
});

export type ModelGraphics = {
  url: string;
  idle?: string;
  /**
   * Clips that play once per building activity. Each starts and ends at rest
   * and keys no channel that idle keys.
   */
  activities?: Partial<Record<BuildingActivityKind, string>>;
};
export type ModelInstance = {
  root: TransformNode;
  pose: (seconds: number) => void;
  activities?: BuildingMotions;
  dispose: () => void;
};
export type ModelAsset = {
  /** Highest point above the origin at rest, in model units. */
  topHeight?: number;
  /** Instances share materials; clone a material before editing it. */
  instantiate: (name: string) => ModelInstance;
  dispose: () => void;
};

/** Includes a mesh root as well as its descendants. */
export function hierarchyMeshes(root: TransformNode): AbstractMesh[] {
  return [
    ...(root instanceof AbstractMesh ? [root] : []),
    ...root.getChildMeshes(),
  ];
}

export function validateModelGraphics(
  graphics: unknown,
): asserts graphics is ModelGraphics {
  if (
    !isRecord(graphics) ||
    !isId(graphics.url) ||
    (graphics.idle !== undefined && !isId(graphics.idle))
  )
    throw new RangeError("A model needs a URL and a valid idle clip name");
  const activities = graphics.activities;
  if (
    activities !== undefined &&
    (!isRecord(activities) ||
      Object.entries(activities).some(
        ([kind, clip]) =>
          !isOneOf(BUILDING_ACTIVITY_KINDS, kind) || !isId(clip),
      ))
  )
    throw new RangeError(
      `Model ${graphics.url} needs activity clips named by activity kind`,
    );
}

/** Loads a GLB and checks it with `prepare`, releasing it if that throws. */
export async function loadContainer<T>(
  scene: Scene,
  url: string,
  prepare: (assets: AssetContainer) => T,
): Promise<{ assets: AssetContainer; prepared: T }> {
  // Source instances ignore material replacement, even when later cloned.
  const assets = await LoadAssetContainerAsync(url, scene, {
    pluginOptions: { gltf: { createInstances: false } },
  });
  try {
    return { assets, prepared: prepare(assets) };
  } catch (error) {
    assets.dispose();
    throw error;
  }
}

/**
 * Finds a named clip that animates only the container's own nodes, with
 * finite frames and one shared positive frame rate.
 */
export function findClip(
  assets: AssetContainer,
  name: string,
  invalid: (problem: string) => Error,
): AnimationGroup {
  const matches = assets.animationGroups.filter((each) => each.name === name);
  const found = matches[0];
  if (!found) throw invalid(`is missing clip ${name}`);
  if (matches.length > 1) throw invalid(`has multiple clips named ${name}`);
  const owned = new Set<unknown>([...assets.transformNodes, ...assets.meshes]);
  for (const manager of new Set(
    assets.meshes.flatMap((mesh) => mesh.morphTargetManager ?? []),
  ))
    for (let index = 0; index < manager.numTargets; index++)
      owned.add(manager.getTarget(index));
  // Instances retarget clips by clone, so an outside target would animate the
  // shared original.
  for (const { target } of found.targetedAnimations)
    if (!owned.has(target))
      throw invalid(`clip ${name} animates ${target?.name ?? "a target"}`);
  if (clipChannels(found).size !== found.targetedAnimations.length)
    throw invalid(`clip ${name} keys a channel more than once`);
  for (const { animation } of found.targetedAnimations) {
    const keys = animation.getKeys();
    if (
      keys.length === 0 ||
      keys.some((key, index) => {
        const values = [
          key.value,
          ...(key.inTangent === undefined ? [] : [key.inTangent]),
          ...(key.outTangent === undefined ? [] : [key.outTangent]),
        ].flatMap((value) =>
          typeof value === "number" ? [value] : (value?.asArray?.() ?? [NaN]),
        );
        return (
          !Number.isFinite(key.frame) ||
          (index > 0 && key.frame <= keys[index - 1]!.frame) ||
          !values.every(Number.isFinite)
        );
      })
    )
      throw invalid(`clip ${name} needs ordered finite keys and values`);
  }
  const rates = found.targetedAnimations.map(
    ({ animation }) => animation.framePerSecond,
  );
  if (
    !Number.isFinite(found.from) ||
    !Number.isFinite(found.to) ||
    found.to < found.from ||
    rates.length === 0 ||
    rates.some(
      (rate) => !Number.isFinite(rate) || rate <= 0 || rate !== rates[0],
    )
  )
    throw invalid(
      `clip ${name} needs finite frames and a shared positive frame rate`,
    );
  return found;
}

/** `findClip` for a clip that must span more than one frame. */
export function findTimedClip(
  assets: AssetContainer,
  name: string,
  invalid: (problem: string) => Error,
): AnimationGroup {
  const found = findClip(assets, name, invalid);
  if (!(found.to > found.from))
    throw invalid(`clip ${name} needs more than one frame`);
  return found;
}

/** A one-shot clip must start and finish at its model's authored rest pose. */
export function findRestClip(
  assets: AssetContainer,
  name: string,
  invalid: (problem: string) => Error,
): AnimationGroup {
  const clip = findTimedClip(assets, name, invalid);
  const components = (
    value: number | { asArray?: () => number[] } | null | undefined,
  ): number[] =>
    typeof value === "number" ? [value] : (value?.asArray?.() ?? []);
  for (const { target, animation } of clip.targetedAnimations) {
    const rest = components(
      animation.targetPropertyPath.reduce((value, key) => value?.[key], target),
    );
    const atRest = (frame: number) => {
      const value = components(animation.evaluate(frame));
      const matches = (sign: number) =>
        rest.length > 0 &&
        value.length === rest.length &&
        value.every(
          (each, index) => Math.abs(each * sign - rest[index]!) <= 1e-5,
        );
      // Opposite quaternion signs describe the same rotation.
      return (
        matches(1) ||
        (animation.targetProperty === "rotationQuaternion" && matches(-1))
      );
    };
    if (!atRest(clip.from) || !atRest(clip.to))
      throw invalid(`clip ${name} must start and end at rest`);
  }
  return clip;
}

/** The node properties a clip keys, as comparable strings. */
export function clipChannels(clip: AnimationGroup): Set<string> {
  return new Set(
    clip.targetedAnimations.map(
      ({ target, animation }) =>
        `${target.uniqueId}:${animation.targetProperty}`,
    ),
  );
}

/** A clip's length at its shared frame rate, which `findClip` checks. */
export function clipSeconds(group: AnimationGroup): number {
  return (group.to - group.from) / clipFrameRate(group);
}

function clipFrameRate(group: AnimationGroup): number {
  return group.targetedAnimations[0]!.animation.framePerSecond;
}

/** Seeks a paused clip `seconds` in, wrapping or holding its last frame. */
function seekClip(group: AnimationGroup, seconds: number, loop: boolean) {
  const span = group.to - group.from;
  const frames = Math.max(0, seconds) * clipFrameRate(group);
  group.goToFrame(
    group.from + (loop ? frames % span : Math.min(frames, span)),
    true,
  );
}

/**
 * Clones a container's nodes under a new root with only the given clips.
 * Instances share the container's materials.
 */
export function instantiateContainer(
  assets: AssetContainer,
  name: string,
  clips: readonly AnimationGroup[],
) {
  const entries = assets.instantiateModelsToScene(
    (source) => `${name}-${source}`,
    false,
    {
      doNotInstantiate: true,
      predicate: (entity) =>
        !(entity instanceof AnimationGroup) || clips.includes(entity),
    },
  );
  const root = new TransformNode(name, assets.scene);
  for (const node of entries.rootNodes) node.parent = root;
  // Babylon clones morph managers but does not dispose them with the meshes.
  const morphManagers = new Set(
    root.getChildMeshes().flatMap((mesh) => mesh.morphTargetManager ?? []),
  );
  return {
    root,
    entries,
    dispose: () => {
      entries.dispose();
      root.dispose();
      for (const manager of morphManagers) manager.dispose();
      morphManagers.clear();
    },
  };
}

/** Wraps renderer-built geometry as a model instance without clips. */
export function staticInstance(root: TransformNode): ModelInstance {
  return { root, pose: () => {}, dispose: () => root.dispose() };
}

/** A unit-cube model, or a unit box in `material` until it loads. */
export function unitCubeInstance(
  asset: ModelAsset | undefined,
  name: string,
  material: Material,
  scene: Scene,
): ModelInstance {
  if (asset) return asset.instantiate(name);
  const box = MeshBuilder.CreateBox(name, {}, scene);
  box.material = material;
  return staticInstance(box);
}

/** Loads static or articulated geometry; instances own their animation state. */
export async function loadModelAsset(
  scene: Scene,
  graphics: ModelGraphics,
): Promise<ModelAsset> {
  validateModelGraphics(graphics);
  const { assets, prepared } = await loadContainer(
    scene,
    graphics.url,
    (assets) => {
      const invalid = (problem: string) =>
        new Error(`Model ${graphics.url} ${problem}`);
      if (!assets.meshes.some((mesh) => mesh.getTotalVertices() > 0))
        throw invalid("has no geometry");
      const idle =
        graphics.idle === undefined
          ? undefined
          : findTimedClip(assets, graphics.idle, invalid);
      const idleChannels = idle ? clipChannels(idle) : new Set<string>();
      const activities = Object.entries(graphics.activities ?? {}).map(
        ([kind, name]) => {
          const clip = findRestClip(assets, name!, invalid);
          if ([...clipChannels(clip)].some((each) => idleChannels.has(each)))
            throw invalid(`clip ${name} keys a channel that idle keys`);
          return [kind, clip] as const;
        },
      );
      for (const group of assets.animationGroups) group.stop();
      const topHeight = Math.max(
        ...assets.meshes
          .filter((mesh) => mesh.getTotalVertices() > 0)
          .map((mesh) => {
            mesh.computeWorldMatrix(true);
            return mesh.getBoundingInfo().boundingBox.maximumWorld.y;
          }),
      );
      return { idle, activities, topHeight };
    },
  );
  const { idle, activities } = prepared;
  const used = [...(idle ? [idle] : []), ...activities.map(([, clip]) => clip)];
  const sources = assets.animationGroups.filter((each) => used.includes(each));
  return {
    topHeight: prepared.topHeight,
    instantiate: (name) => {
      const { root, entries, dispose } = instantiateContainer(
        assets,
        name,
        used,
      );
      const clone = (source: AnimationGroup) => {
        const group = entries.animationGroups[sources.indexOf(source)]!;
        group.start(true);
        group.pause();
        group.goToFrame(group.from);
        return group;
      };
      const group = idle && clone(idle);
      return {
        root,
        pose: (seconds) => {
          if (group) seekClip(group, seconds, true);
        },
        activities: Object.fromEntries(
          activities.map(([kind, source]) => {
            const motion = clone(source);
            return [
              kind,
              {
                seconds: clipSeconds(motion),
                pose: (seconds: number) => seekClip(motion, seconds, false),
              },
            ];
          }),
        ),
        dispose,
      };
    },
    dispose: () => assets.dispose(),
  };
}

/** Seats generated building art above the terrain-conforming foundation. */
export function modelBuildingDetails(
  asset: ModelAsset,
): TilePlacedActorDetailsFactory {
  return (root, placement) => {
    const instance = asset.instantiate(`${root.name}-model`);
    instance.root.parent = root;
    instance.root.position.set(
      placement.center.x,
      placement.roof,
      placement.center.z,
    );
    instance.root.rotation.y = placement.facing;
    instance.root.scaling.setAll(placement.tileSize);
    instance.pose(0);
    return {
      update: instance.pose,
      activities: instance.activities,
      dispose: instance.dispose,
    };
  };
}
