import { describe, expect, test, vi } from "vitest";

import { TerrainGrid } from "../src/simulation/terrain";
import { createActor } from "../src/simulation/actor";
import {
  createMissionSimulation,
  createMissionState,
} from "../src/simulation/mission";
import { OccupancyGrid } from "../src/simulation/occupancy";
import { NavigationGrid } from "../src/simulation/navigation";
import {
  createTilePlacedActor,
  footprintPlacementFor,
  occupiedTilesFor,
} from "../src/simulation/placement";

import type {
  Actor,
  ActorBehavior,
  ActorDefinition,
} from "../src/simulation/actor";
import type { PlaceActorCommand } from "../src/simulation/command";
import type { MissionState } from "../src/simulation/mission";
import type { TerrainGridOptions } from "../src/simulation/terrain";

const idle: ActorBehavior = {
  handleCommand: () => false,
  update: () => {},
};

const definitions: readonly ActorDefinition[] = [
  { id: "trooper", behaviorId: "idle" },
  {
    id: "wall",
    behaviorId: "idle",
    footprint: {
      layer: "surface",
      occupiedTiles: [
        { x: 0, z: 0 },
        { x: 1, z: 0 },
      ],
      blocksMovement: true,
    },
    placement: { terrainTypeIds: ["plain"], maxSlope: 0.5 },
  },
];

type World = { map: TerrainGrid; occupancy: OccupancyGrid };

function world(options: Partial<TerrainGridOptions> = {}): World {
  const map = new TerrainGrid({ width: 6, height: 4, tileSize: 1, ...options });
  return { map, occupancy: new OccupancyGrid(map) };
}

function placeWall(
  actorId: string,
  x: number,
  z: number,
  quarterTurns = 0,
): PlaceActorCommand {
  return {
    kind: "place-actor",
    actorId,
    definitionId: "wall",
    origin: { x, z },
    quarterTurns,
  };
}

function wall({ map }: World, id: string, x: number, z: number, turns = 0) {
  return createTilePlacedActor(
    map,
    definitions[1]!,
    placeWall(id, x, z, turns),
    "player",
  );
}

function trooper({ map }: World, id: string, x: number, z: number): Actor {
  return createActor({
    id,
    definitionId: "trooper",
    owner: "player",
    worldPosition: map.tileCenter(x, z),
  });
}

function simulation(
  { map, occupancy }: World,
  state: MissionState = createMissionState([]),
  behaviors = new Map([["idle", idle]]),
) {
  return createMissionSimulation({
    state,
    behaviorRegistry: behaviors,
    bounds: map.worldBounds,
    definitions,
    tickSeconds: 1,
    map,
    occupancy,
  });
}

const invalidFacing: ActorBehavior = {
  ...idle,
  update: (actor) => {
    actor.facing = NaN;
  },
};

