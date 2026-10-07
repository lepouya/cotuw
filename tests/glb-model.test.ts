import {
  Animation,
  AnimationGroup,
  AssetContainer,
  Bone,
  Matrix,
  MeshBuilder,
  MorphTarget,
  MorphTargetManager,
  NullEngine,
  Scene,
  Skeleton,
  StandardMaterial,
  TransformNode,
  Vector3,
  VertexBuffer,
  VertexData,
} from "@babylonjs/core";
import { expect, test } from "vitest";

import { rigidSkin } from "../scripts/glb-export";
import {
  findClip,
  findRestClip,
  instantiateContainer,
  loadModelAsset,
} from "../src/render/glb-model";
import { loadSkinnedActorAppearance } from "../src/render/skinned-actor-appearance";
import { editedGlbDataUrl } from "./helpers/assets";
import { BASE_CONTENT } from "./helpers/content";

test("model instances release cloned morph managers without changing other instances", () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  try {
    const source = MeshBuilder.CreateBox("source", {}, scene);
    const manager = new MorphTargetManager(scene);
    manager.addTarget(MorphTarget.FromMesh(source, "shape"));
    source.morphTargetManager = manager;
    const assets = new AssetContainer(scene);
    assets.meshes.push(source);
    assets.morphTargetManagers.push(manager);
    const first = instantiateContainer(assets, "first", []);
    const second = instantiateContainer(assets, "second", []);
    const firstManager = first.root.getChildMeshes()[0].morphTargetManager!;
    const secondManager = second.root.getChildMeshes()[0].morphTargetManager!;
    expect(firstManager).not.toBe(secondManager);
    firstManager.getTarget(0).influence = 0.7;
    expect(secondManager.getTarget(0).influence).toBe(0);
    first.dispose();
    first.dispose();
    expect(scene.morphTargetManagers).not.toContain(firstManager);
    expect(scene.morphTargetManagers).toContain(secondManager);
    second.dispose();
    expect(scene.morphTargetManagers).toEqual([manager]);
  } finally {
    engine.dispose();
  }
});

test.each(["empty", "unordered", "non-finite", "non-finite tangent"])(
  "rejects %s animation keys before playback",
  (problem) => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    try {
      const target = new TransformNode("joint", scene);
      const group = new AnimationGroup("idle", scene);
      const animation = new Animation(
        "pose",
        "position",
        30,
        Animation.ANIMATIONTYPE_VECTOR3,
      );
      animation.setKeys([
        { frame: 0, value: Vector3.Zero() },
        { frame: 30, value: Vector3.One() },
      ]);
      group.addTargetedAnimation(animation, target);
      const assets = new AssetContainer(scene);
      assets.transformNodes.push(target);
      assets.animationGroups.push(group);
      const keys = animation.getKeys();
      if (problem === "empty") keys.length = 0;
      if (problem === "unordered") keys[1].frame = -1;
      if (problem === "non-finite") keys[1].value.x = NaN;
      if (problem === "non-finite tangent")
        keys[1].inTangent = new Vector3(NaN, 0, 0);
      expect(() =>
        findClip(assets, "idle", (message) => new Error(message)),
      ).toThrow("needs ordered finite keys and values");
    } finally {
      engine.dispose();
    }
  },
);

test.each(["walk", "death"])(
  "rejects incomplete %s poses and releases failed assets",
  async (clip) => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    try {
      const { model } = BASE_CONTENT.presentation["arc-trooper"];
      if (!model || !("glb" in model))
        throw new Error("Expected generated model");
      const url = editedGlbDataUrl(model.glb.url, (gltf) => {
        const animation = gltf.animations.find(
          (each: any) => each.name === clip,
        );
        animation.channels.pop();
      });
      await expect(
        loadSkinnedActorAppearance(scene, { ...model.glb, url }),
      ).rejects.toThrow("pose channels");
      expect(scene.meshes).toHaveLength(0);
      expect(scene.skeletons).toHaveLength(0);
      expect(scene.animationGroups).toHaveLength(0);
    } finally {
      engine.dispose();
    }
  },
);

test("layered actor clips must use channels the base pose restores", async () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  try {
    const { model } = BASE_CONTENT.presentation["arc-trooper"];
    if (!model || !("glb" in model)) throw new Error("Expected GLB");
    const url = editedGlbDataUrl(model.glb.url, (gltf) => {
      const hit = gltf.animations.find((clip: any) => clip.name === "hit");
      const target = hit.channels[0].target.node;
      for (const name of ["idle", "walk"]) {
        const clip = gltf.animations.find((clip: any) => clip.name === name);
        clip.channels = clip.channels.filter(
          ({ target: each }: any) => each.node !== target,
        );
      }
    });
    await expect(
      loadSkinnedActorAppearance(scene, {
        ...model.glb,
        url,
        clips: { idle: "idle", locomotion: "walk", hit: "hit" },
      }),
    ).rejects.toThrow("keys a channel that idle does not restore");
    expect(scene.meshes).toHaveLength(0);
    expect(scene.animationGroups).toHaveLength(0);
  } finally {
    engine.dispose();
  }
});

