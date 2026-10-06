import {
  NullEngine,
  Scene,
  TransformNode,
  VertexBuffer,
} from "@babylonjs/core";
import { expect, test } from "vitest";
import { glbDataUrl } from "./helpers/assets";
import { loadModelAsset } from "../src/render/glb-model";
import { TerrainMap } from "../src/map";
import { ARC_ACTOR_DEFINITIONS } from "./helpers/content";
import {
  createTilePlacedActor,
  occupiedTilesFor,
} from "../src/simulation/placement";
import { createTilePlacedActorViewRegistry } from "../src/render/tile-placed-actor-view";
import { createHarvesterAppearance } from "../src/render/harvester";
import { createRefineryDetails } from "../src/render/refinery";
import { createMaterialsSitesView } from "../src/render/materials-sites";
import type { EconomyState } from "../src/simulation/economy";

const definition = ARC_ACTOR_DEFINITIONS.find(
  (definition) => definition.id === "arc-materials-refinery",
)!;
const appearances = new Map([
  [
    definition.id,
    {
      height: 1,
      color: [0.3, 0.4, 0.5] as [number, number, number],
      createDetails: createRefineryDetails,
    },
  ],
]);

test.each([0, 1, 2, 3])(
  "preview exit arrow follows rotation %i and stays outside its footprint",
  (quarterTurns) => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    try {
      const map = new TerrainMap({
        width: 12,
        height: 12,
        tileSize: 0.5,
        createHeight: () => 0,
      });
      const views = createTilePlacedActorViewRegistry(
        scene,
        map,
        [definition],
        appearances,
        { preview: true },
      );
      const actor = createTilePlacedActor(map, definition, {
        actorId: "preview",
        origin: { x: 5, z: 5 },
        quarterTurns,
      });
      views.update([actor]);
      const arrow = scene.getMeshByName(
        "tile-placed-actor-preview-root-exit-arrow",
      )!;
      const positions = arrow.getVerticesData(VertexBuffer.PositionKind)!;
      const frontX = Math.round(Math.sin(actor.facing));
      const frontZ = Math.round(Math.cos(actor.facing));
      const edge =
        Math.max(
          ...occupiedTilesFor(actor, definition).map((tile) => {
            const point = map.tileCenter(tile.x, tile.z);
            return point.x * frontX + point.z * frontZ;
          }),
        ) +
        map.tileSize / 2;
      const projections = Array.from(
        { length: positions.length / 3 },
        (_, index) =>
          positions[index * 3]! * frontX + positions[index * 3 + 2]! * frontZ,
      );
      expect(projections.every((projection) => projection > edge)).toBe(true);
      expect(projections[6]).toBe(Math.max(...projections));
      expect(arrow.isPickable).toBe(false);
      views.update([]);
      expect(arrow.isDisposed()).toBe(true);
      views.dispose();
    } finally {
      engine.dispose();
    }
  },
);

test("preview arrows follow terrain changes beyond the building footprint", () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  try {
    const map = new TerrainMap({
      width: 12,
      height: 12,
      tileSize: 1,
      createHeight: () => 0,
    });
    const views = createTilePlacedActorViewRegistry(
      scene,
      map,
      [definition],
      appearances,
      { preview: true },
    );
    const actor = createTilePlacedActor(map, definition, {
      actorId: "preview",
      origin: { x: 5, z: 5 },
    });
    views.update([actor]);
    const name = "tile-placed-actor-preview-root-exit-arrow";
    const previous = scene.getMeshByName(name)!;
    const heights = previous
      .getVerticesData(VertexBuffer.PositionKind)!
      .filter((_, index) => index % 3 === 1);
    map.editTerrain({
      heights: [
        { x: 6, z: 8, height: 2 },
        { x: 7, z: 8, height: 2 },
      ],
    });
    views.animate(0);
    const current = scene.getMeshByName(name)!;
    const changed = current
      .getVerticesData(VertexBuffer.PositionKind)!
      .filter((_, index) => index % 3 === 1);
    expect(Math.max(...changed)).toBeGreaterThan(Math.max(...heights));
    views.dispose();
  } finally {
    engine.dispose();
  }
});

