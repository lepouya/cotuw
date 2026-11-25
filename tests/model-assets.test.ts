import { Color3, TransformNode, Vector3, VertexBuffer } from "@babylonjs/core";
import { expect, test } from "vitest";

import { testScene } from "./helpers/scene";
import { BASE_CONTENT } from "./helpers/content";
import { glbDataUrl } from "./helpers/assets";
import { loadModelAsset, modelBuildingDetails } from "../src/render/glb-model";
import { loadSkinnedActorAppearance } from "../src/render/skinned-actor-appearance";
import {
  createOwnerMaterials,
  isOwnerMaterial,
} from "../src/render/owner-materials";

import type { AbstractMesh, PBRMaterial } from "@babylonjs/core";
import type { Rgb } from "../src/content/presentation";

/** Horizontal radius and height reached by the meshes' current pose. */
function posedExtent(meshes: readonly AbstractMesh[]) {
  let radius = 0;
  let height = 0;
  for (const mesh of meshes) {
    const matrix = mesh.computeWorldMatrix(true);
    mesh.skeleton?.prepare(true);
    const positions = mesh.getPositionData(true);
    if (!positions) continue;
    for (let index = 0; index < positions.length; index += 3) {
      const point = Vector3.TransformCoordinates(
        Vector3.FromArray(positions, index),
        matrix,
      );
      radius = Math.max(radius, Math.hypot(point.x, point.z));
      height = Math.max(height, point.y);
    }
  }
  return { radius, height };
}

test("the Construct Nursery opens its gate wide enough for a Briar Ram", async () => {
  const scene = testScene();
  const graphics =
    BASE_CONTENT.presentation["circle-construct-nursery"]!.building!.glb!;
  const asset = await loadModelAsset(scene, {
    ...graphics,
    url: glbDataUrl(graphics.url),
  });
  const nursery = asset.instantiate("nursery");
  const exit = nursery.activities!.exit!;
  const panels = nursery.root
    .getChildMeshes()
    .filter(({ name }) => /-growth-canopy-entrance--?1$/.test(name));
  expect(panels).toHaveLength(2);
  const opening = (seconds: number) => {
    exit.pose(seconds);
    scene.animate();
    const [left, right] = panels
      .map((panel) => {
        panel.computeWorldMatrix(true);
        return panel.getBoundingInfo().boundingBox;
      })
      .sort((a, b) => a.centerWorld.x - b.centerWorld.x);
    return right!.minimumWorld.x - left!.maximumWorld.x;
  };
  const radius = BASE_CONTENT.actors.find(({ id }) => id === "circle-briar-ram")
    ?.movement?.radius;
  if (radius === undefined)
    throw new Error("Expected a Briar Ram movement radius");
  const resting = opening(0);
  expect(resting).toBeGreaterThan(0);
  const deployed = opening(exit.seconds / 2);
  expect(deployed).toBeGreaterThan(resting);
  expect(deployed).toBeGreaterThan(2 * radius);
  nursery.dispose();
  asset.dispose();
});

