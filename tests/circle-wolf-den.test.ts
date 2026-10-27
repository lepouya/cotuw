import { createActor } from "../src/simulation/actor";
import { expect, test } from "vitest";
import { LEVEL_SOURCES } from "../src/content/levels";
import {
  createSessionSimulation,
  loadMission,
  missionTerrain,
} from "../src/mission-loading";
import { createScenarioMap } from "../src/simulation/scenario";
import { playerFactionOf } from "../src/simulation/ownership";
import { serializeMission } from "../src/simulation/mission-file";
import { SIMULATION_TICK_SECONDS } from "../src/simulation/clock";
import { advanceSeconds } from "./helpers/scenario";
import { BASE_CONTENT } from "./helpers/content";

import type { MissionSimulation } from "../src/simulation/mission";

const opening = () => loadMission(LEVEL_SOURCES.get("circle-wolf-den")!);
const sentinelIds = Array.from(
  { length: 5 },
  (_, index) => `starting-sentinel-${index + 1}`,
);

test("the Circle opening uses shared wildlife, a paid worker bootstrap, and normal fog", () => {
  const circle = opening();
  const arc = loadMission(LEVEL_SOURCES.get("arc-economy-opening")!);
  expect(playerFactionOf(circle.state)).toBe("circle");
  expect(circle.state.terrain).toEqual(arc.state.terrain);
  expect(circle.state.actors.filter(({ territory }) => territory)).toEqual(
    arc.state.actors.filter(({ territory }) => territory),
  );
  expect(circle.state.economy!.cultivation).toMatchObject({
    lifebloom: 150,
    workers: [],
  });
  expect(circle.state.economy!.cultivation!.sites).toHaveLength(2);
  expect(
    circle.state.actors.filter(({ tilePlacement }) => tilePlacement),
  ).toHaveLength(1);
  expect(circle.state.actors).toHaveLength(7);
  expect(
    circle.state.actors.some(
      ({ definitionId }) => definitionId === "circle-cultivator",
    ),
  ).toBe(false);
  const simulation = createSessionSimulation(circle);
  try {
    expect(simulation.fog).toBeDefined();
    expect(
      simulation.detects("player", simulation.actorById("lone-wolf")!),
    ).toBe(false);
    expect(
      simulation.detects(
        "player",
        simulation.actorById("starting-heartgrove")!,
      ),
    ).toBe(true);
  } finally {
    simulation.dispose();
  }
});

test("Circle infantry preserve the selected roles independently of ARC tuning", () => {
  const actor = (id: string) =>
    BASE_CONTENT.actors.find((actor) => actor.id === id)!;
  const sentinel = actor("circle-sentinel");
  const wayfinder = actor("circle-wayfinder");
  expect(sentinel.health).toBeGreaterThan(actor("arc-trooper").health!);
  expect(sentinel.weapon!.range).toBeLessThan(
    actor("arc-trooper").weapon!.range,
  );
  expect(wayfinder.weapon).toBeUndefined();
  expect(wayfinder.health).toBeLessThan(sentinel.health!);
  expect(wayfinder.movement!.speed).toBeGreaterThan(sentinel.movement!.speed);
  expect(wayfinder.vision!.radius).toBeGreaterThan(sentinel.vision!.radius);
});

