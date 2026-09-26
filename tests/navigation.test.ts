import { describe, expect, test } from "vitest";

import { TerrainMap } from "../src/map";
import { createActor } from "../src/simulation/actor";
import {
  createMissionSimulation,
  createMissionState,
} from "../src/simulation/mission";
import {
  findNavigationPath,
  forEachTileOnSegment,
  NavigationGrid,
  occupiedTile,
  segmentCost,
  traversalCostAt,
} from "../src/simulation/navigation";
import {
  advanceAlongSegment,
  createTerrainMoveBehavior,
} from "../src/simulation/terrain-movement";

import type { TerrainTile } from "../src/map";
import type { ActorBehavior } from "../src/simulation/actor";
import type { TerrainCommand } from "../src/simulation/command";
import type { MissionState } from "../src/simulation/mission";
import type { MovementProfile } from "../src/simulation/navigation";

const ground: MovementProfile = {
  id: "ground",
  maxSlope: 0.75,
  slopeCostAtLimit: 2,
  terrainCosts: { plain: 1, path: 0.75, rough: 3, water: null },
};

function center(map: TerrainMap, x: number, z: number) {
  return map.tileCenter(x, z);
}

describe("terrain traversal", () => {
  test("combines terrain type, authored overrides, and slope", () => {
    const tiles: TerrainTile[] = [
      { typeId: "plain" },
      { typeId: "plain" },
      { typeId: "water" },
    ];
    const map = new TerrainMap({
      width: 3,
      height: 1,
      tileSize: 1,
      createHeight: (x) => (x >= 2 ? 2 : 0),
      createTerrain: (x) => tiles[x]!,
      terrainTypeIds: ["plain", "water", "unpriced"],
    });

    expect(traversalCostAt(map, ground, 0, 0)).toBe(1);
    expect(traversalCostAt(map, ground, 1, 0)).toBeUndefined();
    expect(traversalCostAt(map, ground, 2, 0)).toBeUndefined();

    map.setTerrain(1, 0, { typeId: "plain", surfacePassable: true });
    expect(traversalCostAt(map, ground, 1, 0)).toBe(2);
    map.setTerrain(1, 0, { typeId: "unpriced", outOfBounds: true });
    expect(traversalCostAt(map, ground, 1, 0)).toBeUndefined();
  });

  test("chooses a longer clear route over expensive rough terrain", () => {
    const map = new TerrainMap({
      width: 5,
      height: 3,
      tileSize: 1,
      createTerrain: (x, z) => ({
        typeId: z === 1 && x > 0 && x < 4 ? "rough" : "plain",
      }),
    });

    const path = findNavigationPath(
      new NavigationGrid(map, ground),
      center(map, 0, 1),
      center(map, 4, 1),
    );

    expect(path?.reachedTarget).toBe(true);
    expect(
      path?.waypoints.some(
        (point) => map.tileAtWorldPosition(point.x, point.z).z !== 1,
      ),
    ).toBe(true);
  });

  test("approaches the closest reachable tile for a blocked target", () => {
    const map = new TerrainMap({
      width: 5,
      height: 3,
      tileSize: 1,
      createTerrain: (x) => ({
        typeId: "plain",
        surfacePassable: x === 2 ? false : undefined,
      }),
    });

    const path = findNavigationPath(
      new NavigationGrid(map, ground),
      center(map, 0, 1),
      center(map, 4, 1),
    );

    expect(path).toMatchObject({
      destination: center(map, 1, 1),
      reachedTarget: false,
    });
  });

  test("straightens a route across open ground into one segment", () => {
    const map = new TerrainMap({ width: 9, height: 9, tileSize: 1 });

    const path = findNavigationPath(
      new NavigationGrid(map, ground),
      center(map, 0, 0),
      center(map, 6, 3),
    );

    expect(path?.waypoints).toEqual([center(map, 6, 3)]);
  });

  test("keeps straightened segments off blocked tiles and corners", () => {
    const map = new TerrainMap({
      width: 7,
      height: 7,
      tileSize: 1,
      createTerrain: (x, z) => ({
        typeId: "plain",
        surfacePassable: x === 3 && z < 5 ? false : undefined,
      }),
    });
    const grid = new NavigationGrid(map, ground);
    const from = center(map, 1, 1);

    const path = findNavigationPath(grid, from, center(map, 5, 1))!;

    expect(path.reachedTarget).toBe(true);
    const points = [from, ...path.waypoints];
    for (let index = 1; index < points.length; index += 1) {
      expect(
        segmentCost(grid, points[index - 1]!, points[index]!),
      ).toBeDefined();
    }
    expect(path.waypoints.length).toBeLessThan(8);
  });

  test("does not escape through a blocked tile it only touches", () => {
    const map = new TerrainMap({
      width: 5,
      height: 3,
      tileSize: 1,
      createTerrain: (x, z) => ({
        typeId: x === 2 && z === 1 ? "water" : "plain",
      }),
    });
    const grid = new NavigationGrid(map, ground);
    // On the shared edge between plain tile (1, 1) and water tile (2, 1).
    const from = { x: -0.5, z: 0 };

    const path = findNavigationPath(grid, from, center(map, 4, 1))!;

    expect(occupiedTile(grid, from)).toEqual({ x: 1, z: 1 });
    const points = [from, ...path.waypoints];
    for (let index = 1; index < points.length; index += 1) {
      expect(
        segmentCost(grid, points[index - 1]!, points[index]!),
      ).toBeDefined();
    }
  });

  test("visits both side tiles where a segment crosses a tile corner", () => {
    const map = new TerrainMap({ width: 3, height: 3, tileSize: 1 });
    const visited: string[] = [];

    forEachTileOnSegment(map, center(map, 0, 0), center(map, 1, 1), (x, z) => {
      visited.push(`${x},${z}`);
    });

    expect(visited).toEqual(["0,0", "1,0", "0,1", "1,1"]);
  });

  test("resolves a target in another region without searching for it", () => {
    const map = new TerrainMap({
      width: 5,
      height: 3,
      tileSize: 1,
      createTerrain: (x) => ({ typeId: x === 2 ? "water" : "plain" }),
    });
    const grid = new NavigationGrid(map, ground);

    expect(grid.regionAt(0, 0)).toBe(grid.regionAt(1, 2));
    expect(grid.regionAt(0, 0)).not.toBe(grid.regionAt(4, 0));
    expect(grid.regionAt(2, 1)).toBe(-1);
  });

  test("caches tile costs until the map reports a navigation change", () => {
    const map = new TerrainMap({
      width: 2,
      height: 1,
      tileSize: 1,
      terrainTypeIds: ["plain", "rough"],
    });
    const grid = new NavigationGrid(map, ground);
    expect(grid.costAt(1, 0)).toBe(1);

    map.setHeight(2, 0, 0.5);
    map.setHeight(2, 1, 0.5);
    expect(grid.costAt(1, 0)).toBe(1);
    map.notifyChange({ minX: 1, minZ: 0, maxX: 1, maxZ: 0 });
    expect(grid.costAt(1, 0)).toBeCloseTo(5 / 3);

    map.setTerrain(1, 0, { typeId: "rough" });
    expect(grid.costAt(1, 0)).toBeCloseTo(5);
  });

  test("rejects declared terrain types a profile does not price", () => {
    const map = new TerrainMap({
      width: 1,
      height: 1,
      tileSize: 1,
      terrainTypeIds: ["plain", "lava"],
    });

    expect(() => new NavigationGrid(map, ground)).toThrow(
      "has no cost for terrain lava",
    );
  });

  test("rejects maps with terrain a profile does not price", () => {
    const map = new TerrainMap({
      width: 1,
      height: 1,
      tileSize: 1,
      createTerrain: () => ({ typeId: "plains" }),
    });

    expect(() => new NavigationGrid(map, ground)).toThrow(
      "has no cost for terrain plains",
    );
  });
});