test("generated Turrets keep instance aiming independent of idle and firing", async () => {
  const scene = testScene();
  const graphics =
    BASE_CONTENT.presentation["arc-sentry-turret"]!.building!.glb!;
  const asset = await loadModelAsset(scene, {
    ...graphics,
    url: glbDataUrl(graphics.url),
  });
  const first = asset.instantiate("first");
  const second = asset.instantiate("second");
  const yaw = () =>
    first.root
      .getDescendants()
      .find((node) => node.name === "first-sentry-turret") as TransformNode;
  const carriage = first.root
    .getDescendants()
    .find((node) => node.name === "first-sentry-carriage") as TransformNode;
  const flashes = [-0.3, 0.3].map((side) =>
    carriage
      .getChildMeshes()
      .find((mesh) => mesh.name === `first-sentry-flash-${side}`)!,
  );
  first.aim!(Math.PI / 2);
  first.pose(0.7);
  first.activities!.attack!.pose(0.08);
  scene.animate();
  yaw().computeWorldMatrix(true);
  expect(yaw().getDirection(Vector3.Forward()).normalize().x).toBeCloseTo(1);
  expect(carriage.position.z).toBeLessThan(-0.05);
  for (const flash of flashes) expect(flash.scaling.x).toBeGreaterThan(0.5);
  const other = second.root
    .getDescendants()
    .find((node) => node.name === "second-sentry-carriage") as TransformNode;
  expect(other.position.z).toBeCloseTo(0);
  first.activities!.attack!.pose(first.activities!.attack!.seconds);
  scene.animate();
  expect(carriage.position.z).toBeCloseTo(0);
  for (const flash of flashes) expect(flash.scaling.x).toBeLessThan(0.01);
  const root = new TransformNode("placed", scene);
  const details = modelBuildingDetails(asset)(
    root,
    { center: Vector3.Zero(), roof: 0, tileSize: 1, facing: Math.PI / 2 },
    () => {
      throw new Error("Unused");
    },
  );
  details.aim!(Math.PI);
  const placedYaw = root
    .getDescendants()
    .find(
      (node) => node.name === "placed-model-sentry-turret",
    ) as TransformNode;
  placedYaw.computeWorldMatrix(true);
  expect(placedYaw.getDirection(Vector3.Forward()).normalize().z).toBeCloseTo(
    -1,
  );
  details.dispose();
  root.dispose();
  first.dispose();
  second.dispose();
  asset.dispose();
});

test.each(
  BASE_CONTENT.actors.filter(({ id, faction }) => {
    const { model, building } = BASE_CONTENT.presentation[id]!;
    return (
      (faction === "arc" || faction === "circle") &&
      ((model && "glb" in model) || !!building?.glb)
    );
  }),
)(
  "$id exports separate owner markings that instances can recolor and share",
  async ({ id }) => {
    const scene = testScene();
    const presentation = BASE_CONTENT.presentation[id]!;
    const model = presentation.model;
    const asset =
      model && "glb" in model
        ? await loadSkinnedActorAppearance(scene, {
            ...model.glb,
            url: glbDataUrl(model.glb.url),
          })
        : await loadModelAsset(scene, {
            ...presentation.building!.glb!,
            url: glbDataUrl(presentation.building!.glb!.url),
          });
    const instances = ["first", "second", "third"].map((name) =>
      asset.instantiate(name, 0),
    );
    const markings = instances.map(({ root }) =>
      root
        .getChildMeshes()
        .filter((mesh) => isOwnerMaterial(mesh.material?.name ?? "")),
    );
    expect(markings[0]!.length).toBeGreaterThan(0);
    const colors = new Map<string, Rgb>([
      ["west", [0.2, 0.45, 1]],
      ["east", [0.92, 0.18, 0.15]],
    ]);
    const materials = createOwnerMaterials(colors);
    const source = markings[0]![0]!.material as PBRMaterial;
    const sourceColor = source.albedoColor.clone();
    const body = instances[0]!.root
      .getChildMeshes()
      .filter((mesh) => !markings[0]!.includes(mesh))
      .map((mesh) => [mesh, mesh.material] as const);
    try {
      for (const [index, instance] of instances.entries())
        materials.apply(
          instance.root.getChildMeshes(),
          index === 2 ? "east" : "west",
        );
      for (const [index, meshes] of markings.entries())
        for (const mesh of meshes) {
          const color = colors.get(index === 2 ? "east" : "west")!;
          expect((mesh.material as PBRMaterial).albedoColor).toEqual(
            new Color3(...color).toLinearSpace(),
          );
          // Baked colors must not multiply the new material's owner color.
          const vertices = mesh.getVerticesData(VertexBuffer.ColorKind);
          if (vertices)
            expect(Array.from(vertices).every((value) => value === 1)).toBe(
              true,
            );
        }
      expect(markings[0]![0]!.material).toBe(markings[1]![0]!.material);
      expect(markings[0]![0]!.material).not.toBe(markings[2]![0]!.material);
      expect(source.albedoColor).toEqual(sourceColor);
      for (const [mesh, material] of body) expect(mesh.material).toBe(material);
    } finally {
      for (const instance of instances) instance.dispose();
      materials.dispose();
      asset.dispose();
    }
    expect(scene.materials).toHaveLength(0);
  },
);

