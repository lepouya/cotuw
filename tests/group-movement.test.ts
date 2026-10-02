import { describe, expect, test } from "vitest";
import { createActor } from "../src/simulation/actor";
import {
  createMissionSimulation,
  createMissionState,
} from "../src/simulation/mission";
import { createTerrainMoveBehavior } from "../src/simulation/terrain-movement";
import { TerrainGrid } from "../src/simulation/terrain";
import { OccupancyGrid } from "../src/simulation/occupancy";
import { startSimulationLoop } from "../src/simulation/loop";
import type { Actor, ActorDefinition } from "../src/simulation/actor";
import type { MissionCommand } from "../src/simulation/command";
import type { MissionState } from "../src/simulation/mission";

const definitions: ActorDefinition[] = [
  {
    id: "trooper",
    behaviorId: "move",
    movement: { speed: 4, profileId: "ground", radius: 0.3 },
  },
  {
    id: "scout",
    behaviorId: "move",
    movement: { speed: 7, profileId: "ground", radius: 0.28 },
  },
  {
    id: "swimmer",
    behaviorId: "move",
    movement: { speed: 5, profileId: "water", radius: 0.3 },
  },
  {
    id: "large-unit",
    behaviorId: "move",
    movement: { speed: 4, profileId: "ground", radius: 1.4 },
  },
];
const profiles = [
  {
    id: "ground",
    maxSlope: 1,
    slopeCostAtLimit: 1,
    terrainCosts: { plain: 1, rough: 2, water: null },
  },
  {
    id: "water",
    maxSlope: 1,
    slopeCostAtLimit: 1,
    terrainCosts: { plain: null, rough: null, water: 1 },
  },
];
function fixture(actors?: Actor[], saved?: MissionState) {
  const map = new TerrainGrid({
    width: 20,
    height: 12,
    tileSize: 1,
    terrainTypeIds: ["plain", "rough", "water"],
    createTerrain: (x, z) => ({
      typeId: x >= 13 ? "rough" : "plain",
      // A single-tile passage divides the two halves of the map.
      surfacePassable: x === 10 && z !== 6 ? false : undefined,
    }),
  });
  const occupancy = new OccupancyGrid(map);
  const simulation = createMissionSimulation({
    state:
      saved ??
      createMissionState(
        actors ??
          Array.from({ length: 8 }, (_, index) =>
            createActor({
              id: `unit-${index}`,
              definitionId: index % 2 ? "scout" : "trooper",
              worldPosition: map.tileCenter(
                3 + (index % 2),
                3 + Math.floor(index / 2),
              ),
            }),
          ),
      ),
    behaviorRegistry: new Map([
      ["move", createTerrainMoveBehavior(map, occupancy, profiles)],
    ]),
    bounds: map.worldBounds,
    definitions,
    tickSeconds: 1 / 60,
    map,
    occupancy,
  });
  return { simulation, map, occupancy };
}
const distance = (a: Actor["worldPosition"], b: Actor["worldPosition"]) =>
  Math.hypot(a.x - b.x, a.z - b.z);
const sortedActors = (state: MissionState) =>
  state.actors.sort((a, b) => (a.id < b.id ? -1 : 1));

