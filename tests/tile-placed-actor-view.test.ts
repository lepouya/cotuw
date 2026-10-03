import { NullEngine, Scene } from "@babylonjs/core";
import { expect, test } from "vitest";
import { TerrainMap } from "../src/map";
import { createTilePlacedActor } from "../src/simulation/placement";
import { createTilePlacedActorViewRegistry } from "../src/render/tile-placed-actor-view";
import { createCommandCenterDetails } from "../src/render/command-center";
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
    const oldMesh = old.getChildMeshes()[0]!;
    views.update([
      createTilePlacedActor(map, definition, {
        actorId: "object",
        origin: { x: 3, z: 3 },
        quarterTurns: 1,
      }),
    ]);
    expect(old.isDisposed()).toBe(true);
    expect(views.actorIdForMesh(oldMesh)).toBeUndefined();
    expect(
      scene.getMeshByName("tile-placed-actor-object-tile-4-3"),
    ).not.toBeNull();
    views.dispose();
  } finally {
    engine.dispose();
  }
});

test("refreshes affected buildings and selection after a terrain edit", () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  try {
    const map = new TerrainMap({ width: 8, height: 8, tileSize: 1 });
    const views = createTilePlacedActorViewRegistry(
      scene,
      map,
      [definition],
      new Map(),
    );
    const actors = [
      createTilePlacedActor(map, definition, {
        actorId: "near",
        origin: { x: 1, z: 1 },
      }),
      createTilePlacedActor(map, definition, {
        actorId: "far",
        origin: { x: 5, z: 5 },
      }),
    ];
    views.update(actors);
    views.setSelectedActor("near");
    const near = scene.getTransformNodeByName("tile-placed-actor-near-root")!;
    const far = scene.getTransformNodeByName("tile-placed-actor-far-root")!;
    const selection = scene.getMeshByName("building-selection-outline")!;
    map.setHeight(1, 1, 0.5);
    // Placed actor membership has not changed, so only animation is called.
    views.animate(0);
    expect(near.isDisposed()).toBe(true);
    expect(selection.isDisposed()).toBe(true);
    expect(scene.getTransformNodeByName(far.name)).toBe(far);
    expect(far.isDisposed()).toBe(false);
    const column = scene.getMeshByName("tile-placed-actor-near-tile-1-1")!;
    column.computeWorldMatrix(true);
    expect(column.getBoundingInfo().boundingBox.maximumWorld.y).toBeCloseTo(2);
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

test("picks articulated buildings and animates without changing actor state", () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  try {
    const map = new TerrainMap({ width: 6, height: 6, tileSize: 0.5 });
    const square: ActorDefinition = {
      ...definition,
      footprint: {
        ...definition.footprint!,
        occupiedTiles: [
          { x: 0, z: 0 },
          { x: 1, z: 0 },
          { x: 0, z: 1 },
          { x: 1, z: 1 },
        ],
      },
    };
    const views = createTilePlacedActorViewRegistry(
      scene,
      map,
      [square],
      new Map([
        [
          square.id,
          {
            height: 0.15,
            color: [0.2, 0.4, 0.6],
            createDetails: createCommandCenterDetails,
          },
        ],
      ]),
    );
    const actor = createTilePlacedActor(map, square, {
      actorId: "command-center",
      origin: { x: 3, z: 3 },
      quarterTurns: 1,
    });
    const before = structuredClone(actor);
    views.update([actor]);
    const root = scene.getTransformNodeByName(
      "tile-placed-actor-command-center-root",
    )!;
    const assembly = scene.getTransformNodeByName(`${root.name}-assembly`)!;
    expect(assembly.scaling.x).toBe(0.5);
    expect(assembly.rotation.y).toBe(Math.PI / 2);
    for (const mesh of root.getChildMeshes()) {
      expect(views.actorIdForMesh(mesh)).toBe(actor.id);
      mesh.computeWorldMatrix(true);
      const bounds = mesh.getBoundingInfo().boundingBox;
      expect(bounds.minimumWorld.x).toBeGreaterThanOrEqual(0);
      expect(bounds.maximumWorld.x).toBeLessThanOrEqual(1);
      expect(bounds.minimumWorld.z).toBeGreaterThanOrEqual(-0.5);
      expect(bounds.maximumWorld.z).toBeLessThanOrEqual(0.5);
    }
    const radar = scene.getTransformNodeByName(`${root.name}-radar`)!;
    views.animate(2);
    expect(radar.rotation.y).toBeCloseTo(0.9);
    expect(actor).toEqual(before);
    views.setSelectedActor(actor.id);
    expect(scene.getMeshByName("building-selection-outline")).not.toBeNull();
    const materials = scene.materials.length;
    views.update([]);
    expect(radar.isDisposed()).toBe(true);
    expect(scene.getMeshByName("building-selection-outline")).toBeNull();
    expect(scene.materials.length).toBeLessThan(materials);
    views.dispose();
  } finally {
    engine.dispose();
  }
});

test("preview models tolerate map edges and keep placed materials opaque", () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  try {
    const map = new TerrainMap({ width: 6, height: 6, tileSize: 1 });
    const appearances = new Map([
      [
        definition.id,
        {
          height: 0.3,
          color: [0.2, 0.4, 0.6] as [number, number, number],
          createDetails: createCommandCenterDetails,
        },
      ],
    ]);
    const placed = createTilePlacedActorViewRegistry(
      scene,
      map,
      [definition],
      appearances,
    );
    const preview = createTilePlacedActorViewRegistry(
      scene,
      map,
      [definition],
      appearances,
      { preview: true },
    );
    placed.update([
      createTilePlacedActor(map, definition, {
        actorId: "placed",
        origin: { x: 2, z: 2 },
      }),
    ]);
    preview.update([
      createTilePlacedActor(map, definition, {
        actorId: "preview",
        origin: { x: 0, z: 0 },
        quarterTurns: 1,
      }),
    ]);
    const root = scene.getTransformNodeByName(
      "tile-placed-actor-preview-root",
    )!;
    for (const mesh of root.getChildMeshes()) {
      expect(mesh.material!.alpha).toBe(0.42);
      expect(mesh.isPickable).toBe(false);
      expect(preview.actorIdForMesh(mesh)).toBeUndefined();
      mesh.computeWorldMatrix(true);
      expect(
        mesh
          .getBoundingInfo()
          .boundingBox.minimumWorld.asArray()
          .every(Number.isFinite),
      ).toBe(true);
    }
    preview.dispose();
    expect(root.isDisposed()).toBe(true);
    const building = scene.getTransformNodeByName(
      "tile-placed-actor-placed-root",
    )!;
    expect(building.isDisposed()).toBe(false);
    for (const mesh of building.getChildMeshes())
      expect(mesh.material!.alpha).toBe(1);
    placed.dispose();
  } finally {
    engine.dispose();
  }
});

