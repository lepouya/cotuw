import { describe, expect, test, vi } from "vitest";

import { TerrainGrid } from "../src/simulation/terrain";
import { OccupancyGrid } from "../src/simulation/occupancy";
import { createActor } from "../src/simulation/actor";
import {
  createMissionSimulation,
  createMissionState,
} from "../src/simulation/mission";
import {
  findNavigationPath,
  NavigationGrid,
  segmentCost,
} from "../src/simulation/navigation";
import { createTerrainMoveBehavior } from "../src/simulation/terrain-movement";

import type { Actor, ActorDefinition } from "../src/simulation/actor";
import type { PlaceActorCommand } from "../src/simulation/command";
import type {
  Footprint,
  FootprintPlacement,
} from "../src/simulation/occupancy";
import type { MovementProfile } from "../src/simulation/navigation";

const ground: MovementProfile = {
  id: "ground",
  maxSlope: 1,
  slopeCostAtLimit: 1,
  terrainCosts: { plain: 1, rough: 10 },
};

const blocking2x2: Footprint = {
  layer: "surface",
  occupiedTiles: [
    { x: 1, z: 1 },
    { x: 0, z: 0 },
    { x: 1, z: 0 },
    { x: 0, z: 1 },
  ],
  blocksMovement: true,
};

const placedDefinitions: readonly ActorDefinition[] = [
  {
    id: "barracks",
    behaviorId: "idle",
    footprint: blocking2x2,
    placement: { terrainTypeIds: ["plain"], maxSlope: 1 },
  },
  {
    id: "post",
    behaviorId: "idle",
    footprint: {
      layer: "surface",
      occupiedTiles: [{ x: 0, z: 0 }],
      blocksMovement: true,
    },
    placement: { terrainTypeIds: ["plain"], maxSlope: 1 },
  },
];

function placement(
  ownerId: string,
  x: number,
  z: number,
  footprint: Footprint = blocking2x2,
): FootprintPlacement {
  return { ownerId, origin: { x, z }, footprint };
}

function place(
  actorId: string,
  definitionId: "barracks" | "post",
  x: number,
  z: number,
): PlaceActorCommand {
  return { kind: "place-actor", actorId, definitionId, origin: { x, z } };
}

