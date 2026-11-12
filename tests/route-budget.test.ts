import { expect, test } from "vitest";

import { createActor } from "../src/simulation/actor";
import {
  createMissionSimulation,
  createMissionState,
} from "../src/simulation/mission";
import { OccupancyGrid } from "../src/simulation/occupancy";
import { TerrainGrid } from "../src/simulation/terrain";
import { createTerrainMoveBehavior } from "../src/simulation/terrain-movement";

import type { ActorDefinition } from "../src/simulation/actor";
import type { MissionState } from "../src/simulation/mission";

const ground = {
  id: "ground",
  maxSlope: 1,
  slopeCostAtLimit: 1,
  terrainCosts: { plain: 1 },
};
const definitions: ActorDefinition[] = [
  {
    id: "unit",
    behaviorId: "move",
    movement: { speed: 1, profileId: "ground", radius: 0.3 },
  },
];
const SIZE = 80;

/** Columns of units on the west edge, each owner taking alternate rows. */
function mission(owners: string[], state?: MissionState) {
  const map = new TerrainGrid({ width: SIZE, height: SIZE, tileSize: 1 });
  const occupancy = new OccupancyGrid(map);
  const actors = Array.from({ length: 120 }, (_, index) =>
    createActor({
      id: `unit-${String(index).padStart(3, "0")}`,
      definitionId: "unit",
      owner: owners[index % owners.length]!,
      worldPosition: map.tileCenter(1 + (index % 4), 10 + (index >> 2) * 2),
    }),
  );
  return createMissionSimulation({
    map,
    occupancy,
    state:
      state ??
      createMissionState(
        actors,
        owners.map((id) => ({ id })),
        owners[0],
      ),
    definitions,
    bounds: map.worldBounds,
    tickSeconds: 1 / 60,
    behaviorRegistry: new Map([
      ["move", createTerrainMoveBehavior(map, occupancy, [ground])],
    ]),
  });
}

const waiting = (simulation: ReturnType<typeof mission>) =>
  simulation.actors.filter(
    (actor) => actor.movement && !actor.movement.waypoints,
  );

const orderAcross = (simulation: ReturnType<typeof mission>) => {
  for (const owner of simulation.owners.map(({ id }) => id))
    simulation.submitCommand(
      {
        kind: "group-move",
        actorIds: simulation.actors
          .filter((actor) => actor.owner === owner)
          .map(({ id }) => id),
        target: { x: SIZE / 2 - 5, z: 0 },
      },
      { owner },
    );
};

test("a large group order spreads its route searches over ticks", () => {
  const simulation = mission(["player"]);
  orderAcross(simulation);
  const outcomes = simulation.tick();
  // Every member is accepted at once; only its route search waits.
  expect(outcomes.every(({ accepted }) => accepted)).toBe(true);
  const first = waiting(simulation);
  expect(first.length).toBeGreaterThan(0);
  expect(first.length).toBeLessThan(simulation.actors.length);
  const start = simulation.snapshot();
  simulation.tick();
  // Waiting units hold still until their routes are planned.
  for (const actor of waiting(simulation))
    expect(actor.worldPosition).toEqual(
      start.actors.find(({ id }) => id === actor.id)!.worldPosition,
    );
  for (
    let tick = 0;
    tick < simulation.actors.length && waiting(simulation).length;
    tick++
  ) {
    const count = waiting(simulation).length;
    simulation.tick();
    expect(waiting(simulation).length).toBeLessThan(count);
  }
  expect(waiting(simulation)).toEqual([]);
  simulation.dispose();
});

test("owners take turns with the route budget", () => {
  const simulation = mission(["east", "west"]);
  orderAcross(simulation);
  simulation.tick();
  const planned = (owner: string) =>
    simulation.actors.filter(
      (actor) => actor.owner === owner && actor.movement?.waypoints,
    ).length;
  expect(Math.abs(planned("east") - planned("west"))).toBeLessThanOrEqual(1);
  simulation.dispose();
});

test("waiting routes continue identically after save and load", () => {
  const original = mission(["east", "west"]);
  orderAcross(original);
  original.tick();
  expect(waiting(original).length).toBeGreaterThan(0);
  const restored = mission(
    ["east", "west"],
    JSON.parse(JSON.stringify(original.snapshot())),
  );
  for (let tick = 0; tick < 5; tick++) {
    original.tick();
    restored.tick();
  }
  expect(restored.snapshot()).toEqual(original.snapshot());
  original.dispose();
  restored.dispose();
});

test("routes that waited longer are searched first", () => {
  const simulation = mission(["player"]);
  orderAcross(simulation);
  simulation.tick();
  const older = new Set(waiting(simulation).map(({ id }) => id));
  // A planned low-ID unit asks again, behind the routes already waiting.
  const [first] = simulation.actors.filter(
    (actor) => actor.movement?.waypoints,
  );
  simulation.submitCommand(
    { kind: "move", actorId: first!.id, target: { x: SIZE / 2 - 5, z: 20 } },
    { owner: "player" },
  );
  while (waiting(simulation).length) {
    simulation.tick();
    const still = new Set(waiting(simulation).map(({ id }) => id));
    if (!still.has(first!.id))
      expect([...older].filter((id) => still.has(id))).toEqual([]);
  }
  simulation.dispose();
});