describe("tile-placed actors", () => {
  test("resolves definitions, rotation, runtime state, and occupancy", () => {
    const placed = world({ width: 6, height: 6 });
    const { occupancy } = placed;
    const mission = simulation(placed);
    mission.submitCommand(placeWall("wall-1", 3, 2, 1));

    expect(mission.tick()[0]?.accepted).toBe(true);
    const expected = wall(placed, "wall-1", 3, 2, 1);
    expect(mission.actorById("wall-1")).toEqual(expected);
    // Like facing, a clockwise quarter turn takes +X to -Z.
    expect(expected.facing).toBe(Math.PI / 2);
    expect(occupiedTilesFor(expected, definitions[1]!)).toEqual([
      { x: 3, z: 2 },
      { x: 3, z: 1 },
    ]);
    expect(occupancy.ownerAt(3, 2, "surface")).toBe("wall-1");
    expect(occupancy.ownerAt(3, 1, "surface")).toBe("wall-1");
    expect(occupancy.ownerAt(4, 2, "surface")).toBeUndefined();
  });

  test("keeps outcomes separate from committed actor state", () => {
    const placed = world();
    const mission = simulation(placed);
    mission.submitCommand(placeWall("wall-1", 2, 1));

    const [outcome] = mission.tick();

    expect(outcome?.command).toEqual(placeWall("wall-1", 2, 1));
    expect(outcome?.command).not.toHaveProperty("actor");
  });

  test.each([
    ["fractional origin", { origin: { x: 1.5, z: 1 } }],
    ["rotation", { quarterTurns: 4 }],
    ["empty ID", { actorId: "" }],
  ])("rejects a malformed placement's %s", (_name, change) => {
    const placed = world();
    const mission = simulation(placed);
    mission.submitCommand({ ...placeWall("wall-1", 2, 1), ...change });

    expect(mission.tick()[0]).toMatchObject({
      accepted: false,
      reason: "invalid-actor",
    });
    expect(mission.actors).toHaveLength(0);
  });

  test("rejects definitions that both move and use a footprint", () => {
    const { map, occupancy } = world();
    expect(() =>
      createMissionSimulation({
        state: createMissionState([]),
        behaviorRegistry: new Map([["idle", idle]]),
        bounds: map.worldBounds,
        definitions: [{ ...definitions[1]!, movement: { speed: 1 } }],
        tickSeconds: 1,
        map,
        occupancy,
      }),
    ).toThrow("cannot both move and use a footprint");
  });

  test("requires occupancy for footprint definitions", () => {
    const { map } = world();
    expect(() =>
      createMissionSimulation({
        state: createMissionState([]),
        behaviorRegistry: new Map([["idle", idle]]),
        bounds: map.worldBounds,
        definitions,
        tickSeconds: 1,
        map,
      }),
    ).toThrow("requires a terrain map and occupancy");
  });

  test("rejects terrain edits under a footprint", () => {
    const placed = world({ width: 6, height: 6 });
    const { map } = placed;
    const mission = simulation(
      placed,
      createMissionState([wall(placed, "wall-1", 2, 2)]),
    );
    const water = { typeId: "plain", surfacePassable: false };
    mission.submitCommand({
      kind: "terrain",
      tiles: [{ x: 3, z: 2, terrain: water }],
    });
    // The corner shared by tiles (1, 1) and (2, 2) shapes the footprint.
    mission.submitCommand({
      kind: "terrain",
      heights: [{ x: 2, z: 2, height: 1 }],
    });
    mission.submitCommand({
      kind: "terrain",
      tiles: [{ x: 5, z: 5, terrain: water }],
      heights: [{ x: 1, z: 1, height: 1 }],
    });

    expect(mission.tick().map(({ accepted }) => accepted)).toEqual([
      false,
      false,
      true,
    ]);
    expect(map.terrainAt(3, 2)).toEqual({ typeId: "plain" });
    expect(map.heightAt(2, 2)).toBe(0);
    expect(() => map.setTerrain(3, 2, water)).toThrow("Invalid terrain edit");
    const version = map.navigationChanges.version;
    expect(() => map.setHeight(2, 2, 5)).toThrow("Invalid terrain edit");
    expect(map.heightAt(2, 2)).toBe(0);
    expect(map.navigationChanges.version).toBe(version);
  });

  test.each([
    "overlap",
    "edge",
    "terrain",
    "definition",
    "identity",
    "malformed-terrain",
    "scenario-overlap",
  ])("rejects initialization's %s without touching the live world", (kind) => {
    const placed = world();
    const { map, occupancy } = placed;
    const original = simulation(
      placed,
      createMissionState([wall(placed, "original", 2, 1)]),
    );
    map.setHeight(0, 0, 0.25);
    const before = original.snapshot();
    const generation = map.navigationChanges.generation;
    const history = map.navigationChanges.entriesSince(0);
    const changed = vi.fn();
    const unsubscribe = map.onChanged(changed);
    const grid = new NavigationGrid(map, occupancy, {
      id: "ground",
      maxSlope: 1,
      slopeCostAtLimit: 1,
      terrainCosts: { plain: 1 },
    });
    expect(grid.costAt(2, 1)).toBeUndefined();
    const invalid = structuredClone(before);
    invalid.terrain!.heights.fill(5);
    invalid.actors = [wall(placed, "first", 0, 2)];
    if (kind === "overlap" || kind === "scenario-overlap")
      invalid.actors.push(wall(placed, "second", 0, 2));
    if (kind === "scenario-overlap") delete invalid.terrain;
    if (kind === "edge") invalid.actors[0]!.tilePlacement!.origin.x = 6;
    if (kind === "terrain")
      invalid.terrain!.tiles[map.tileIndex(0, 2)]!.surfaceBuildable = false;
    if (kind === "definition") invalid.actors[0]!.definitionId = "missing";
    if (kind === "identity") invalid.actors[0]!.id = "";
    if (kind === "malformed-terrain") invalid.terrain!.heights[0] = NaN;

    expect(() => simulation(placed, invalid)).toThrow();

    expect(original.snapshot()).toEqual(before);
    expect(map.navigationChanges.generation).toBe(generation);
    expect(map.navigationChanges.entriesSince(0)).toEqual(history);
    expect(changed).not.toHaveBeenCalled();
    expect(occupancy.ownerAt(2, 1, "surface")).toBe("original");
    expect(occupancy.ownerAt(0, 2, "surface")).toBeUndefined();
    expect(grid.costAt(2, 1)).toBeUndefined();
    expect(() => map.setHeight(2, 1, 5)).toThrow();
    original.tick();
    expect(original.actorById("original")).toBeDefined();
    unsubscribe();
  });

  test("disposal releases the mission's terrain constraint before replacement", () => {
    const placed = world();
    const mission = simulation(
      placed,
      createMissionState([wall(placed, "old-wall", 2, 1)]),
    );
    expect(() => placed.map.setHeight(2, 1, 1)).toThrow();

    mission.dispose();
    mission.dispose();
    expect(() => mission.tick()).toThrow("disposed");
    expect(() => mission.submitCommand(placeWall("new-wall", 1, 2))).toThrow(
      "disposed",
    );
    expect(() => mission.spawnActor(trooper(placed, "unit", 0, 0))).toThrow(
      "disposed",
    );
    expect(() => mission.removeActor("old-wall")).toThrow("disposed");
    const replacement = simulation({
      map: placed.map,
      occupancy: new OccupancyGrid(placed.map),
    });
    expect(() => placed.map.setHeight(2, 1, 1)).not.toThrow();
    expect(replacement.actors).toHaveLength(0);
    replacement.dispose();
  });

  test("commits a valid restore on a reused world before notifying views", () => {
    const placed = world();
    const { map, occupancy } = placed;
    const original = simulation(
      placed,
      createMissionState([wall(placed, "original", 2, 1)]),
    );
    const saved = original.snapshot();
    saved.terrain!.heights.fill(3);
    saved.actors = [wall(placed, "restored", 0, 2)];
    const grid = new NavigationGrid(map, occupancy, {
      id: "ground",
      maxSlope: 1,
      slopeCostAtLimit: 1,
      terrainCosts: { plain: 1 },
    });
    expect(grid.costAt(2, 1)).toBeUndefined();
    const changed = vi.fn(() => {
      expect(map.heightAt(0, 2)).toBe(3);
      expect(occupancy.ownerAt(0, 2, "surface")).toBe("restored");
      expect(occupancy.ownerAt(2, 1, "surface")).toBeUndefined();
    });
    const unsubscribe = map.onChanged(changed);
    original.dispose();

    const restored = simulation(placed, saved);

    expect(restored.snapshot()).toEqual(saved);
    expect(changed).toHaveBeenCalledOnce();
    expect(grid.costAt(2, 1)).toBe(1);
    expect(grid.costAt(0, 2)).toBeUndefined();
    expect(() => map.setHeight(0, 2, 5)).toThrow("Invalid terrain edit");
    unsubscribe();
    restored.dispose();
  });

  test("rejects occupancy paired with another terrain map", () => {
    const first = world();
    const other = world();
    const before = first.map.terrainState();
    expect(() =>
      simulation({ map: first.map, occupancy: other.occupancy }),
    ).toThrow("must belong to its terrain map");
    expect(first.map.terrainState()).toEqual(before);
  });

  test("reports terrain, slope, edge, actor, and occupancy conflicts", () => {
    const placed = world({
      createHeight: (x) => (x >= 4 ? 2 : 0),
      createTerrain: (x, z) => ({
        typeId: x === 0 ? "water" : "plain",
        surfaceBuildable: x === 1 && z === 0 ? false : undefined,
      }),
      terrainTypeIds: ["plain", "water"],
    });
    const mission = simulation(
      placed,
      createMissionState([trooper(placed, "trooper-1", 1, 1)]),
    );
    const evaluate = (id: string, x: number, z: number) =>
      mission.evaluatePlacement(placeWall(id, x, z));

    expect(evaluate("water", 0, 2)).toMatchObject({
      accepted: false,
      reason: "disallowed-terrain",
    });
    expect(evaluate("unbuildable", 1, 0)).toMatchObject({
      accepted: false,
      reason: "unbuildable-terrain",
    });
    expect(evaluate("actor", 1, 1)).toMatchObject({
      accepted: false,
      reason: "actor-conflict",
    });
    expect(evaluate("slope", 3, 2)).toMatchObject({
      accepted: false,
      reason: "excessive-slope",
    });
    expect(evaluate("edge", 5, 3)).toMatchObject({
      accepted: false,
      reason: "out-of-bounds",
    });

    mission.submitCommand(placeWall("first", 1, 2));
    mission.submitCommand(placeWall("overlap", 2, 2));
    expect(mission.tick().map(({ accepted }) => accepted)).toEqual([
      true,
      false,
    ]);
    expect(mission.actors.map(({ id }) => id)).toEqual(["trooper-1", "first"]);
  });

  test("removes through the shared actor lifecycle and never reuses IDs", () => {
    const placed = world();
    const mission = simulation(placed);
    mission.submitCommand(placeWall("wall-1", 2, 1));
    mission.tick();
    mission.submitCommand({ kind: "remove-actor", actorId: "wall-1" });

    expect(mission.tick()[0]?.accepted).toBe(true);
    expect(placed.occupancy.ownerAt(2, 1, "surface")).toBeUndefined();
    expect(mission.actorById("wall-1")).toBeUndefined();

    expect(() => mission.spawnActor(trooper(placed, "wall-1", 0, 0))).toThrow(
      "Duplicate or retired actor ID",
    );
    mission.submitCommand(placeWall("wall-1", 3, 1));
    expect(mission.tick()[0]).toMatchObject({
      accepted: false,
      reason: "used-id",
    });
  });

  test("rebuilds derived occupancy during save restoration", () => {
    const original = simulation(world());
    original.submitCommand(placeWall("wall-1", 2, 1));
    original.tick();
    const saved = JSON.parse(JSON.stringify(original.snapshot()));

    expect(saved).not.toHaveProperty("occupancy");
    const restoredWorld = world();
    const restored = simulation(restoredWorld, saved);

    expect(restored.snapshot()).toEqual(original.snapshot());
    expect(restoredWorld.occupancy.ownerAt(3, 1, "surface")).toBe("wall-1");
  });

  test("clears orphan occupancy when a mission starts", () => {
    const placed = world();
    placed.occupancy.place(
      footprintPlacementFor(wall(placed, "orphan", 2, 1), definitions[1]!),
    );

    simulation(placed);

    expect(placed.occupancy.placementByOwnerId("orphan")).toBeUndefined();
    expect(placed.occupancy.ownerAt(2, 1, "surface")).toBeUndefined();
  });

  test("requires footprint definitions to be instantiated with a placement", () => {
    const placed = world();
    const bare = createActor({
      id: "bare-wall",
      definitionId: "wall",
      owner: "player",
      worldPosition: placed.map.tileCenter(2, 1),
    });
    expect(() => simulation(placed, createMissionState([bare]))).toThrow(
      "tile placement",
    );
    const mission = simulation(placed);
    expect(() => mission.spawnActor(bare)).toThrow("tile placement");
    expect(mission.actors).toHaveLength(0);
    expect(placed.occupancy.placementByOwnerId("bare-wall")).toBeUndefined();
  });

  test.each([
    [
      "identity",
      (actor: Actor) => {
        actor.id = "renamed";
      },
    ],
    [
      "definition",
      (actor: Actor) => {
        actor.definitionId = "trooper";
      },
    ],
    [
      "origin",
      (actor: Actor) => {
        actor.tilePlacement!.origin.x += 1;
      },
    ],
    [
      "rotation",
      (actor: Actor) => {
        actor.tilePlacement!.quarterTurns = 1;
      },
    ],
    [
      "missing placement",
      (actor: Actor) => {
        delete actor.tilePlacement;
      },
    ],
    [
      "position",
      (actor: Actor) => {
        actor.worldPosition.x += 1;
      },
    ],
    [
      "facing",
      (actor: Actor) => {
        actor.facing = 1;
      },
    ],
    [
      "layer",
      (actor: Actor) => {
        actor.occupancyLayer = "air";
      },
    ],
  ])("rejects behavior changes to a tile-placed %s", (_name, update) => {
    const placed = world();
    const mission = simulation(
      placed,
      createMissionState([wall(placed, "wall-1", 2, 1)]),
      new Map([["idle", { ...idle, update }]]),
    );
    const before = mission.snapshot();
    expect(() => mission.tick()).toThrow();
    expect(mission.snapshot()).toEqual(before);
    expect(placed.occupancy.ownerAt(2, 1, "surface")).toBe("wall-1");
    expect(() => mission.tick()).toThrow("faulted");
  });

  test.each(["place", "remove"] as const)(
    "rolls back occupancy and navigation after a faulted %s",
    (kind) => {
      const placed = world();
      const { map, occupancy } = placed;
      const initial =
        kind === "remove"
          ? [wall(placed, "wall-1", 2, 1)]
          : [trooper(placed, "unit", 0, 0)];
      const mission = simulation(
        placed,
        createMissionState(initial),
        new Map([["idle", invalidFacing]]),
      );
      const version = map.navigationChanges.version;
      const generation = map.navigationChanges.generation;
      mission.submitCommand(
        kind === "place"
          ? placeWall("new-wall", 2, 1)
          : { kind: "remove-actor", actorId: "wall-1" },
      );
      // A removal needs a remaining actor to fault the tick.
      if (kind === "remove") mission.spawnActor(trooper(placed, "unit", 0, 0));

      expect(() => mission.tick()).toThrow("facing");
      expect(occupancy.ownerAt(2, 1, "surface")).toBe(
        kind === "remove" ? "wall-1" : undefined,
      );
      expect(map.navigationChanges.version).toBe(version);
      // Navigation caches must not keep costs from the failed tick.
      expect(map.navigationChanges.generation).toBeGreaterThan(generation);
      expect(mission.completedTicks).toBe(0);
      expect(() =>
        mission.submitCommand({ kind: "remove-actor", actorId: "unit" }),
      ).toThrow("faulted");
    },
  );

  test("reverts terrain edits and occupancy after a fault", () => {
    const placed = world();
    const { map, occupancy } = placed;
    const mission = simulation(
      placed,
      createMissionState([]),
      new Map([["idle", invalidFacing]]),
    );
    const terrain = map.terrainState();
    mission.submitCommand(placeWall("wall-1", 2, 1));
    mission.submitCommand({
      kind: "terrain",
      heights: [{ x: 0, z: 0, height: 1 }],
    });

    expect(() => mission.tick()).toThrow("facing");
    expect(occupancy.placementByOwnerId("wall-1")).toBeUndefined();
    expect(mission.actors).toHaveLength(0);
    expect(map.terrainState()).toEqual(terrain);
  });

  test("returns the placement rejection reason from the command's tick", () => {
    const mission = simulation(world());
    expect(mission.evaluatePlacement(placeWall("second", 2, 1)).accepted).toBe(
      true,
    );
    mission.submitCommand(placeWall("first", 2, 1));
    mission.submitCommand(placeWall("second", 2, 1));
    expect(mission.tick()[1]).toMatchObject({
      accepted: false,
      reason: "occupancy-conflict",
    });
  });
});