describe("footprint occupancy", () => {
  test("places and looks up a multi-tile footprint by stable owner ID", () => {
    const map = new TerrainGrid({ width: 5, height: 5, tileSize: 1 });
    const occupancy = new OccupancyGrid(map);

    expect(occupancy.place(placement("command-center", 1, 2))).toBe(true);

    expect(occupancy.ownerAt(1, 2, "surface")).toBe("command-center");
    expect(occupancy.ownerAt(2, 3, "surface")).toBe("command-center");
    expect(occupancy.ownerAt(2, 3, "air")).toBeUndefined();
    expect(map.navigationChanges.since(0)).toEqual([
      { minX: 1, minZ: 2, maxX: 2, maxZ: 3 },
    ]);
    expect(occupancy.placementByOwnerId("command-center")).toEqual(
      placement("command-center", 1, 2),
    );
  });

  test("rejects overlaps and map-edge violations atomically", () => {
    const map = new TerrainGrid({ width: 4, height: 4, tileSize: 1 });
    const occupancy = new OccupancyGrid(map);
    expect(occupancy.place(placement("first", 1, 1))).toBe(true);
    const version = map.navigationChanges.version;

    expect(occupancy.place(placement("overlap", 2, 2))).toBe(false);
    expect(occupancy.place(placement("off-map", 3, 3))).toBe(false);

    expect(occupancy.placementByOwnerId("overlap")).toBeUndefined();
    expect(occupancy.placementByOwnerId("off-map")).toBeUndefined();
    expect(occupancy.ownerAt(2, 2, "surface")).toBe("first");
    expect(occupancy.ownerAt(3, 3, "surface")).toBeUndefined();
    expect(map.navigationChanges.version).toBe(version);
  });

  test("removes only the footprint with the requested stable owner ID", () => {
    const map = new TerrainGrid({ width: 6, height: 3, tileSize: 1 });
    const occupancy = new OccupancyGrid(map);
    occupancy.place(placement("left", 0, 0));
    occupancy.place(placement("right", 4, 0));

    expect(occupancy.remove("left")).toBe(true);
    expect(occupancy.remove("missing")).toBe(false);

    expect(occupancy.ownerAt(0, 0, "surface")).toBeUndefined();
    expect(occupancy.ownerAt(4, 0, "surface")).toBe("right");
    expect(occupancy.placementByOwnerId("right")).toBeDefined();
    expect(map.navigationChanges.since(2)).toEqual([
      { minX: 0, minZ: 0, maxX: 1, maxZ: 1 },
    ]);
  });

  test.each([
    { ownerId: "" },
    { ownerId: 1 },
    { origin: { x: 1.5, z: 1 } },
    { origin: null },
    { footprint: null },
    { footprint: { ...blocking2x2, occupiedTiles: [] } },
    { footprint: { ...blocking2x2, occupiedTiles: Array(1) } },
    { footprint: { ...blocking2x2, layer: "invalid" } },
    { footprint: { ...blocking2x2, blocksMovement: "yes" } },
    { footprint: { ...blocking2x2, occupiedTiles: [{ x: 0.5, z: 0 }] } },
    { footprint: { ...blocking2x2, occupiedTiles: [null] } },
    {
      footprint: {
        ...blocking2x2,
        occupiedTiles: [
          { x: 0, z: 0 },
          { x: 0, z: 0 },
        ],
      },
    },
    {
      origin: { x: 1.5, z: 1 },
      footprint: {
        ...blocking2x2,
        occupiedTiles: [{ x: 0.5, z: 0 }],
      },
    },
  ])("rejects malformed raw placement atomically: %j", (change) => {
    const map = new TerrainGrid({ width: 5, height: 5, tileSize: 1 });
    const occupancy = new OccupancyGrid(map);
    const first = placement("first", 0, 0);
    occupancy.place(first);
    const version = map.navigationChanges.version;
    const malformed = {
      ...placement("invalid", 2, 2),
      ...change,
    } as FootprintPlacement;

    expect(occupancy.canPlace(malformed)).toBe(false);
    expect(occupancy.place(malformed)).toBe(false);
    expect(map.navigationChanges.version).toBe(version);
    expect(occupancy.placementByOwnerId("first")).toEqual(first);
    expect(occupancy.ownerAt(2, 2, "surface")).toBeUndefined();
    expect(
      occupancy.occupiedWithin({ minX: 0, minZ: 0, maxX: 1, maxZ: 1 }),
    ).toBe(true);
  });

  test.each([null, undefined])("rejects missing raw placement: %s", (value) => {
    const map = new TerrainGrid({ width: 2, height: 2, tileSize: 1 });
    const occupancy = new OccupancyGrid(map);
    expect(occupancy.canPlace(value as unknown as FootprintPlacement)).toBe(
      false,
    );
    expect(occupancy.place(value as unknown as FootprintPlacement)).toBe(false);
    expect(map.navigationChanges.version).toBe(0);
  });

  test("constructing or replacing an index installs no terrain constraints", () => {
    const map = new TerrainGrid({ width: 5, height: 5, tileSize: 1 });
    const old = new OccupancyGrid(map);
    old.place(placement("old", 1, 1));
    const replacement = new OccupancyGrid(map);

    expect(replacement.ownerAt(1, 1, "surface")).toBeUndefined();
    expect(
      map.isValidTerrainEdit({ heights: [{ x: 1, z: 1, height: 1 }] }),
    ).toBe(true);
  });

  test("occupancy and navigation are independent of insertion order", () => {
    const placements = [placement("left", 1, 1), placement("right", 4, 1)];
    const build = (order: FootprintPlacement[]) => {
      const map = new TerrainGrid({ width: 7, height: 5, tileSize: 1 });
      const occupancy = new OccupancyGrid(map);
      for (const entry of order) expect(occupancy.place(entry)).toBe(true);
      const grid = new NavigationGrid(map, occupancy, ground);
      const lookup = () =>
        Array.from({ length: map.width * map.height }, (_, index) =>
          occupancy.ownerAt(
            index % map.width,
            Math.floor(index / map.width),
            "surface",
          ),
        );
      const path = () =>
        findNavigationPath(grid, map.tileCenter(0, 2), map.tileCenter(6, 2));
      const before = { owners: lookup(), path: path() };
      occupancy.remove("left");
      return { before, after: { owners: lookup(), path: path() } };
    };

    expect(build(placements)).toEqual(build([...placements].reverse()));
  });
});