test("working signals are per Harvester and reduced motion preserves the visible state", () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  try {
    let reduced = false;
    const appearance = createHarvesterAppearance(scene, () => reduced);
    const first = appearance.instantiate("first", 0);
    const second = appearance.instantiate("second", 0);
    first.setWorking!(true);
    second.setWorking!(false);
    const drill = scene.getTransformNodeByName("first-drill")!;
    const idleDrill = scene.getTransformNodeByName("second-drill")!;
    expect(drill.position.y).toBeLessThan(idleDrill.position.y);
    first.animate!({ seconds: 0.1, distance: 0, turn: 0 });
    expect(drill.rotation.z).toBeGreaterThan(0);
    expect(idleDrill.rotation.z).toBe(0);
    reduced = true;
    const rotation = drill.rotation.z;
    first.animate!({ seconds: 0.1, distance: 0, turn: 0 });
    expect(drill.rotation.z).toBe(rotation);
    first.setWorking!(false);
    expect(drill.position.y).toBe(idleDrill.position.y);
    expect(scene.getMeshByName("first-work-beacon")!.scaling.y).toBe(1);
    first.dispose();
    second.dispose();
    appearance.dispose();
    expect(scene.meshes).toHaveLength(0);
    expect(scene.materials).toHaveLength(0);
  } finally {
    engine.dispose();
  }
});

test("Refinery animation freezes during construction and progresses when operational", () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  try {
    const map = new TerrainMap({
      width: 12,
      height: 12,
      tileSize: 1,
      createHeight: () => 0,
    });
    const views = createTilePlacedActorViewRegistry(
      scene,
      map,
      [definition],
      appearances,
    );
    const actor = createTilePlacedActor(map, definition, {
      actorId: "building",
      origin: { x: 5, z: 5 },
    });
    actor.construction = {
      paidMaterials: 100,
      completedTicks: 4,
      totalTicks: 8,
    };
    views.update([actor]);
    views.animate(2);
    expect(
      scene.getTransformNodeByName("tile-placed-actor-building-root-fan")!
        .rotation.y,
    ).toBe(0);
    const fill = scene.getMeshByName(
      "tile-placed-actor-building-root-construction-fill",
    )!;
    expect(fill.scaling.x).toBe(0.5);
    // Faces the camera like health bars, so the two stay aligned.
    expect(
      scene.getTransformNodeByName(
        "tile-placed-actor-building-root-construction",
      )!.billboardMode,
    ).toBe(TransformNode.BILLBOARDMODE_ALL);
    delete actor.construction;
    views.update([actor]);
    views.animate(2);
    expect(fill.isDisposed()).toBe(true);
    expect(
      scene.getTransformNodeByName("tile-placed-actor-building-root-fan")!
        .rotation.y,
    ).toBeCloseTo(2 * Math.PI);
    views.dispose();
  } finally {
    engine.dispose();
  }
});