test("a prepared Circle force clears both encounters and continues identically after a combat save", () => {
  const mission = opening();
  const map = createScenarioMap(missionTerrain(mission));
  for (const [index, id] of sentinelIds.entries())
    mission.state.actors.push(
      createActor({
        id,
        definitionId: "circle-sentinel",
        owner: "player",
        worldPosition: map.tileCenter(
          10 + (index % 3) * 2,
          50 + Math.floor(index / 3) * 2,
        ),
      }),
    );
  const simulation = createSessionSimulation(mission);
  let restored: MissionSimulation | undefined;
  const order = (
    sim: MissionSimulation,
    kind: "group-move" | "group-attack-move",
    x: number,
    z: number,
    seconds: number,
  ) => {
    sim.submitCommand({
      kind,
      actorIds: sentinelIds,
      target: map.tileCenter(x, z),
    });
    advanceSeconds(sim, seconds);
  };
  try {
    order(simulation, "group-move", 24, 42, 10);
    order(simulation, "group-move", 34, 36, 10);
    simulation.submitCommand({
      kind: "group-attack-move",
      actorIds: sentinelIds,
      target: map.tileCenter(52, 32),
    });
    for (let tick = 0; tick < 600; tick++) {
      simulation.tick();
      if (simulation.actors.some(({ combat }) => combat?.attack)) break;
    }
    expect(simulation.actors.some(({ combat }) => combat?.attack)).toBe(true);
    const saved = loadMission(
      serializeMission(
        mission.scenario,
        simulation.snapshot(),
        SIMULATION_TICK_SECONDS,
      ),
    );
    restored = createSessionSimulation(saved);
    advanceSeconds(simulation, 15);
    advanceSeconds(restored, 15);
    expect(restored.snapshot()).toEqual(simulation.snapshot());
    expect(simulation.objectives[1]!.status).toBe("complete");
    expect(simulation.result).toBeUndefined();
    order(simulation, "group-move", 57, 35, 8);
    order(simulation, "group-move", 70, 34, 10);
    order(simulation, "group-move", 77, 36, 8);
    order(simulation, "group-move", 77, 35, 5);
    order(simulation, "group-attack-move", 78, 21, 40);
    expect(simulation.result?.kind).toBe("victory");
    expect(
      simulation.objectives
        .filter(({ progress }) => progress)
        .every(({ status }) => status === "complete"),
    ).toBe(true);
    const result = simulation.result;
    order(simulation, "group-move", 77, 35, 1);
    expect(simulation.result).toEqual(result);
    restored.dispose();
    restored = createSessionSimulation(
      loadMission(
        serializeMission(
          mission.scenario,
          simulation.snapshot(),
          SIMULATION_TICK_SECONDS,
        ),
      ),
    );
    expect(restored.result).toEqual(result);
  } finally {
    restored?.dispose();
    simulation.dispose();
  }
}, 20_000);

test("the authored paid opening delivers Lifebloom and reveals the second cultivation site", () => {
  const sim = createSessionSimulation(opening());
  const until = (condition: () => boolean) => {
    for (let tick = 0; tick < 6000 && !condition(); tick++) sim.tick();
    expect(condition()).toBe(true);
  };
  try {
    sim.submitCommand({
      kind: "train-unit",
      actorId: "worker",
      producerId: "starting-heartgrove",
      definitionId: "circle-cultivator",
    });
    until(() => !!sim.actorById("worker"));
    sim.submitCommand({
      kind: "place-actor",
      actorId: "conservatory",
      definitionId: "circle-conservatory",
      origin: { x: 16, z: 50 },
      workerIds: ["worker"],
    });
    until(
      () =>
        !!sim.actorById("conservatory") &&
        !sim.actorById("conservatory")!.construction,
    );
    sim.submitCommand({
      kind: "gather",
      actorId: "worker",
      siteId: "near-lifebloom",
    });
    until(() => sim.economy!.cultivation!.lifebloom >= 30);
    const second = sim.economy!.cultivation!.sites[1]!;
    expect(sim.economy!.cultivation!.lifebloom).toBe(30);
    expect(sim.economy!.materials).toBe(0);
    expect(sim.fog!.isExplored(second.tile.x, second.tile.z)).toBe(true);
  } finally {
    sim.dispose();
  }
});

test("Circle gifts reward Lifebloom once and retain collection through a save", () => {
  const mission = opening();
  const map = createScenarioMap(missionTerrain(mission));
  const gifts = mission.state.economy!.loot;
  expect(gifts).toHaveLength(2);
  expect(
    gifts.every(
      (gift) => gift.lifebloom === 25 && gift.materials === undefined,
    ),
  ).toBe(true);
  const sim = createSessionSimulation(mission);
  let restored: MissionSimulation | undefined;
  try {
    expect(
      gifts.every(({ tile }) => !sim.fog!.isExplored(tile.x, tile.z)),
    ).toBe(true);
    sim.spawnActor(
      createActor({
        id: "gift-collector",
        definitionId: "circle-wayfinder",
        owner: "player",
        worldPosition: map.tileCenter(gifts[0]!.tile.x, gifts[0]!.tile.z),
      }),
    );
    sim.tick();
    expect(sim.economy!.cultivation!.lifebloom).toBe(175);
    expect(sim.economy!.cultivation!.depositedLifebloom).toBe(0);
    expect(sim.economy!.materials).toBe(0);
    expect(sim.economy!.loot[0]!.collected).toBe(true);
    restored = createSessionSimulation(
      loadMission(
        serializeMission(
          mission.scenario,
          sim.snapshot(),
          SIMULATION_TICK_SECONDS,
        ),
      ),
    );
    sim.tick();
    restored.tick();
    expect(restored.snapshot()).toEqual(sim.snapshot());
    expect(restored.economy!.cultivation!.lifebloom).toBe(175);
  } finally {
    restored?.dispose();
    sim.dispose();
  }
});