describe("occupancy navigation", () => {
  test.each(["nonblocking", "other-layer"])(
    "preserves connected-region caches for %s changes",
    (kind) => {
      const map = new TerrainGrid({ width: 5, height: 3, tileSize: 1 });
      const occupancy = new OccupancyGrid(map);
      const grid = new NavigationGrid(map, occupancy, ground);
      const costs = vi.spyOn(grid, "costAt");
      const region = grid.regionAt(0, 0);
      costs.mockClear();
      occupancy.place(
        placement("irrelevant", 2, 1, {
          layer: kind === "other-layer" ? "air" : "surface",
          occupiedTiles: [{ x: 0, z: 0 }],
          blocksMovement: kind === "other-layer",
        }),
      );
      expect(grid.regionAt(0, 0)).toBe(region);
      expect(costs).not.toHaveBeenCalled();
      occupancy.remove("irrelevant");
      expect(grid.regionAt(0, 0)).toBe(region);
      expect(costs).not.toHaveBeenCalled();

      map.setTerrain(2, 1, { typeId: "plain", surfacePassable: false });
      expect(grid.regionAt(2, 1)).toBe(-1);
      expect(costs).toHaveBeenCalled();
      costs.mockClear();
      map.navigationChanges.restart(map.navigationChanges.version);
      grid.regionAt(0, 0);
      expect(costs).toHaveBeenCalled();
    },
  );
  test("avoids occupied tiles and occupied diagonal corners", () => {
    const map = new TerrainGrid({ width: 5, height: 5, tileSize: 1 });
    const occupancy = new OccupancyGrid(map);
    occupancy.place(
      placement("post", 2, 2, {
        layer: "surface",
        occupiedTiles: [{ x: 0, z: 0 }],
        blocksMovement: true,
      }),
    );
    const grid = new NavigationGrid(map, occupancy, ground);
    const from = map.tileCenter(0, 2);
    const path = findNavigationPath(grid, from, map.tileCenter(4, 2))!;
    const points = [from, ...path.waypoints];

    expect(path.reachedTarget).toBe(true);
    for (let index = 1; index < points.length; index += 1) {
      expect(
        segmentCost(grid, points[index - 1]!, points[index]!),
      ).toBeDefined();
    }

    const cornerMap = new TerrainGrid({ width: 3, height: 3, tileSize: 1 });
    const cornerOccupancy = new OccupancyGrid(cornerMap);
    cornerOccupancy.place(
      placement("corner", 1, 0, {
        layer: "surface",
        occupiedTiles: [{ x: 0, z: 0 }],
        blocksMovement: true,
      }),
    );
    const cornerGrid = new NavigationGrid(cornerMap, cornerOccupancy, ground);
    const cornerPath = findNavigationPath(
      cornerGrid,
      cornerMap.tileCenter(0, 0),
      cornerMap.tileCenter(1, 1),
    )!;

    expect(cornerPath.waypoints).toContainEqual(cornerMap.tileCenter(0, 1));
  });

  test("resolves an occupied target to the closest reachable tile", () => {
    const map = new TerrainGrid({ width: 5, height: 3, tileSize: 1 });
    const occupancy = new OccupancyGrid(map);
    occupancy.place(
      placement("target", 2, 1, {
        layer: "surface",
        occupiedTiles: [{ x: 0, z: 0 }],
        blocksMovement: true,
      }),
    );

    const path = findNavigationPath(
      new NavigationGrid(map, occupancy, ground),
      map.tileCenter(0, 1),
      map.tileCenter(2, 1),
    );

    expect(path).toMatchObject({
      reachedTarget: false,
      destination: map.tileCenter(1, 1),
    });
  });

  test("keeps non-blocking and other-layer occupancy traversable", () => {
    const map = new TerrainGrid({ width: 3, height: 1, tileSize: 1 });
    const occupancy = new OccupancyGrid(map);
    occupancy.place(
      placement("marker", 1, 0, {
        layer: "surface",
        occupiedTiles: [{ x: 0, z: 0 }],
        blocksMovement: false,
      }),
    );
    occupancy.place(
      placement("air-blocker", 2, 0, {
        layer: "air",
        occupiedTiles: [{ x: 0, z: 0 }],
        blocksMovement: true,
      }),
    );

    const path = findNavigationPath(
      new NavigationGrid(map, occupancy, ground, "surface"),
      map.tileCenter(0, 0),
      map.tileCenter(2, 0),
    );

    expect(path?.reachedTarget).toBe(true);
  });

  test("replans an active route after footprint placement and removal", () => {
    const map = new TerrainGrid({ width: 7, height: 3, tileSize: 1 });
    const occupancy = new OccupancyGrid(map);
    const simulation = movementMission(map, occupancy, actorAt(map, 0, 1), 0.5);
    simulation.submitCommand({
      kind: "move",
      actorId: "trooper",
      target: map.tileCenter(6, 1),
    });
    simulation.tick();
    simulation.submitCommand(place("post-1", "post", 3, 1));

    simulation.tick();
    const detouring = simulation.actorById("trooper")!;
    expect(detouring.worldPosition.z).not.toBe(0);
    const distanceFromCenter = Math.abs(detouring.worldPosition.z);

    simulation.submitCommand({
      kind: "remove-actor",
      actorId: "post-1",
    });
    simulation.tick();
    const shortened = simulation.actorById("trooper")!;
    expect(Math.abs(shortened.worldPosition.z)).toBeLessThan(
      distanceFromCenter,
    );
    expect(shortened.movement?.navigationVersion).toBe(
      map.navigationChanges.version,
    );
  });

  test("does not replan a complete route for a distant change", () => {
    const map = new TerrainGrid({ width: 9, height: 5, tileSize: 1 });
    const occupancy = new OccupancyGrid(map);
    const actor = actorAt(map, 0, 2);
    actor.movement = {
      target: map.tileCenter(8, 2),
      destination: map.tileCenter(8, 2),
      reachedTarget: true,
      waypoints: [map.tileCenter(0, 3), map.tileCenter(8, 2)],
      waypointIndex: 0,
      navigationVersion: map.navigationChanges.version,
      occupancyLayer: "surface",
    };
    const simulation = movementMission(map, occupancy, actor, 0.25);
    occupancy.place(
      placement("distant", 8, 0, {
        layer: "surface",
        occupiedTiles: [{ x: 0, z: 0 }],
        blocksMovement: true,
      }),
    );

    simulation.tick();

    const moving = simulation.actorById("trooper")!;
    expect(moving.worldPosition.z).toBeGreaterThan(0);
    expect(moving.movement?.navigationVersion).toBe(
      map.navigationChanges.version,
    );
  });

  test("does not replan a surface route for an air-layer change", () => {
    const map = new TerrainGrid({ width: 9, height: 5, tileSize: 1 });
    const occupancy = new OccupancyGrid(map);
    const actor = actorAt(map, 0, 2);
    actor.movement = {
      target: map.tileCenter(8, 2),
      destination: map.tileCenter(8, 2),
      reachedTarget: true,
      waypoints: [map.tileCenter(0, 3), map.tileCenter(8, 2)],
      waypointIndex: 0,
      navigationVersion: map.navigationChanges.version,
      occupancyLayer: "surface",
    };
    const simulation = movementMission(map, occupancy, actor, 0.25);
    occupancy.place(
      placement("air-change", 4, 2, {
        layer: "air",
        occupiedTiles: [{ x: 0, z: 0 }],
        blocksMovement: true,
      }),
    );

    simulation.tick();

    expect(simulation.actorById("trooper")!.worldPosition.z).toBeGreaterThan(0);
  });

  test("replans when removal opens a shorter distant gateway", () => {
    const map = new TerrainGrid({
      width: 17,
      height: 11,
      tileSize: 1,
      createTerrain: (x, z) => ({
        typeId: "plain",
        surfacePassable: x === 8 && z !== 0 && z !== 5 ? false : undefined,
      }),
    });
    const occupancy = new OccupancyGrid(map);
    const simulation = movementMission(
      map,
      occupancy,
      actorAt(map, 0, 5),
      0.25,
    );
    simulation.submitCommand(place("gate", "post", 8, 5));
    simulation.submitCommand({
      kind: "move",
      actorId: "trooper",
      target: map.tileCenter(16, 5),
    });
    simulation.tick();
    expect(
      simulation
        .actorById("trooper")!
        .movement?.waypoints?.some(({ z }) => z !== 0) ?? false,
    ).toBe(true);

    simulation.submitCommand({ kind: "remove-actor", actorId: "gate" });
    simulation.tick();

    expect(
      simulation
        .actorById("trooper")!
        .movement?.waypoints?.every(({ z }) => z === 0) ?? false,
    ).toBe(true);
  });

  test("replans when removal opens a longer but faster gateway", () => {
    const map = new TerrainGrid({
      width: 17,
      height: 11,
      tileSize: 1,
      createTerrain: (x, z) => ({
        typeId: x >= 6 && x <= 10 && z !== 0 ? "rough" : "plain",
        surfacePassable: x === 8 && z !== 0 && z !== 5 ? false : undefined,
      }),
    });
    const occupancy = new OccupancyGrid(map);
    const simulation = movementMission(
      map,
      occupancy,
      actorAt(map, 0, 5),
      0.25,
    );
    simulation.submitCommand(place("gate", "post", 8, 0));
    simulation.submitCommand({
      kind: "move",
      actorId: "trooper",
      target: map.tileCenter(16, 5),
    });
    simulation.tick();
    const lowestWaypoint = () =>
      Math.min(
        ...simulation
          .actorById("trooper")!
          .movement!.waypoints!.map(({ z }) => z),
      );
    expect(lowestWaypoint()).toBeGreaterThan(map.tileCenter(0, 1).z);

    simulation.submitCommand({ kind: "remove-actor", actorId: "gate" });
    simulation.tick();

    expect(lowestWaypoint()).toBeLessThan(map.tileCenter(0, 1).z);
  });

  test("replans a route planned on another occupancy layer", () => {
    const map = new TerrainGrid({ width: 5, height: 3, tileSize: 1 });
    const occupancy = new OccupancyGrid(map);
    occupancy.place(
      placement("air-blocker", 2, 1, {
        layer: "air",
        occupiedTiles: [{ x: 0, z: 0 }],
        blocksMovement: true,
      }),
    );
    const behavior = createTerrainMoveBehavior(map, occupancy, [ground]);
    const definition: ActorDefinition = {
      id: "trooper",
      behaviorId: "terrain-move",
      movement: { speed: 0.25, profileId: ground.id },
    };
    const actor = actorAt(map, 0, 1);
    const row = map.tileCenter(0, 1).z;
    behavior.handleCommand(actor, definition, {
      kind: "move",
      actorId: actor.id,
      target: map.tileCenter(4, 1),
    });
    expect(actor.movement?.waypoints?.every(({ z }) => z === row)).toBe(true);

    actor.occupancyLayer = "air";
    behavior.update(actor, definition, 0.25);

    expect(actor.movement?.occupancyLayer).toBe("air");
    expect(actor.movement?.waypoints?.some(({ z }) => z !== row)).toBe(true);
  });

  test("round-trips mission occupancy and its navigation version", () => {
    const map = new TerrainGrid({ width: 5, height: 3, tileSize: 1 });
    const occupancy = new OccupancyGrid(map);
    const original = movementMission(map, occupancy, actorAt(map, 0, 1), 0.25);
    original.submitCommand(place("barracks-1", "barracks", 2, 0));
    expect(original.tick()[0]?.accepted).toBe(true);

    const saved = JSON.parse(JSON.stringify(original.snapshot()));
    const restoredMap = new TerrainGrid({ width: 5, height: 3, tileSize: 1 });
    const restoredOccupancy = new OccupancyGrid(restoredMap);
    const restored = movementMission(
      restoredMap,
      restoredOccupancy,
      actorAt(restoredMap, 0, 1),
      0.25,
      saved,
    );

    expect(restored.snapshot()).toEqual(original.snapshot());
    expect(restoredOccupancy.ownerAt(3, 1, "surface")).toBe("barracks-1");
  });
});

function actorAt(map: TerrainGrid, x: number, z: number): Actor {
  return createActor({
    id: "trooper",
    definitionId: "trooper",
    owner: "player",
    worldPosition: map.tileCenter(x, z),
  });
}

function movementMission(
  map: TerrainGrid,
  occupancy: OccupancyGrid,
  actor: Actor,
  speed: number,
  state = createMissionState([actor]),
) {
  return createMissionSimulation({
    state,
    behaviorRegistry: new Map([
      ["terrain-move", createTerrainMoveBehavior(map, occupancy, [ground])],
      ["idle", { handleCommand: () => false, update: () => {} }],
    ]),
    bounds: map.worldBounds,
    definitions: [
      {
        id: "trooper",
        behaviorId: "terrain-move",
        movement: { speed, profileId: ground.id },
      },
      ...placedDefinitions,
    ],
    tickSeconds: 1,
    map,
    occupancy,
  });
}