describe("terrain movement", () => {
  test("rejects a command when no meaningful progress is possible", () => {
    const map = new TerrainMap({
      width: 3,
      height: 1,
      tileSize: 1,
      createTerrain: (x) => ({
        typeId: x === 1 ? "water" : "plain",
      }),
    });
    const simulation = createMovementMission(map, 4, 1);
    simulation.submitCommand({
      kind: "move",
      actorId: "trooper",
      target: center(map, 2, 0),
    });

    const [outcome] = simulation.tick();

    expect(outcome?.accepted).toBe(false);
    expect(simulation.actorById("trooper")).not.toHaveProperty("movement");
  });

  test("keeps the current order when a new one is rejected", () => {
    const map = new TerrainMap({
      width: 4,
      height: 1,
      tileSize: 1,
      createTerrain: (x) => ({ typeId: x === 2 ? "water" : "plain" }),
    });
    const simulation = createMovementMission(map, 0.5, 0.25, 1);
    simulation.submitCommand({
      kind: "move",
      actorId: "trooper",
      target: center(map, 0, 0),
    });
    simulation.tick();
    simulation.submitCommand({
      kind: "move",
      actorId: "trooper",
      target: center(map, 3, 0),
    });

    const [outcome] = simulation.tick();

    expect(outcome?.accepted).toBe(false);
    expect(simulation.actorById("trooper")!.movement?.target).toEqual(
      center(map, 0, 0),
    );
  });

  test("rebuilds an incomplete saved route at the current map version", () => {
    const map = new TerrainMap({ width: 3, height: 1, tileSize: 1 });
    const saved = createActor({
      id: "trooper",
      definitionId: "trooper",
      worldPosition: center(map, 0, 0),
    });
    saved.movement = {
      target: center(map, 2, 0),
      navigationVersion: map.navigationChanges.version,
    };
    const simulation = createMissionSimulation({
      state: createMissionState([saved]),
      behaviorRegistry: new Map([
        ["terrain-move", createTerrainMoveBehavior(map, [ground])],
      ]),
      bounds: map.worldBounds,
      definitions: [
        {
          id: "trooper",
          behaviorId: "terrain-move",
          movement: { speed: 1, profileId: ground.id },
        },
      ],
      tickSeconds: 0.25,
    });

    expect(() => simulation.tick()).not.toThrow();
    expect(simulation.actorById("trooper")!.movement?.waypoints).toBeDefined();
  });

  test("records the reachable endpoint separately from a blocked target", () => {
    const map = new TerrainMap({
      width: 5,
      height: 3,
      tileSize: 1,
      createTerrain: (x) => ({
        typeId: "plain",
        surfacePassable: x === 2 ? false : undefined,
      }),
    });
    const simulation = createMovementMission(map, 1, 0.1, 0, 1);
    simulation.submitCommand({
      kind: "move",
      actorId: "trooper",
      target: center(map, 4, 1),
    });

    const [outcome] = simulation.tick();
    const movement = simulation.actorById("trooper")!.movement;

    expect(outcome?.accepted).toBe(true);
    expect(movement?.target).toEqual(center(map, 4, 1));
    expect(movement?.destination).toEqual(center(map, 1, 1));
    expect(movement?.reachedTarget).toBe(false);
  });

  test("moves more slowly while crossing rough terrain", () => {
    const map = new TerrainMap({
      width: 3,
      height: 1,
      tileSize: 1,
      createTerrain: (x) => ({ typeId: x === 0 ? "rough" : "plain" }),
    });
    const simulation = createMovementMission(map, 3, 0.25);
    simulation.submitCommand({
      kind: "move",
      actorId: "trooper",
      target: center(map, 2, 0),
    });

    simulation.tick();

    expect(simulation.actorById("trooper")!.worldPosition.x).toBeCloseTo(-0.75);
  });

  test("changes speed at the terrain boundary within a tick", () => {
    const map = new TerrainMap({
      width: 3,
      height: 1,
      tileSize: 1,
      createTerrain: (x) => ({ typeId: x === 0 ? "rough" : "plain" }),
    });
    const simulation = createMovementMission(map, 3, 1);
    simulation.submitCommand({
      kind: "move",
      actorId: "trooper",
      target: center(map, 2, 0),
    });

    simulation.tick();

    // Half a unit of rough terrain consumes 0.5 seconds; the plain terrain
    // traversed during the other half second contributes another 1.5 units.
    expect(simulation.actorById("trooper")!.worldPosition.x).toBeCloseTo(1);
  });

  test("replans an active route after terrain changes", () => {
    const map = new TerrainMap({ width: 5, height: 3, tileSize: 1 });
    const simulation = createMovementMission(map, 1, 1, 0, 1);
    simulation.submitCommand({
      kind: "move",
      actorId: "trooper",
      target: center(map, 4, 1),
    });
    simulation.tick();
    map.setTerrain(2, 1, { typeId: "plain", surfacePassable: false });

    simulation.tick();

    const trooper = simulation.actorById("trooper")!;
    expect(trooper.worldPosition.z).not.toBe(0);
    expect(trooper.movement?.navigationVersion).toBe(
      map.navigationChanges.version,
    );
  });

  test("does not replan a route for a distant terrain change", () => {
    const map = new TerrainMap({
      width: 9,
      height: 5,
      tileSize: 1,
      terrainTypeIds: ["plain", "path"],
    });
    const simulation = createMovementMission(map, 0.25, 1, 0, 2);
    simulation.submitCommand({
      kind: "move",
      actorId: "trooper",
      target: center(map, 8, 2),
    });
    simulation.tick();
    for (let x = 0; x < map.width; x += 1) {
      map.setTerrain(x, 0, { typeId: "path" });
    }

    simulation.tick();

    const trooper = simulation.actorById("trooper")!;
    expect(trooper.worldPosition.z).toBe(0);
    expect(trooper.movement?.navigationVersion).toBe(
      map.navigationChanges.version,
    );
  });

  test("replans an approach order when a distant change opens its target", () => {
    const map = new TerrainMap({
      width: 7,
      height: 7,
      tileSize: 1,
      createTerrain: (x) => ({ typeId: x === 5 ? "water" : "plain" }),
    });
    const simulation = createMovementMission(map, 0.25, 0.25, 0, 3);
    simulation.submitCommand({
      kind: "move",
      actorId: "trooper",
      target: center(map, 6, 3),
    });
    simulation.tick();
    expect(simulation.actorById("trooper")!.movement?.reachedTarget).toBe(
      false,
    );

    map.setTerrain(5, 6, { typeId: "plain" });
    simulation.tick();

    const movement = simulation.actorById("trooper")!.movement;
    expect(movement?.reachedTarget).toBe(true);
    expect(movement?.destination).toEqual(center(map, 6, 3));
  });

  test("finishes an approach order after an unrelated change", () => {
    const map = new TerrainMap({
      width: 5,
      height: 3,
      tileSize: 1,
      createTerrain: (x) => ({ typeId: x === 4 ? "water" : "plain" }),
    });
    const simulation = createMovementMission(map, 1, 0.25, 0, 1);
    simulation.submitCommand({
      kind: "move",
      actorId: "trooper",
      target: center(map, 4, 1),
    });
    // Eleven ticks leave the trooper inside its destination tile, short of
    // the center.
    for (let tick = 0; tick < 11; tick += 1) simulation.tick();
    map.notifyChange({ minX: 0, minZ: 2, maxX: 0, maxZ: 2 });

    simulation.tick();
    expect(simulation.actorById("trooper")!.movement?.blocked).toBeUndefined();
    simulation.tick();

    const trooper = simulation.actorById("trooper")!;
    expect(trooper.movement).toBeUndefined();
    expect(trooper.worldPosition).toEqual(center(map, 3, 1));
  });

  test("replans at once when a route meets an unexpected blocker", () => {
    const map = new TerrainMap({
      width: 5,
      height: 3,
      tileSize: 1,
      createTerrain: (x, z) => ({
        typeId: x === 2 && z === 1 ? "water" : "plain",
      }),
    });
    const saved = createActor({
      id: "trooper",
      definitionId: "trooper",
      worldPosition: center(map, 0, 1),
    });
    // A stale route straight through the water at the current map version.
    saved.movement = {
      target: center(map, 4, 1),
      destination: center(map, 4, 1),
      reachedTarget: true,
      waypoints: [center(map, 4, 1)],
      waypointIndex: 0,
      navigationVersion: map.navigationChanges.version,
    };
    const simulation = createMissionSimulation({
      state: createMissionState([saved]),
      behaviorRegistry: new Map([
        ["terrain-move", createTerrainMoveBehavior(map, [ground])],
      ]),
      bounds: map.worldBounds,
      definitions: [
        {
          id: "trooper",
          behaviorId: "terrain-move",
          movement: { speed: 2, profileId: ground.id },
        },
      ],
      tickSeconds: 1,
    });

    simulation.tick();

    const trooper = simulation.actorById("trooper")!;
    expect(trooper.movement?.blocked).toBeUndefined();
    expect(trooper.worldPosition.z).not.toBe(center(map, 0, 1).z);
  });

  test("stops a segment at the first blocked tile", () => {
    const map = new TerrainMap({
      width: 3,
      height: 1,
      tileSize: 1,
      createTerrain: (x) => ({ typeId: x === 2 ? "water" : "plain" }),
    });

    const step = advanceAlongSegment(
      new NavigationGrid(map, ground),
      center(map, 0, 0),
      center(map, 2, 0),
      1,
      5,
    );

    expect(step).toMatchObject({ arrived: false, blocked: true });
    expect(step.position.x).toBeCloseTo(0.5);
    expect(step.secondsLeft).toBeCloseTo(3.5);
  });

  test("keeps a blocked order and resumes it after navigation changes", () => {
    const map = new TerrainMap({ width: 5, height: 1, tileSize: 1 });
    const simulation = createMovementMission(map, 1, 0.25);
    simulation.submitCommand({
      kind: "move",
      actorId: "trooper",
      target: center(map, 4, 0),
    });
    simulation.tick();
    map.setTerrain(1, 0, { typeId: "plain", surfacePassable: false });

    simulation.tick();
    const blocked = simulation.actorById("trooper")!;
    expect(blocked.movement?.blocked).toBe(true);
    expect(blocked.movement?.target).toEqual(center(map, 4, 0));
    expect(blocked.worldPosition.x).toBeCloseTo(-1.75);

    map.setTerrain(1, 0, { typeId: "plain" });
    simulation.tick();

    const resumed = simulation.actorById("trooper")!;
    expect(resumed.movement?.blocked).not.toBe(true);
    expect(resumed.worldPosition.x).toBeGreaterThan(blocked.worldPosition.x);
  });

  test("rejects invalid movement profiles when behavior is configured", () => {
    const map = new TerrainMap({ width: 1, height: 1, tileSize: 1 });
    const invalid = { ...ground, terrainCosts: { plain: Number.NaN } };

    expect(() => createTerrainMoveBehavior(map, [invalid])).toThrow(
      "Invalid movement profile",
    );
  });

  test("rejects definitions it cannot move when the mission starts", () => {
    const map = new TerrainMap({ width: 1, height: 1, tileSize: 1 });
    const create = (movement: { speed: number; profileId?: string }) =>
      createMissionSimulation({
        state: createMissionState([]),
        behaviorRegistry: new Map([
          ["terrain-move", createTerrainMoveBehavior(map, [ground])],
        ]),
        bounds: map.worldBounds,
        definitions: [{ id: "trooper", behaviorId: "terrain-move", movement }],
        tickSeconds: 1,
      });

    expect(() => create({ speed: 1, profileId: "hover" })).toThrow(
      "unknown movement profile hover",
    );
    expect(() => create({ speed: 0, profileId: ground.id })).toThrow(
      "positive movement speed",
    );
  });
});