test.each(["wolf", "alpha-wolf", "arc-harvester"])(
  "%s loads its generated clips and holds its death pose",
  async (id) => {
    const scene = testScene();
    const model = BASE_CONTENT.presentation[id]!.model!;
    if (!("glb" in model)) throw new Error("Expected generated GLB");
    const appearance = await loadSkinnedActorAppearance(scene, {
      ...model.glb,
      url: glbDataUrl(model.glb.url),
    });
    const first = appearance.instantiate("first", 0);
    const second = appearance.instantiate("second", 0);
    if (id !== "arc-harvester") {
      const rig = (root: typeof first.root) =>
        root.getChildMeshes().find((mesh) => mesh.skeleton)!.skeleton;
      expect(rig(first.root)).not.toBe(rig(second.root));
      const legs = () =>
        scene.getTransformNodeByName("first-wolf-leg-0")!.rotationQuaternion!.x;
      first.animate!({ distance: 0.1, seconds: 0.1, turn: 0 });
      scene.animate();
      expect(Math.abs(legs())).toBeGreaterThan(0.01);
      first.play!("attack");
      first.animate!({ distance: 0, seconds: 0.1, turn: 0 });
      scene.animate();
      const head = scene.getTransformNodeByName("first-wolf-head-joint")!;
      const jaw = scene.getTransformNodeByName("first-wolf-jaw")!;
      expect(head.rotationQuaternion!.x).toBeLessThan(-0.1);
      expect(jaw.rotationQuaternion!.x).toBeGreaterThan(0.15);
      first.animate!({ distance: 0, seconds: 0.4, turn: 0 });
      scene.animate();
      expect(jaw.rotationQuaternion!.x).toBeCloseTo(0);
    } else {
      first.setAnimationState!({ working: true });
      second.setAnimationState!({ working: false });
      first.animate!({ distance: 0, seconds: 0.1, turn: 0 });
      scene.animate();
      const drill = scene.getTransformNodeByName("first-harvester-drill")!;
      expect(drill.position.y).toBeLessThan(0.4);
      expect(scene.getMeshByName("first-working-signal")!.isEnabled()).toBe(
        true,
      );
      // DESIGN: generated amber and green lamps show state without motion.
      const lamp = (signal: string) =>
        (scene.getMeshByName(signal)!.material as PBRMaterial).albedoColor;
      expect(lamp("second-idle-signal").r).toBeGreaterThan(
        lamp("second-idle-signal").b * 4,
      );
      expect(lamp("first-working-signal").g).toBeGreaterThan(
        lamp("first-working-signal").r * 4,
      );
      expect(scene.getMeshByName("second-working-signal")!.isEnabled()).toBe(
        false,
      );
    }
    first.die!(0);
    scene.animate();
    const height = () => {
      if (id === "arc-harvester")
        return first.root.getHierarchyBoundingVectors(true).max.y;
      const head = scene.getTransformNodeByName("first-wolf-head-joint")!;
      head.computeWorldMatrix(true);
      return head.getAbsolutePosition().y;
    };
    const standing = height();
    first.die!(1);
    scene.animate();
    const fallen = height();
    expect(fallen).toBeLessThan(standing);
    expect(fallen).toBeGreaterThan(0);
    first.die!(60);
    scene.animate();
    expect(height()).toBeCloseTo(fallen);
    first.dispose();
    second.dispose();
    appearance.dispose();
  },
);