describe("group movement", () => {
  test("blocked move receipts survive arrival in the command's tick", () => {
    const { simulation, map } = fixture([]);
    const start = map.tileCenter(9, 4);
    simulation.spawnActor(
      createActor({
        id: "near",
        definitionId: "trooper",
        worldPosition: { ...start, x: start.x - 0.01 },
      }),
    );
    simulation.submitCommand({
      kind: "group-move",
      actorIds: ["near"],
      target: map.tileCenter(10, 4),
    });
    const [outcome] = simulation.tick();
    expect(simulation.actorById("near")!.movement).toBeUndefined();
    expect(outcome).toMatchObject({ accepted: true, reachedTarget: false });
    simulation.dispose();
  });

  test("move receipts preserve reachability when a later order replaces the route", () => {
    const { simulation, map } = fixture();
    simulation.submitCommand({
      kind: "move",
      actorId: "unit-0",
      target: map.tileCenter(10, 4),
    });
    simulation.submitCommand({
      kind: "move",
      actorId: "unit-0",
      target: map.tileCenter(7, 4),
    });
    const outcomes = simulation.tick();
    expect(outcomes).toMatchObject([
      { accepted: true, reachedTarget: false },
      { accepted: true, reachedTarget: true },
    ]);
    simulation.dispose();
  });

  test("destinations respect unselected units' authored radii on the same layer", () => {
    const { simulation, map } = fixture([]);
    const target = map.tileCenter(6, 6);
    for (const [id, definitionId, tile] of [
      ["large", "large-unit", { x: 6, z: 6 }],
      ["a", "trooper", { x: 2, z: 6 }],
      ["b", "trooper", { x: 2, z: 7 }],
    ] as const)
      simulation.spawnActor(
        createActor({
          id,
          definitionId,
          worldPosition: map.tileCenter(tile.x, tile.z),
        }),
      );
    simulation.submitCommand({
      kind: "group-move",
      actorIds: ["a", "b"],
      target,
    });
    expect(simulation.tick().every(({ accepted }) => accepted)).toBe(true);
    for (const id of ["a", "b"])
      expect(
        distance(simulation.actorById(id)!.movement!.target, target),
      ).toBeGreaterThanOrEqual(1.7);
    simulation.dispose();
  });

  test("a mixed group crosses a narrow passage and arrives at separate reachable positions", () => {
    const { simulation, map, occupancy } = fixture();
    // A barracks-sized blocker sits beyond the passage.
    occupancy.place({
      ownerId: "barracks",
      origin: { x: 13, z: 5 },
      footprint: {
        layer: "surface",
        blocksMovement: true,
        occupiedTiles: [
          { x: 0, z: 0 },
          { x: 1, z: 0 },
          { x: 2, z: 0 },
          { x: 0, z: 1 },
          { x: 1, z: 1 },
          { x: 2, z: 1 },
        ],
      },
    });
    simulation.submitCommand({
      kind: "group-move",
      actorIds: simulation.actors.map(({ id }) => id),
      target: map.tileCenter(17, 6),
    });
    const outcomes = simulation.tick();
    expect(outcomes).toHaveLength(8);
    expect(outcomes.every(({ accepted }) => accepted)).toBe(true);
    const targets = simulation.actors.map(
      (actor) => actor.movement!.destination!,
    );
    expect(new Set(targets.map(({ x, z }) => `${x},${z}`)).size).toBe(8);
    for (let tick = 0; tick < 1500; tick += 1) {
      simulation.tick();
      for (const actor of simulation.actors) {
        const tile = map.tileAtWorldPosition(
          actor.worldPosition.x,
          actor.worldPosition.z,
        );
        expect(map.terrainAt(tile.x, tile.z).surfacePassable).not.toBe(false);
        expect(occupancy.blocksMovementAt(tile.x, tile.z, "surface")).toBe(
          false,
        );
      }
    }
    expect(simulation.actors.filter((actor) => actor.movement)).toEqual([]);
    for (const [index, actor] of simulation.actors.entries())
      expect(distance(actor.worldPosition, targets[index]!)).toBeLessThan(0.1);
    for (const a of simulation.actors)
      for (const b of simulation.actors)
        if (a.id !== b.id)
          expect(distance(a.worldPosition, b.worldPosition)).toBeGreaterThan(
            0.55,
          );
    simulation.dispose();
  });

  test("slot assignment, contact, and saved pending orders do not depend on actor or selection order", () => {
    const first = fixture();
    const initial = first.simulation.snapshot();
    const reversed = fixture([...initial.actors].reverse());
    const ids = initial.actors.map(({ id }) => id);
    first.simulation.submitCommand({
      kind: "group-move",
      actorIds: ids,
      target: first.map.tileCenter(17, 6),
    });
    reversed.simulation.submitCommand({
      kind: "group-move",
      actorIds: [...ids].reverse(),
      target: reversed.map.tileCenter(17, 6),
    });
    const pending = fixture(
      undefined,
      JSON.parse(JSON.stringify(first.simulation.snapshot())),
    );
    for (let tick = 0; tick < 120; tick += 1) {
      first.simulation.tick();
      reversed.simulation.tick();
      pending.simulation.tick();
    }
    expect(sortedActors(first.simulation.snapshot())).toEqual(
      sortedActors(reversed.simulation.snapshot()),
    );
    expect(pending.simulation.snapshot()).toEqual(first.simulation.snapshot());
    const resumed = fixture(undefined, first.simulation.snapshot());
    for (let tick = 0; tick < 120; tick += 1) {
      first.simulation.tick();
      resumed.simulation.tick();
    }
    expect(resumed.simulation.snapshot()).toEqual(first.simulation.snapshot());
    for (const item of [first, reversed, pending, resumed])
      item.simulation.dispose();
  });

  test("group ticks are identical at high and low render cadence", () => {
    const fast = fixture();
    const slow = fixture();
    for (const { simulation, map } of [fast, slow])
      simulation.submitCommand({
        kind: "group-move",
        actorIds: simulation.actors.map(({ id }) => id),
        target: map.tileCenter(17, 6),
      });
    const run = (simulation: typeof fast.simulation, step: number) => {
      let now = 0;
      const loop = startSimulationLoop(simulation, {
        pumpMilliseconds: 60000,
        maxCatchUpSeconds: 1,
        now: () => now,
      });
      for (now = step; now <= 2000; now += step) loop.advance();
      now = 2000;
      loop.advance();
      loop.stop();
    };
    run(fast.simulation, 5);
    run(slow.simulation, 200);
    expect(slow.simulation.snapshot()).toEqual(fast.simulation.snapshot());
    fast.simulation.dispose();
    slow.simulation.dispose();
  });

  test("blocked group clicks keep a distinct requested marker and use separate approach positions", () => {
    const { simulation, map } = fixture();
    const target = map.tileCenter(10, 4);
    simulation.submitCommand({
      kind: "group-move",
      actorIds: ["unit-0", "unit-1", "unit-0"],
      target,
    });
    const outcomes = simulation.tick();
    expect(outcomes).toHaveLength(2);
    expect(outcomes.every(({ accepted }) => accepted)).toBe(true);
    expect(simulation.actorById("unit-0")!.movement!.requestedTarget).toEqual(
      target,
    );
    expect(simulation.actorById("unit-1")!.movement!.requestedTarget).toEqual(
      target,
    );
    expect(simulation.actorById("unit-0")!.movement!.destination).not.toEqual(
      simulation.actorById("unit-1")!.movement!.destination,
    );
    simulation.dispose();
  });

  test("each profile resolves its own destination and unavailable actors keep their existing orders", () => {
    const { simulation, map } = fixture([]);
    map.setTerrain(1, 1, { typeId: "water" });
    simulation.spawnActor(
      createActor({
        id: "swimmer",
        definitionId: "swimmer",
        worldPosition: map.tileCenter(1, 1),
      }),
    );
    simulation.spawnActor(
      createActor({
        id: "trooper",
        definitionId: "trooper",
        worldPosition: map.tileCenter(3, 3),
      }),
    );
    simulation.submitCommand({
      kind: "move",
      actorId: "trooper",
      target: map.tileCenter(4, 3),
    });
    simulation.tick();
    const previous = simulation.actorById("trooper")!.movement!.target;
    // Stranded swimmer cannot get any closer; a missing actor also rejects.
    simulation.submitCommand({
      kind: "group-move",
      actorIds: ["swimmer", "trooper", "missing"],
      target: map.tileCenter(7, 3),
    });
    const outcomes = simulation.tick();
    expect(outcomes.map(({ accepted }) => accepted)).toEqual([
      false,
      false,
      true,
    ]);
    expect(simulation.actorById("swimmer")!.movement).toBeUndefined();
    expect(simulation.actorById("trooper")!.movement!.target).not.toEqual(
      previous,
    );
    simulation.dispose();
  });

  test("an approach slot never moves a stranded unit further from the click", () => {
    const { simulation, map } = fixture([]);
    for (let x = 1; x <= 5; x += 1) map.setTerrain(x, 1, { typeId: "water" });
    // The unselected swimmer holds the water tile nearest the click.
    for (const [id, x] of [
      ["a", 3],
      ["b", 4],
      ["c", 5],
    ] as const)
      simulation.spawnActor(
        createActor({
          id,
          definitionId: "swimmer",
          worldPosition: map.tileCenter(x, 1),
        }),
      );
    simulation.submitCommand({
      kind: "group-move",
      actorIds: ["a", "b"],
      target: map.tileCenter(7, 3),
    });
    expect(simulation.tick().map(({ accepted }) => accepted)).toEqual([
      true,
      false,
    ]);
    const slot = simulation.actorById("a")!.movement!.target;
    expect(map.tileAtWorldPosition(slot.x, slot.z)).toEqual({ x: 4, z: 1 });
    expect(simulation.actorById("b")!.movement).toBeUndefined();
    simulation.dispose();
  });

  test("submitted moves cannot carry a requested group target", () => {
    const { simulation, map } = fixture();
    simulation.submitCommand({
      kind: "move",
      actorId: "unit-0",
      target: map.tileCenter(6, 3),
      requestedTarget: map.tileCenter(10, 4),
    } as MissionCommand);
    const [outcome] = simulation.tick();
    expect(outcome!.accepted).toBe(true);
    expect(outcome!.command).not.toHaveProperty("requestedTarget");
    expect(
      simulation.actorById("unit-0")!.movement!.requestedTarget,
    ).toBeUndefined();
    simulation.dispose();
  });

  test("mixed profiles find destinations on their own terrain", () => {
    const { simulation, map } = fixture([]);
    for (let x = 1; x <= 5; x += 1) map.setTerrain(x, 1, { typeId: "water" });
    simulation.spawnActor(
      createActor({
        id: "swimmer",
        definitionId: "swimmer",
        worldPosition: map.tileCenter(1, 1),
      }),
    );
    simulation.spawnActor(
      createActor({
        id: "trooper",
        definitionId: "trooper",
        worldPosition: map.tileCenter(3, 3),
      }),
    );
    simulation.submitCommand({
      kind: "group-move",
      actorIds: ["trooper", "swimmer"],
      target: map.tileCenter(7, 3),
    });
    expect(simulation.tick().every(({ accepted }) => accepted)).toBe(true);
    const waterSlot = simulation.actorById("swimmer")!.movement!.target;
    const landSlot = simulation.actorById("trooper")!.movement!.target;
    expect(map.tileAtWorldPosition(waterSlot.x, waterSlot.z)).toEqual({
      x: 5,
      z: 1,
    });
    expect(map.tileAtWorldPosition(landSlot.x, landSlot.z)).toEqual({
      x: 7,
      z: 3,
    });
    simulation.dispose();
  });

  test("slot exhaustion leaves a rejected unit's prior order running", () => {
    const { simulation, map } = fixture([]);
    map.setTerrain(1, 1, { typeId: "water" });
    for (const id of ["a", "b"])
      simulation.spawnActor(
        createActor({
          id,
          definitionId: "swimmer",
          worldPosition: {
            ...map.tileCenter(1, 1),
            x: map.tileCenter(1, 1).x + (id === "a" ? -0.2 : 0.2),
          },
        }),
      );
    const previous = {
      ...map.tileCenter(1, 1),
      z: map.tileCenter(1, 1).z + 0.4,
    };
    simulation.submitCommand({ kind: "move", actorId: "b", target: previous });
    simulation.tick();
    simulation.submitCommand({
      kind: "group-move",
      actorIds: ["b", "a"],
      target: map.tileCenter(1, 1),
    });
    expect(simulation.tick().map(({ accepted }) => accepted)).toEqual([
      true,
      false,
    ]);
    expect(simulation.actorById("b")!.movement!.target).toEqual(previous);
    simulation.dispose();
  });

  test("Stop cancels every group route", () => {
    const { simulation, map } = fixture();
    simulation.submitCommand({
      kind: "group-move",
      actorIds: simulation.actors.map(({ id }) => id),
      target: map.tileCenter(17, 6),
    });
    simulation.tick();
    for (const { id } of simulation.actors)
      simulation.submitCommand({ kind: "stop", actorId: id });
    simulation.tick();
    expect(simulation.actors.every((actor) => !actor.movement)).toBe(true);
    simulation.dispose();
  });
});