function createMovementMission(
  map: TerrainMap,
  speed: number,
  tickSeconds: number,
  tileX = 0,
  tileZ = 0,
) {
  return createMissionSimulation({
    state: createMissionState([
      createActor({
        id: "trooper",
        definitionId: "trooper",
        worldPosition: center(map, tileX, tileZ),
      }),
    ]),
    behaviorRegistry: new Map([
      ["terrain-move", createTerrainMoveBehavior(map, [ground])],
    ]),
    bounds: map.worldBounds,
    definitions: [
      {
        id: "trooper",
        behaviorId: "terrain-move",
        movement: { speed, profileId: ground.id },
      },
    ],
    tickSeconds,
  });
}

describe("saved missions", () => {
  const createMap = () =>
    new TerrainMap({
      width: 9,
      height: 5,
      tileSize: 1,
      terrainTypeIds: ["plain", "water"],
    });
  const createSimulation = (
    map: TerrainMap,
    state: MissionState,
    behavior: ActorBehavior = createTerrainMoveBehavior(map, [ground]),
  ) =>
    createMissionSimulation({
      state,
      behaviorRegistry: new Map([["terrain-move", behavior]]),
      bounds: map.worldBounds,
      definitions: [
        {
          id: "trooper",
          behaviorId: "terrain-move",
          movement: { speed: 2, profileId: ground.id },
        },
      ],
      tickSeconds: 0.25,
      map,
    });
  const wall = (x: number): TerrainCommand => ({
    kind: "terrain",
    tiles: [1, 2, 3].map((z) => ({ x, z, terrain: { typeId: "water" } })),
  });

  test("resumes a moving unit from a save exactly", () => {
    const map = createMap();
    const original = createSimulation(
      map,
      createMissionState([
        createActor({
          id: "trooper",
          definitionId: "trooper",
          worldPosition: center(map, 0, 2),
        }),
      ]),
    );
    original.submitCommand({
      kind: "move",
      actorId: "trooper",
      target: center(map, 8, 2),
    });
    original.tick();
    original.submitCommand(wall(4));
    original.tick();
    original.tick();

    // A save file holds JSON, not live objects.
    const saved = JSON.parse(JSON.stringify(original.snapshot()));
    const savedRoute = saved.actors[0].movement.waypoints;
    expect(saved.terrain.navigationVersion).toBe(1);
    const resumed = createSimulation(createMap(), saved);

    resumed.tick();
    original.tick();
    expect(resumed.actorById("trooper")!.movement?.waypoints).toEqual(
      savedRoute,
    );
    for (let tick = 0; tick < 40; tick += 1) {
      expect(resumed.snapshot()).toEqual(original.snapshot());
      original.tick();
      resumed.tick();
    }

    const trooper = resumed.actorById("trooper")!;
    expect(trooper.movement).toBeUndefined();
    expect(trooper.worldPosition).toEqual(center(map, 8, 2));
  });

  test("rejects an invalid terrain command without partial edits", () => {
    const map = createMap();
    const simulation = createSimulation(map, createMissionState([]));
    simulation.submitCommand({
      kind: "terrain",
      heights: [{ x: 0, z: 0, height: 1 }],
      tiles: [{ x: 0, z: 0, terrain: { typeId: "lava" } }],
    });

    const [outcome] = simulation.tick();

    expect(outcome?.accepted).toBe(false);
    expect(map.heightAt(0, 0)).toBe(0);
    expect(map.navigationChanges.version).toBe(0);
  });

  test("restores terrain into grids that cached the same version", () => {
    const map = createMap();
    const grid = new NavigationGrid(map, ground);
    expect(grid.costAt(4, 2)).toBe(1);
    const walled = createMap();
    walled.editTerrain(wall(4));
    const state = { ...walled.terrainState(), navigationVersion: 0 };

    map.restoreTerrainState(state);

    expect(grid.costAt(4, 2)).toBeUndefined();
    expect(map.navigationChanges.version).toBe(0);
  });

  test("needs a map to restore saved terrain", () => {
    const map = createMap();
    const saved = createSimulation(map, createMissionState([])).snapshot();

    expect(() =>
      createMissionSimulation({
        state: saved,
        behaviorRegistry: new Map(),
        bounds: map.worldBounds,
        definitions: [],
        tickSeconds: 1,
      }),
    ).toThrow("no map to restore");
  });
});
