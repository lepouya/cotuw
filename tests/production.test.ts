import { describe, expect, test } from "vitest";

import { createActor } from "../src/simulation/actor";
import {
  createMissionSimulation,
  createMissionState,
} from "../src/simulation/mission";
import { OccupancyGrid } from "../src/simulation/occupancy";
import {
  createTilePlacedActor,
  occupiedTilesFor,
} from "../src/simulation/placement";
import { TerrainGrid } from "../src/simulation/terrain";
import { createTerrainMoveBehavior } from "../src/simulation/terrain-movement";

import type {
  Actor,
  ActorBehavior,
  ActorDefinition,
} from "../src/simulation/actor";
import type { TrainUnitCommand } from "../src/simulation/command";
import type { WorldBounds } from "../src/simulation/world";
import type { MissionState } from "../src/simulation/mission";

const barracks: ActorDefinition = {
  id: "barracks",
  behaviorId: "idle",
  production: { unitDefinitionIds: ["trooper", "scout"] },
  footprint: {
    layer: "surface",
    blocksMovement: true,
    occupiedTiles: [
      { x: 0, z: 0 },
      { x: 1, z: 0 },
      { x: 0, z: 1 },
      { x: 1, z: 1 },
    ],
  },
  placement: { terrainTypeIds: ["plain"], maxSlope: 1 },
};
const definitions: ActorDefinition[] = [
  barracks,
  {
    id: "trooper",
    behaviorId: "move",
    movement: { speed: 4, profileId: "ground" },
  },
  {
    id: "scout",
    behaviorId: "move",
    movement: { speed: 7, profileId: "ground" },
  },
  { ...barracks, id: "command-center", production: undefined },
];
const profiles = [
  {
    id: "ground",
    maxSlope: 1,
    slopeCostAtLimit: 1,
    terrainCosts: { plain: 1, water: null },
  },
];
const order = (
  actorId = "unit-1",
  definitionId = "trooper",
  producerId = "barracks-1",
): TrainUnitCommand => ({
  kind: "train-unit",
  actorId,
  definitionId,
  producerId,
});
function fixture(
  options: {
    rotation?: number;
    origin?: { x: number; z: number };
    state?: MissionState;
    extraActors?: Actor[];
    fault?: boolean;
    bounds?: WorldBounds;
    canStandAt?: ActorBehavior["canStandAt"];
  } = {},
) {
  const map = new TerrainGrid({
    width: 12,
    height: 12,
    tileSize: 1,
    terrainTypeIds: ["plain", "water"],
  });
  const occupancy = new OccupancyGrid(map);
  const producer = createTilePlacedActor(map, barracks, {
    actorId: "barracks-1",
    origin: options.origin ?? { x: 5, z: 5 },
    quarterTurns: options.rotation,
  });
  const simulation = createMissionSimulation({
    map,
    occupancy,
    bounds: options.bounds ?? map.worldBounds,
    tickSeconds: 1 / 60,
    definitions,
    state:
      options.state ??
      createMissionState([producer, ...(options.extraActors ?? [])]),
    behaviorRegistry: new Map([
      [
        "idle",
        {
          handleCommand: () => false,
          update: () => {
            if (options.fault) throw new Error("fault");
          },
        },
      ],
      [
        "move",
        {
          ...createTerrainMoveBehavior(map, occupancy, profiles),
          ...(options.canStandAt && { canStandAt: options.canStandAt }),
        },
      ],
    ]),
  });
  return { map, occupancy, simulation, producer };
}