test("resource and gift markers follow edited terrain and release their observer", async () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  try {
    const map = new TerrainMap({
      width: 12,
      height: 12,
      tileSize: 1,
      createHeight: () => 0,
    });
    const economy: EconomyState = {
      materials: 0,
      depositedMaterials: 0,
      harvesters: [],
      production: [],
      sites: [
        {
          id: "site",
          name: "Materials",
          tile: { x: 5, z: 5 },
          initialMaterials: 100,
          remainingMaterials: 100,
        },
      ],
      loot: [
        {
          id: "cache",
          name: "Salvage",
          tile: { x: 7, z: 5 },
          materials: 25,
          collected: false,
        },
      ],
    };
    const hadObservers = map.onChangedObservable.hasObservers();
    const view = createMaterialsSitesView(scene, map, economy);
    const load = (name: string, idle?: string) =>
      loadModelAsset(scene, {
        url: glbDataUrl(`/assets/models/${name}.glb`),
        idle,
      });
    const mound = await load("materials-mound");
    const salvage = await load("salvage", "idle");
    view.setMound(mound);
    view.setSalvage(salvage);
    const site = scene.getTransformNodeByName("materials-site")!;
    const gift = scene.getTransformNodeByName("materials-cache-gift")!;
    view.animate(1);
    const siteHeight = site.position.y;
    const giftHeight = gift.getHierarchyBoundingVectors(true).max.y;
    map.editTerrain({
      heights: [5, 6, 7, 8].flatMap((x) =>
        [5, 6].map((z) => ({ x, z, height: 2 })),
      ),
    });
    view.animate(1);
    expect(site.position.y).toBeCloseTo(siteHeight + 2);
    expect(gift.getHierarchyBoundingVectors(true).max.y).toBeCloseTo(
      giftHeight + 2,
    );
    economy.sites[0].remainingMaterials = 25;
    view.update(economy, () => true);
    site.computeWorldMatrix(true);
    expect(site.getHierarchyBoundingVectors(true).min.y).toBeCloseTo(2);
    view.dispose();
    expect(map.onChangedObservable.hasObservers()).toBe(hadObservers);
  } finally {
    engine.dispose();
  }
});

test("gift salvage hovers, rotates, targets its tile and disappears on collection", async () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  try {
    const map = new TerrainMap({
      width: 12,
      height: 12,
      tileSize: 1,
      createHeight: () => 0,
    });
    const economy: EconomyState = {
      materials: 0,
      depositedMaterials: 0,
      sites: [],
      harvesters: [],
      production: [],
      loot: [
        {
          id: "cache",
          name: "Salvage",
          tile: { x: 5, z: 5 },
          materials: 25,
          collected: false,
        },
      ],
    };
    const view = createMaterialsSitesView(scene, map, economy);
    const load = (name: string, idle?: string) =>
      loadModelAsset(scene, {
        url: glbDataUrl(`/assets/models/${name}.glb`),
        idle,
      });
    const mound = await load("materials-mound");
    const salvage = await load("salvage", "idle");
    view.setMound(mound);
    view.setSalvage(salvage);
    const gift = scene.getTransformNodeByName(
      "materials-cache-gift",
    ) as TransformNode;
    view.animate(0);
    const height = gift.getHierarchyBoundingVectors(true).max.y;
    const animated = scene.getTransformNodeByName(
      "materials-cache-model-salvage",
    )!;
    const rotation = animated.rotationQuaternion!.y;
    view.animate(1);
    expect(gift.getHierarchyBoundingVectors(true).max.y).not.toBe(height);
    expect(animated.rotationQuaternion!.y).not.toBe(rotation);
    for (const mesh of gift.getChildMeshes()) {
      expect(mesh.isPickable).toBe(true);
      expect(view.lootTileForMesh(mesh)).toEqual({ x: 5, z: 5 });
    }
    expect(view.lootTileForMesh(null)).toBeUndefined();
    economy.loot[0].collected = true;
    view.update(economy, () => true);
    expect(gift.isEnabled()).toBe(false);
    expect(gift.getChildMeshes().every((mesh) => !mesh.isEnabled())).toBe(true);
    for (const mesh of gift.getChildMeshes())
      expect(view.lootTileForMesh(mesh)).toBeUndefined();
    view.dispose();
    mound.dispose();
    salvage.dispose();
    expect(scene.meshes).toHaveLength(0);
    expect(scene.materials).toHaveLength(0);
  } finally {
    engine.dispose();
  }
});

test("content scale applies to the entire Harvester and its bounds", () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const appearance = createHarvesterAppearance(scene, () => true, 2);
  const instance = appearance.instantiate("scaled", 0);
  try {
    expect(appearance.bounds).toEqual({ radius: 1.44, height: 2.4 });
    expect(instance.root.scaling.asArray()).toEqual([2, 2, 2]);
    expect(
      instance.root
        .getChildTransformNodes()
        .some((node) => node.name === "scaled-drill"),
    ).toBe(true);
  } finally {
    instance.dispose();
    appearance.dispose();
    scene.dispose();
    engine.dispose();
  }
});