test("details share materials per definition until disposal", () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  try {
    const map = new TerrainMap({ width: 8, height: 8, tileSize: 1 });
    const views = createTilePlacedActorViewRegistry(
      scene,
      map,
      [definition],
      new Map([
        [
          definition.id,
          {
            height: 0.3,
            color: [0.2, 0.4, 0.6] as [number, number, number],
            createDetails: createCommandCenterDetails,
          },
        ],
      ]),
    );
    const place = (actorId: string, x: number) =>
      createTilePlacedActor(map, definition, {
        actorId,
        origin: { x, z: 2 },
      });
    views.update([place("first", 1)]);
    const materials = scene.materials.length;
    views.update([place("first", 1), place("second", 4)]);
    expect(scene.materials.length).toBe(materials);
    const canopy = (actorId: string) =>
      scene.getMeshByName(`tile-placed-actor-${actorId}-root-entry-canopy`)!
        .material;
    expect(canopy("second")).toBe(canopy("first"));
    const shared = canopy("first")!;
    views.update([]);
    expect(scene.materials).toContain(shared);
    views.dispose();
    expect(scene.materials).not.toContain(shared);
  } finally {
    engine.dispose();
  }
});

test("offline buildings dim locally, stop machinery, and restore shared materials", () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  try {
    const map = new TerrainMap({ width: 8, height: 8, tileSize: 1 });
    const views = createTilePlacedActorViewRegistry(
      scene,
      map,
      [definition],
      new Map([
        [
          definition.id,
          {
            height: 0.3,
            color: [0.2, 0.4, 0.6],
            createDetails: createCommandCenterDetails,
          },
        ],
      ]),
    );
    const actors = [1, 4].map((x, i) =>
      createTilePlacedActor(map, definition, {
        actorId: `building-${i}`,
        origin: { x, z: 2 },
      }),
    );
    views.update(actors);
    const materialCount = scene.materials.length;
    views.update(actors, new Set(["building-0"]));
    const offline = scene.getMeshByName(
      "tile-placed-actor-building-0-root-front-windows",
    )!;
    const live = scene.getMeshByName(
      "tile-placed-actor-building-1-root-front-windows",
    )!;
    expect(offline.material).not.toBe(live.material);
    expect(
      scene.getMeshByName("tile-placed-actor-building-0-root-offline"),
    ).not.toBeNull();
    views.animate(3);
    expect(
      scene.getTransformNodeByName("tile-placed-actor-building-0-root-radar")!
        .rotation.y,
    ).toBe(0);
    expect(
      scene.getTransformNodeByName("tile-placed-actor-building-1-root-radar")!
        .rotation.y,
    ).toBeGreaterThan(0);
    views.update(actors, new Set());
    expect(
      scene.getMeshByName("tile-placed-actor-building-0-root-offline"),
    ).toBeNull();
    expect(scene.materials.length).toBe(materialCount);
    expect(scene.getMeshByName(offline.name)!.material).toBe(live.material);
    views.dispose();
  } finally {
    engine.dispose();
  }
});