describe("unit production", () => {
  test("trains distinct units only on the command tick and accepts movement afterward", () => {
    const { simulation } = fixture();
    simulation.submitCommand(order());
    simulation.submitCommand(order("unit-2", "scout"));
    expect(simulation.actors).toHaveLength(1);
    expect(simulation.tick().map(({ accepted }) => accepted)).toEqual([
      true,
      true,
    ]);
    const first = simulation.actorById("unit-1")!;
    const second = simulation.actorById("unit-2")!;
    expect(first.definitionId).toBe("trooper");
    expect(second.definitionId).toBe("scout");
    expect(first.worldPosition).not.toEqual(second.worldPosition);
    expect(simulation.actorVersion).toBe(2);
    simulation.submitCommand({
      kind: "move",
      actorId: first.id,
      target: { x: 3, z: 3 },
    });
    expect(simulation.tick()[0].accepted).toBe(true);
    expect(simulation.actorById(first.id)!.worldPosition).not.toEqual(
      first.worldPosition,
    );
  });

  test.each([0, 1, 2, 3])(
    "prefers the entrance side after rotation %i",
    (rotation) => {
      const { simulation, map, producer } = fixture({ rotation });
      simulation.submitCommand(order());
      simulation.tick();
      const unit = simulation.actorById("unit-1")!;
      const tile = map.tileAtWorldPosition(
        unit.worldPosition.x,
        unit.worldPosition.z,
      );
      const tiles = occupiedTilesFor(producer, barracks);
      if (rotation === 0)
        expect(tile.z).toBe(Math.max(...tiles.map(({ z }) => z)) + 1);
      if (rotation === 1)
        expect(tile.x).toBe(Math.max(...tiles.map(({ x }) => x)) + 1);
      if (rotation === 2)
        expect(tile.z).toBe(Math.min(...tiles.map(({ z }) => z)) - 1);
      if (rotation === 3)
        expect(tile.x).toBe(Math.min(...tiles.map(({ x }) => x)) - 1);
    },
  );

  test("skips water, slopes, occupied footprints, and mobile units", () => {
    const { simulation, map } = fixture();
    map.editTerrain({ tiles: [{ x: 6, z: 7, terrain: { typeId: "water" } }] });
    map.editTerrain({ heights: [{ x: 5, z: 8, height: 3 }] });
    simulation.spawnActor(
      createTilePlacedActor(map, barracks, {
        actorId: "blocker",
        origin: { x: 7, z: 5 },
      }),
    );
    simulation.spawnActor(
      createActor({
        id: "standing-unit",
        definitionId: "trooper",
        worldPosition: map.tileCenter(7, 4),
      }),
    );
    simulation.submitCommand(order());
    expect(simulation.tick()[0].accepted).toBe(true);
    const unit = simulation.actorById("unit-1")!;
    expect(
      map.tileAtWorldPosition(unit.worldPosition.x, unit.worldPosition.z),
    ).toEqual({ x: 4, z: 6 });
  });

  test("a blocked exit rejects without reserving the ID and can be retried", () => {
    const { simulation, map } = fixture();
    for (const tile of [
      { x: 5, z: 4 },
      { x: 6, z: 4 },
      { x: 4, z: 5 },
      { x: 4, z: 6 },
      { x: 7, z: 5 },
      { x: 7, z: 6 },
      { x: 5, z: 7 },
      { x: 6, z: 7 },
    ]) {
      simulation.spawnActor(
        createActor({
          id: `block-${tile.x}-${tile.z}`,
          definitionId: "trooper",
          worldPosition: map.tileCenter(tile.x, tile.z),
        }),
      );
    }
    simulation.submitCommand(order());
    expect(simulation.tick()[0]).toMatchObject({
      accepted: false,
      reason: "exit-blocked",
    });
    expect(simulation.actorById("unit-1")).toBeUndefined();
    simulation.submitCommand({ kind: "remove-actor", actorId: "block-5-7" });
    simulation.submitCommand(order());
    expect(simulation.tick().map(({ accepted }) => accepted)).toEqual([
      true,
      true,
    ]);
  });

  test("custom behavior chooses an allowed exit and can reject every exit", () => {
    let allowed = true;
    const { simulation, map } = fixture({
      canStandAt: (definition, tile) =>
        allowed && definition.id === "scout" && tile.x === 4 && tile.z === 5,
    });
    const command = order("custom-unit", "scout");
    const preview = simulation.evaluateTraining(command);
    expect(preview.accepted).toBe(true);
    if (!preview.accepted || !("actor" in preview))
      throw new Error("Expected a valid custom exit.");
    expect(preview.actor.worldPosition).toEqual(map.tileCenter(4, 5));
    simulation.submitCommand(command);
    expect(simulation.tick()[0].accepted).toBe(true);
    expect(simulation.actorById(command.actorId)?.worldPosition).toEqual(
      preview.actor.worldPosition,
    );
    simulation.removeActor(command.actorId);
    allowed = false;
    const blocked = order("blocked-unit", "scout");
    expect(simulation.evaluateTraining(blocked)).toEqual({
      accepted: false,
      reason: "exit-blocked",
    });
    simulation.submitCommand(blocked);
    expect(simulation.tick()[0]).toMatchObject({
      accepted: false,
      reason: "exit-blocked",
    });
    expect(() => simulation.tick()).not.toThrow();
  });

  test("unused IDs account for queued requests without reserving previews", () => {
    const { simulation, map } = fixture();
    expect(simulation.unusedActorId("unit-")).toBe("unit-1");
    expect(simulation.unusedActorId("unit-")).toBe("unit-1");
    simulation.submitCommand(order("unit-1", "unknown"));
    simulation.submitCommand(order("unit-2"));
    expect(simulation.unusedActorId("unit-")).toBe("unit-3");
    simulation.tick();
    expect(simulation.unusedActorId("unit-")).toBe("unit-1");
    simulation.submitCommand(order());
    simulation.tick();
    expect(simulation.unusedActorId("unit-")).toBe("unit-3");
    simulation.removeActor("unit-1");
    expect(simulation.unusedActorId("unit-")).toBe("unit-3");
    simulation.spawnActor(
      createActor({
        id: "unit-3",
        definitionId: "scout",
        worldPosition: map.tileCenter(1, 1),
      }),
    );
    expect(simulation.unusedActorId("unit-")).toBe("unit-4");
  });

  test.each([
    [order("", "trooper"), "invalid-actor"],
    [order("barracks-1"), "used-id"],
    [order("unit", "barracks"), "unsupported-unit"],
    [order("unit", "unknown"), "unsupported-unit"],
    [order("unit", "trooper", "missing"), "missing-producer"],
  ] as const)("rejects invalid requests %#", (command, reason) => {
    const { simulation } = fixture();
    simulation.submitCommand(command);
    expect(simulation.tick()[0]).toMatchObject({
      accepted: false,
      reason: reason,
    });
    expect(simulation.actors).toHaveLength(1);
  });

  test("a building without production and a removed producer cannot train", () => {
    const { simulation, map } = fixture();
    simulation.spawnActor(
      createTilePlacedActor(map, definitions[3], {
        actorId: "cc",
        origin: { x: 1, z: 1 },
      }),
    );
    simulation.submitCommand(order("unit-1", "trooper", "cc"));
    simulation.submitCommand({ kind: "remove-actor", actorId: "barracks-1" });
    simulation.submitCommand(order("unit-2"));
    expect(simulation.tick()).toMatchObject([
      { accepted: false, reason: "unsupported-unit" },
      { accepted: true },
      { accepted: false, reason: "missing-producer" },
    ]);
  });

  test("same-tick requests fill available exits without stacking units", () => {
    const { simulation } = fixture();
    for (let i = 0; i < 9; i++) simulation.submitCommand(order(`unit-${i}`));
    const outcomes = simulation.tick();
    expect(outcomes.filter(({ accepted }) => accepted)).toHaveLength(8);
    expect(outcomes[8].reason).toBe("exit-blocked");
    const positions = simulation.actors
      .slice(1)
      .map(({ worldPosition }) => JSON.stringify(worldPosition));
    expect(new Set(positions).size).toBe(8);
  });

  test("training near the map boundary uses only playable tiles", () => {
    const valid = fixture({ origin: { x: 1, z: 1 }, rotation: 2 });
    const { map } = valid;
    valid.simulation.submitCommand(order());
    expect(valid.simulation.tick()[0].accepted).toBe(true);
    const tile = map.tileAtWorldPosition(
      valid.simulation.actorById("unit-1")!.worldPosition.x,
      valid.simulation.actorById("unit-1")!.worldPosition.z,
    );
    expect(tile.x).toBeGreaterThanOrEqual(0);
    expect(tile.z).toBeGreaterThanOrEqual(0);
  });

  test("training stays within mission bounds narrower than its terrain map", () => {
    const { simulation } = fixture({
      bounds: { minX: -1.5, maxX: 1.5, minZ: -1.5, maxZ: 0.5 },
    });
    simulation.submitCommand(order());
    expect(simulation.tick()[0].accepted).toBe(true);
    expect(simulation.actorById("unit-1")!.worldPosition.z).toBeLessThanOrEqual(
      0.5,
    );
  });

  test("a mission boundary that blocks every exit rejects without faulting", () => {
    const { simulation } = fixture({
      bounds: { minX: -0.5, maxX: 0.5, minZ: -0.5, maxZ: 0.5 },
    });
    const command = order();
    expect(simulation.evaluateTraining(command)).toEqual({
      accepted: false,
      reason: "exit-blocked",
    });
    simulation.submitCommand(command);
    expect(simulation.tick()[0]).toMatchObject({
      accepted: false,
      reason: "exit-blocked",
    });
    expect(() => simulation.tick()).not.toThrow();
  });

  test("production units need a behavior that reports passable tiles", () => {
    const map = new TerrainGrid({ width: 12, height: 12, tileSize: 1 });
    expect(() =>
      createMissionSimulation({
        state: createMissionState([]),
        map,
        occupancy: new OccupancyGrid(map),
        bounds: map.worldBounds,
        tickSeconds: 1,
        definitions: [
          { ...barracks, production: { unitDefinitionIds: ["trooper"] } },
          { ...definitions[1], behaviorId: "idle" },
        ],
        behaviorRegistry: new Map([
          ["idle", { handleCommand: () => false, update: () => {} }],
        ]),
      }),
    ).toThrow("Invalid production unit");
  });

  test("snapshots replay pending training exactly and retain retired IDs", () => {
    const { simulation } = fixture();
    simulation.submitCommand(order());
    simulation.tick();
    simulation.submitCommand({ kind: "remove-actor", actorId: "unit-1" });
    simulation.tick();
    simulation.submitCommand(order("unit-2", "scout"));
    const saved = simulation.snapshot();
    const restored = fixture({ state: saved }).simulation;
    expect(restored.tick()).toEqual(simulation.tick());
    expect(restored.snapshot()).toEqual(simulation.snapshot());
    restored.submitCommand(order());
    expect(restored.tick()[0].reason).toBe("used-id");
  });

  test("a behavior fault rolls back the trained actor and lifecycle version", () => {
    const { simulation } = fixture({ fault: true });
    simulation.submitCommand(order());
    const before = simulation.snapshot();
    expect(() => simulation.tick()).toThrow("fault");
    expect(simulation.snapshot()).toEqual(before);
    expect(simulation.actorVersion).toBe(0);
  });

  test("invalid production catalogs fail at initialization", () => {
    const saved = fixture().simulation.snapshot();
    saved.actors[0].definitionId = "barracks";
    const map = new TerrainGrid({ width: 12, height: 12, tileSize: 1 });
    expect(() =>
      createMissionSimulation({
        state: saved,
        map,
        occupancy: new OccupancyGrid(map),
        bounds: map.worldBounds,
        tickSeconds: 1,
        definitions: [barracks],
        behaviorRegistry: new Map([
          ["idle", { handleCommand: () => false, update: () => {} }],
        ]),
      }),
    ).toThrow("Invalid production unit");
  });
});

