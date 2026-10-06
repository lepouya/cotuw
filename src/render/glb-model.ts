import {
  AnimationGroup,
  LoadAssetContainerAsync,
  MeshBuilder,
  TransformNode,
} from "@babylonjs/core";
import { RegisterSceneLoaderPlugin } from "@babylonjs/core/Loading/sceneLoader.js";
import { GLTFFileLoaderMetadata } from "@babylonjs/loaders/glTF/glTFFileLoader.metadata.js";

import { isId, isRecord } from "../simulation/validation";

import type { AssetContainer, Material, Scene } from "@babylonjs/core";
import type { TilePlacedActorDetailsFactory } from "./tile-placed-actor-view";

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

export type ModelGraphics = { url: string; idle?: string };
export type ModelInstance = {
  root: TransformNode;
  pose: (seconds: number) => void;
  dispose: () => void;
};
export type ModelAsset = {
  /** Instances share materials; clone a material before editing it. */
  instantiate: (name: string) => ModelInstance;
  dispose: () => void;
};

export function validateModelGraphics(
  graphics: unknown,
): asserts graphics is ModelGraphics {
  if (
    !isRecord(graphics) ||
    !isId(graphics.url) ||
    (graphics.idle !== undefined && !isId(graphics.idle))
  )
    throw new RangeError("A model needs a URL and a valid idle clip name");
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

/** A clip's length at its shared frame rate, which `findClip` checks. */
export function clipSeconds(group: AnimationGroup): number {
  return (group.to - group.from) / clipFrameRate(group);
}

function clipFrameRate(group: AnimationGroup): number {
  return group.targetedAnimations[0]!.animation.framePerSecond;
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
  const { assets, prepared: idle } = await loadContainer(
    scene,
    graphics.url,
    (assets) => {
      const invalid = (problem: string) =>
        new Error(`Model ${graphics.url} ${problem}`);
      if (!assets.meshes.some((mesh) => mesh.getTotalVertices() > 0))
        throw invalid("has no geometry");
      const clip =
        graphics.idle === undefined
          ? undefined
          : findClip(assets, graphics.idle, invalid);
      if (clip && !(clip.to > clip.from))
        throw invalid(`clip ${graphics.idle} needs more than one frame`);
      for (const group of assets.animationGroups) group.stop();
      return clip;
    },
  );
  return {
    instantiate: (name) => {
      const { root, entries, dispose } = instantiateContainer(
        assets,
        name,
        idle ? [idle] : [],
      );
      const group = entries.animationGroups[0];
      if (group) {
        group.start(true);
        group.pause();
      }
      return {
        root,
        pose: (seconds) => {
          if (!group) return;
          group.goToFrame(
            group.from +
              ((Math.max(0, seconds) * clipFrameRate(group)) %
                (group.to - group.from)),
            true,
          );
        },
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
    return { update: instance.pose, dispose: instance.dispose };
  };
}