describe("friendly separation", () => {
  test("a unit arriving this tick retains the correction budget of its actual travel", () => {
    const from = { x: -4, z: 0 };
    const target = { x: from.x + 0.01, z: from.z };
    const actors = ["a", "b"].map((id) =>
      createActor({ id, definitionId: "trooper", worldPosition: from }),
    );
    const { simulation } = fixture(actors);
    simulation.submitCommand({ kind: "move", actorId: "a", target });
    simulation.tick();
    const arrived = simulation.actorById("a")!;
    expect(arrived.movement).toBeUndefined();
    expect(distance(arrived.worldPosition, target)).toBeLessThanOrEqual(
      0.005 + 1e-9,
    );
    simulation.dispose();
  });

  test("coincident friendly units separate deterministically without crossing terrain blockers", () => {
    const point = { x: -0.65, z: -1.5 };
    const actors = ["a", "b"].map((id) =>
      createActor({ id, definitionId: "trooper", worldPosition: point }),
    );
    const first = fixture(actors);
    const second = fixture([...actors].reverse());
    for (let tick = 0; tick < 100; tick += 1) {
      first.simulation.tick();
      second.simulation.tick();
    }
    expect(sortedActors(first.simulation.snapshot())).toEqual(
      sortedActors(second.simulation.snapshot()),
    );
    const [a, b] = first.simulation.snapshot().actors;
    expect(distance(a.worldPosition, b.worldPosition)).toBeGreaterThan(0.59);
    for (const actor of first.simulation.actors) {
      const tile = first.map.tileAtWorldPosition(
        actor.worldPosition.x,
        actor.worldPosition.z,
      );
      expect(first.map.terrainAt(tile.x, tile.z).surfacePassable).not.toBe(
        false,
      );
    }
    first.simulation.dispose();
    second.simulation.dispose();
  });

  test("different occupancy layers do not separate", () => {
    const actors = ["a", "b"].map((id) =>
      createActor({
        id,
        definitionId: "trooper",
        worldPosition: { x: -4, z: 0 },
        occupancyLayer: id === "a" ? "surface" : "air",
      }),
    );
    const { simulation } = fixture(actors);
    simulation.tick();
    expect(simulation.actors[0].worldPosition).toEqual(
      simulation.actors[1].worldPosition,
    );
    simulation.dispose();
  });
});