test("trigger clips must return to their starting pose", async () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  try {
    const { model } = BASE_CONTENT.presentation["arc-trooper"];
    if (!model || !("glb" in model)) throw new Error("Expected GLB");
    const url = editedGlbDataUrl(model.glb.url, () => {});
    await expect(
      loadSkinnedActorAppearance(scene, {
        ...model.glb,
        url,
        clips: { idle: "idle", locomotion: "walk", hit: "death" },
      }),
    ).rejects.toThrow("must return to its starting pose");
    expect(scene.meshes).toHaveLength(0);
  } finally {
    engine.dispose();
  }
});

test("rejects a nominal skin without vertex weights", async () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  try {
    const { model } = BASE_CONTENT.presentation["arc-trooper"];
    if (!model || !("glb" in model))
      throw new Error("Expected generated model");
    const url = editedGlbDataUrl(model.glb.url, (gltf) => {
      for (const mesh of gltf.meshes)
        for (const primitive of mesh.primitives) {
          delete primitive.attributes.JOINTS_0;
          delete primitive.attributes.WEIGHTS_0;
        }
    });
    await expect(
      loadSkinnedActorAppearance(scene, { ...model.glb, url }),
    ).rejects.toThrow("has no skin");
  } finally {
    engine.dispose();
  }
});

test("rigid skin retains joint indices beyond the byte range", () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  try {
    const skeleton = new Skeleton("rig", "rig", scene);
    for (let index = 0; index <= 256; index++)
      new Bone(`joint-${index}`, skeleton, null, Matrix.Identity());
    const root = new TransformNode("root", scene);
    const material = new StandardMaterial("material", scene);
    const mesh = rigidSkin(
      "skin",
      [{ vertices: VertexData.CreateBox({}), bone: 256 }],
      skeleton,
      material,
      root,
    );
    expect(mesh.getVerticesData(VertexBuffer.MatricesIndicesKind)![0]).toBe(
      256,
    );
  } finally {
    engine.dispose();
  }
});

test("only morph targets attached to clonable meshes may be animated", () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  try {
    const manager = new MorphTargetManager(scene);
    const target = new MorphTarget("orphan", 0, scene);
    manager.addTarget(target);
    const assets = new AssetContainer(scene);
    assets.morphTargetManagers.push(manager);
    const group = new AnimationGroup("idle", scene);
    const animation = new Animation(
      "shape",
      "influence",
      30,
      Animation.ANIMATIONTYPE_FLOAT,
    );
    animation.setKeys([
      { frame: 0, value: 0 },
      { frame: 30, value: 1 },
    ]);
    group.addTargetedAnimation(animation, target);
    assets.animationGroups.push(group);
    expect(() =>
      findClip(assets, "idle", (message) => new Error(message)),
    ).toThrow("clip idle animates orphan");
  } finally {
    engine.dispose();
  }
});

test("rejects ambiguous clip names", () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  try {
    const assets = new AssetContainer(scene);
    assets.animationGroups.push(
      new AnimationGroup("idle", scene),
      new AnimationGroup("idle", scene),
    );
    expect(() =>
      findClip(assets, "idle", (message) => new Error(message)),
    ).toThrow("multiple clips named idle");
  } finally {
    engine.dispose();
  }
});

test("activity clips return to authored rest and reject duplicate channels", () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  try {
    const assets = new AssetContainer(scene);
    const target = new TransformNode("door", scene);
    assets.transformNodes.push(target);
    const group = new AnimationGroup("exit", scene);
    const animation = new Animation(
      "slide",
      "position.x",
      30,
      Animation.ANIMATIONTYPE_FLOAT,
    );
    const keys = (start: number, end: number) => [
      { frame: 0, value: start },
      { frame: 15, value: 1 },
      { frame: 30, value: end },
    ];
    animation.setKeys(keys(0, 0));
    group.addTargetedAnimation(animation, target);
    assets.animationGroups.push(group);
    const invalid = (message: string) => new Error(message);
    expect(findRestClip(assets, "exit", invalid)).toBe(group);
    for (const [start, end] of [
      [0.2, 0],
      [0, 0.2],
    ]) {
      animation.setKeys(keys(start!, end!));
      expect(() => findRestClip(assets, "exit", invalid)).toThrow(
        "start and end at rest",
      );
    }
    animation.setKeys(keys(0, 0));
    group.addTargetedAnimation(animation.clone(), target);
    expect(() => findClip(assets, "exit", invalid)).toThrow(
      "keys a channel more than once",
    );
  } finally {
    engine.dispose();
  }
});

test("reused glTF meshes still permit independent instance materials", async () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  try {
    const url = editedGlbDataUrl("/assets/models/foundation.glb", (gltf) => {
      const mesh = gltf.nodes.find((node: any) => node.mesh !== undefined).mesh;
      gltf.nodes.push({ name: "reused", mesh, translation: [2, 0, 0] });
      gltf.scenes[0].nodes.push(gltf.nodes.length - 1);
    });
    const asset = await loadModelAsset(scene, { url });
    const first = asset.instantiate("first");
    const second = asset.instantiate("second");
    const reused = (root: TransformNode) =>
      root.getChildMeshes().find((mesh) => mesh.name.endsWith("reused"))!;
    const original = reused(second.root).material;
    const replacement = new StandardMaterial("replacement", scene);
    reused(first.root).material = replacement;
    expect(reused(first.root).material === replacement).toBe(true);
    expect(reused(second.root).material === original).toBe(true);
    first.dispose();
    second.dispose();
    asset.dispose();
  } finally {
    engine.dispose();
  }
});
