import {
  NullEngine,
  Scene,
  TransformNode,
  VertexBuffer,
} from "@babylonjs/core";
import { expect, test } from "vitest";
import { TerrainMap } from "../src/map";
import { ARC_ACTOR_DEFINITIONS } from "../src/content/arc";
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
    delete actor.construction;
    views.update([actor]);
    views.animate(2);
    expect(fill.isDisposed()).toBe(true);
    expect(
      scene.getTransformNodeByName("tile-placed-actor-building-root-fan")!
        .rotation.y,
    ).toBe(4);
    views.dispose();
  } finally {
    engine.dispose();
  }
});

test("gift salvage hovers, rotates, leaves terrain pickable and disappears on collection", () => {
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
    const gift = scene.getTransformNodeByName(
      "materials-cache-gift",
    ) as TransformNode;
    view.animate(0);
    const height = gift.position.y;
    const rotation = gift.rotation.y;
    view.animate(1);
    expect(gift.position.y).not.toBe(height);
    expect(gift.rotation.y).not.toBe(rotation);
    expect(gift.getChildMeshes().every((mesh) => !mesh.isPickable)).toBe(true);
    economy.loot[0].collected = true;
    view.update(economy);
    expect(gift.isEnabled()).toBe(false);
    expect(gift.getChildMeshes().every((mesh) => !mesh.isEnabled())).toBe(true);
    view.dispose();
    expect(scene.meshes).toHaveLength(0);
    expect(scene.materials).toHaveLength(0);
  } finally {
    engine.dispose();
  }
});