test.each(["command-center", "barracks", "refinery", "relay", "salvage"])(
  "%s loads its generated idle clip with independent instances",
  async (kind) => {
    const scene = testScene();
    const asset = await loadModelAsset(scene, {
      url: glbDataUrl(`/assets/models/${kind}.glb`),
      idle: "idle",
    });
    const first = asset.instantiate("first");
    const second = asset.instantiate("second");
    const groups = scene.animationGroups.filter(
      ({ name }) => name === "first-idle",
    );
    expect(groups).toHaveLength(1);
    first.pose(1);
    second.pose(0);
    scene.animate();
    expect(groups[0]!.getCurrentFrame()).toBe(
      groups[0]!.targetedAnimations[0]!.animation.framePerSecond,
    );
    first.dispose();
    expect(second.root.isDisposed()).toBe(false);
    second.dispose();
    asset.dispose();
    expect(scene.meshes).toHaveLength(0);
    expect(scene.materials).toHaveLength(0);
  },
);

test("ARC support uses distinct unarmed geometry within its selection bounds", async () => {
  const scene = testScene();
  const bodies = [];
  const urls = [];
  for (const id of ["arc-scout", "arc-medic", "arc-mechanic"]) {
    const model = BASE_CONTENT.presentation[id]!.model!;
    if (!("glb" in model)) throw new Error("Expected generated infantry");
    urls.push(model.glb.url);
    expect(model.glb.clips.attack).toBeUndefined();
    expect(model.glb.clips.aim).toBeUndefined();
    const asset = await loadSkinnedActorAppearance(scene, {
      ...model.glb,
      url: glbDataUrl(model.glb.url),
    });
    const instance = asset.instantiate(id, 0);
    const body = instance.root
      .getChildMeshes()
      .find((mesh) => mesh.name.endsWith(`${id}-body`))!;
    bodies.push(Array.from(body.getVerticesData(VertexBuffer.PositionKind)!));
    scene.animate();
    // Selection uses a cylinder, including the posed support equipment.
    const { radius, height } = posedExtent(instance.root.getChildMeshes());
    expect(height, `${id} height`).toBeLessThanOrEqual(model.glb.bounds.height);
    expect(radius, `${id} radius`).toBeLessThanOrEqual(model.glb.bounds.radius);
    instance.dispose();
    asset.dispose();
  }
  expect(new Set(urls).size).toBe(3);
  expect(bodies[0]).not.toEqual(bodies[1]);
  expect(bodies[0]).not.toEqual(bodies[2]);
  expect(bodies[1]).not.toEqual(bodies[2]);
});

test.each(["circle-healer", "circle-artificer"])(
  "%s fits its idle selection bounds",
  async (id) => {
    const scene = testScene();
    const model = BASE_CONTENT.presentation[id]!.model!;
    if (!("glb" in model)) throw new Error("Expected generated infantry");
    const asset = await loadSkinnedActorAppearance(scene, {
      ...model.glb,
      url: glbDataUrl(model.glb.url),
    });
    const instance = asset.instantiate(id, 0);
    scene.animate();
    const { radius, height } = posedExtent(instance.root.getChildMeshes());
    expect(radius).toBeLessThanOrEqual(model.glb.bounds.radius);
    expect(height).toBeLessThanOrEqual(model.glb.bounds.height);
    instance.dispose();
    asset.dispose();
  },
);

test("Demolition infantry carries a distinct launcher within Trooper selection bounds", async () => {
  const scene = testScene();
  const models = ["arc-trooper", "arc-demolition-trooper"].map((id) => {
    const model = BASE_CONTENT.presentation[id]!.model!;
    if (!("glb" in model)) throw new Error("Expected generated infantry");
    return model.glb;
  });
  expect(models[1].url).not.toBe(models[0].url);
  // Armed infantry rings fit the body; weapons may extend past them.
  expect(models[1].bounds).toEqual(models[0].bounds);
  expect(models[1].clips.attack).toBe("launch");
  const geometry = [];
  for (const [index, model] of models.entries()) {
    const asset = await loadSkinnedActorAppearance(scene, {
      ...model,
      url: glbDataUrl(model.url),
    });
    const instance = asset.instantiate(`infantry-${index}`, 0);
    const body = instance.root
      .getChildMeshes()
      .find((mesh) => mesh.name.endsWith("-body"))!;
    geometry.push(Array.from(body.getVerticesData(VertexBuffer.PositionKind)!));
    instance.dispose();
    asset.dispose();
  }
  expect(geometry[1]).not.toEqual(geometry[0]);
});
