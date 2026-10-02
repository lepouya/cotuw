import { NullEngine, Scene } from "@babylonjs/core";
import { expect, test } from "vitest";
import { TerrainMap } from "../src/map";
import { createTilePlacedActor } from "../src/simulation/placement";
import { createTilePlacedActorViewRegistry } from "../src/render/tile-placed-actor-view";
import type { ActorDefinition } from "../src/simulation/actor";

const definition: ActorDefinition = {
  id: "corner",
  behaviorId: "idle",
  footprint: {
    layer: "surface",
    occupiedTiles: [
      { x: 0, z: 0 },
      { x: 1, z: 0 },
      { x: 0, z: 1 },
    ],
    blocksMovement: true,
  },
  placement: { terrainTypeIds: ["plain"], maxSlope: 1 },
};

test("draws irregular rotated footprints on slopes at small tile sizes", () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  try {
    const map = new TerrainMap({
      width: 6,
      height: 6,
      tileSize: 0.05,
      createHeight: (x) => x * 0.01,
    });
    const views = createTilePlacedActorViewRegistry(
      scene,
      map,
      [definition],
      new Map([["corner", { height: 0.1, color: [0.2, 0.4, 0.6] }]]),
    );
    const actor = createTilePlacedActor(map, definition, {
      actorId: "object",
      origin: { x: 3, z: 3 },
      quarterTurns: 1,
    });
    views.update([actor]);
    const root = scene.getTransformNodeByName("tile-placed-actor-object-root")!;
    const columns = root.getChildMeshes();
    expect(columns.map(({ name }) => name).sort()).toEqual([
      "tile-placed-actor-object-tile-3-2",
      "tile-placed-actor-object-tile-3-3",
      "tile-placed-actor-object-tile-4-3",
    ]);
    for (const column of columns) {
      column.computeWorldMatrix(true);
      const bounds = column.getBoundingInfo().boundingBox;
      expect(bounds.maximumWorld.x - bounds.minimumWorld.x).toBeGreaterThan(0);
      expect(bounds.maximumWorld.x - bounds.minimumWorld.x).toBeLessThanOrEqual(
        map.tileSize + 1e-8,
      );
      expect(bounds.maximumWorld.z - bounds.minimumWorld.z).toBeGreaterThan(0);
      expect(bounds.maximumWorld.y).toBeCloseTo(0.15);
    }
    views.update([actor]);
    expect(scene.getTransformNodeByName(root.name)).toBe(root);
    views.update([]);
    expect(root.isDisposed()).toBe(true);
    expect(columns.every((column) => column.isDisposed())).toBe(true);
    views.dispose();
  } finally {
    engine.dispose();
  }
});

test("rebuilds a view when a restored placement changes under the same ID", () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  try {
    const map = new TerrainMap({ width: 6, height: 6, tileSize: 1 });
    const views = createTilePlacedActorViewRegistry(
      scene,
      map,
      [definition],
      new Map(),
    );
    views.update([
      createTilePlacedActor(map, definition, {
        actorId: "object",
        origin: { x: 1, z: 1 },
      }),
    ]);
    const old = scene.getTransformNodeByName("tile-placed-actor-object-root")!;
    views.update([
      createTilePlacedActor(map, definition, {
        actorId: "object",
        origin: { x: 3, z: 3 },
        quarterTurns: 1,
      }),
    ]);
    expect(old.isDisposed()).toBe(true);
    expect(
      scene.getMeshByName("tile-placed-actor-object-tile-4-3"),
    ).not.toBeNull();
    views.dispose();
  } finally {
    engine.dispose();
  }
});

test("rebuilds an unchanged placement when restored terrain changes", () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  try {
    const map = new TerrainMap({ width: 6, height: 6, tileSize: 1 });
    const views = createTilePlacedActorViewRegistry(
      scene,
      map,
      [definition],
      new Map([[definition.id, { height: 1, color: [0.2, 0.4, 0.6] }]]),
    );
    const actor = createTilePlacedActor(map, definition, {
      actorId: "object",
      origin: { x: 1, z: 1 },
    });
    views.update([actor]);
    const old = scene.getTransformNodeByName("tile-placed-actor-object-root")!;
    const material = old.getChildMeshes()[0]!.material;
    const state = map.terrainState();
    state.heights.fill(5);
    map.restoreTerrainState(state);
    views.update([actor]);
    const root = scene.getTransformNodeByName(old.name)!;
    expect(old.isDisposed()).toBe(true);
    expect(root).not.toBe(old);
    for (const column of root.getChildMeshes()) {
      column.computeWorldMatrix(true);
      const bounds = column.getBoundingInfo().boundingBox;
      expect(bounds.minimumWorld.y).toBeCloseTo(5);
      expect(bounds.maximumWorld.y).toBeCloseTo(6);
      expect(column.material).toBe(material);
    }
    views.update([actor]);
    expect(scene.getTransformNodeByName(root.name)).toBe(root);
    views.dispose();
  } finally {
    engine.dispose();
  }
});

test("shares one material per definition until disposal", () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  try {
    const map = new TerrainMap({ width: 6, height: 6, tileSize: 1 });
    const views = createTilePlacedActorViewRegistry(
      scene,
      map,
      [definition],
      new Map([[definition.id, { height: 1, color: [0.2, 0.4, 0.6] }]]),
    );
    views.update([
      createTilePlacedActor(map, definition, {
        actorId: "first",
        origin: { x: 0, z: 0 },
      }),
      createTilePlacedActor(map, definition, {
        actorId: "second",
        origin: { x: 3, z: 3 },
      }),
    ]);
    const shared = scene.getMeshByName(
      "tile-placed-actor-first-tile-0-0",
    )!.material;
    expect(
      scene.getMeshByName("tile-placed-actor-second-tile-3-3")!.material,
    ).toBe(shared);
    views.update([]);
    expect(scene.materials).toContain(shared);
    views.dispose();
    expect(scene.materials).not.toContain(shared);
  } finally {
    engine.dispose();
  }
});