test("rally points are persistent ground orders, clearable, and used after exiting", () => {
  const { simulation, map } = fixture();
  const target = map.tileCenter(9, 9);
  simulation.submitCommand({
    kind: "set-rally-point",
    actorId: "barracks-1",
    target,
  });
  expect(simulation.actorById("barracks-1")!.rallyPoint).toBeUndefined();
  expect(simulation.tick()[0].accepted).toBe(true);
  const saved = JSON.parse(JSON.stringify(simulation.snapshot()));
  const restored = fixture({ state: saved }).simulation;
  expect(restored.actorById("barracks-1")!.rallyPoint).toEqual(target);
  restored.submitCommand(order());
  expect(restored.tick()[0].accepted).toBe(true);
  expect(restored.actorById("unit-1")!.movement?.target).toEqual(target);
  for (let i = 0; i < 300; i++) restored.tick();
  expect(restored.actorById("unit-1")!.worldPosition).toEqual(target);
  restored.submitCommand({ kind: "set-rally-point", actorId: "barracks-1" });
  restored.tick();
  restored.submitCommand(order("unit-2"));
  restored.tick();
  expect(restored.actorById("unit-2")!.movement).toBeUndefined();
});

test("rally points reject water, occupied footprints, invalid positions, and non-producers", () => {
  const { simulation, map } = fixture();
  simulation.submitCommand({
    kind: "terrain",
    tiles: [{ x: 8, z: 8, terrain: { typeId: "water" } }],
  });
  simulation.tick();
  for (const target of [
    map.tileCenter(8, 8),
    map.tileCenter(5, 5),
    { x: NaN, z: 0 },
    { x: 999, z: 0 },
  ]) {
    expect(simulation.evaluateRallyPoint("barracks-1", target)).toBe(false);
    simulation.submitCommand({
      kind: "set-rally-point",
      actorId: "barracks-1",
      target,
    });
    expect(simulation.tick()[0].accepted).toBe(false);
  }
  simulation.submitCommand({
    kind: "set-rally-point",
    actorId: "missing",
    target: map.tileCenter(9, 9),
  });
  expect(simulation.tick()[0].accepted).toBe(false);
});
