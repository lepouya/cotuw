import { expect, test } from "vitest";

import {
  advanceSeconds,
  balance,
  command,
  deposited,
  spawnUnit,
  untilSeconds,
} from "./helpers/scenario";
import { createActor } from "../src/simulation/actor";
import { LEVEL_SOURCES } from "../src/content/levels";
import {
  createSessionSimulation,
  loadMission,
  missionTerrain,
} from "../src/mission-loading";
import { createScenarioMap } from "../src/simulation/scenario";
import { factionOf } from "../src/simulation/ownership";
import { serializeMission } from "../src/simulation/mission-file";
import { SIMULATION_TICK_SECONDS } from "../src/simulation/clock";

import type { LoadedMission } from "../src/mission-loading";
import type { MissionSimulation } from "../src/simulation/mission";
import type { MissionCommand } from "../src/simulation/command";

const opening = () => loadMission(LEVEL_SOURCES.get("circle-wolf-den")!);
const reload = (mission: LoadedMission, simulation: MissionSimulation) =>
  createSessionSimulation(
    loadMission(
      serializeMission(
        mission.scenario,
        simulation.snapshot(),
        SIMULATION_TICK_SECONDS,
      ),
    ),
  );
const sentinelIds = Array.from(
  { length: 5 },
  (_, index) => `starting-sentinel-${index + 1}`,
);

test("the Circle opening uses shared wildlife, a paid worker bootstrap, and normal fog", () => {
  const circle = opening();
  const arc = loadMission(LEVEL_SOURCES.get("arc-economy-opening")!);
  expect(factionOf(circle.state.owners, circle.state.playerOwner)).toBe(
    "circle",
  );
  expect(circle.state.terrain).toEqual(arc.state.terrain);
  expect(circle.scenario.flocks).toEqual(arc.scenario.flocks);
  expect(circle.scenario.flocks).toHaveLength(1);
  expect(circle.state.actors.filter(({ territory }) => territory)).toEqual(
    arc.state.actors.filter(({ territory }) => territory),
  );
  expect(balance(circle.state, "lifebloom")).toBe(150);
  expect(circle.state.economy!.cultivation!.workers).toEqual([]);
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
  expect(simulation.viewOf(simulation.playerOwner).knowledge.fog).toBeDefined();
  expect(simulation.detects("player", simulation.actorById("lone-wolf")!)).toBe(
    false,
  );
  expect(
    simulation.detects("player", simulation.actorById("starting-heartgrove")!),
  ).toBe(true);
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
  const order = (
    sim: MissionSimulation,
    kind: "group-move" | "group-attack-move",
    x: number,
    z: number,
    seconds: number,
  ) => {
    sim.submitCommand(
      {
        kind,
        actorIds: sentinelIds,
        target: map.tileCenter(x, z),
      },
      { owner: sim.playerOwner },
    );
    advanceSeconds(sim, seconds);
  };
  order(simulation, "group-move", 24, 42, 10);
  order(simulation, "group-move", 34, 36, 10);
  simulation.submitCommand(
    {
      kind: "group-attack-move",
      actorIds: sentinelIds,
      target: map.tileCenter(52, 32),
    },
    { owner: simulation.playerOwner },
  );
  for (let tick = 0; tick < 600; tick++) {
    simulation.tick();
    if (simulation.actors.some(({ combat }) => combat?.attack)) break;
  }
  expect(simulation.actors.some(({ combat }) => combat?.attack)).toBe(true);
  const restored = reload(mission, simulation);
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
  expect(reload(mission, simulation).result).toEqual(result);
}, 20_000);

test("the authored paid opening delivers Lifebloom, reveals the second site, and funds both infantry roles", () => {
  const sim = createSessionSimulation(opening());
  const until = (condition: () => boolean) => untilSeconds(sim, condition);
  const order = (value: MissionCommand) =>
    expect(command(sim, value)).toMatchObject({ accepted: true });
  const grow = (
    actorId: string,
    definitionId: string,
    x: number,
    z: number,
  ) => {
    order({
      kind: "place-actor",
      actorId,
      definitionId,
      origin: { x, z },
      workerIds: ["worker"],
    });
    until(() => !sim.actorById(actorId)!.construction);
  };
  order({
    kind: "train-unit",
    actorId: "worker",
    producerId: "starting-heartgrove",
    definitionId: "circle-cultivator",
  });
  until(() => !!sim.actorById("worker"));
  const cultivate = () =>
    order({ kind: "gather", actorId: "worker", siteId: "near-lifebloom" });
  grow("conservatory", "circle-conservatory", 16, 50);
  expect(balance(sim, "lifebloom")).toBe(0);
  cultivate();
  until(() => deposited(sim, "lifebloom") > 0);
  expect(balance(sim, "lifebloom")).toBe(30);
  const second = sim.economy!.cultivation!.sites[1]!;
  expect(
    sim
      .viewOf(sim.playerOwner)
      .knowledge.fog!.isExplored(second.tile.x, second.tile.z),
  ).toBe(true);
  until(() => balance(sim, "lifebloom") >= 100);
  grow("muster", "circle-musterhall", 12, 54);
  cultivate();
  until(() => balance(sim, "lifebloom") >= 55);
  for (const [actorId, definitionId] of [
    ["sentinel", "circle-sentinel"],
    ["wayfinder", "circle-wayfinder"],
  ] as const)
    order({ kind: "train-unit", actorId, producerId: "muster", definitionId });
  until(() => !!sim.actorById("sentinel") && !!sim.actorById("wayfinder"));
  expect(balance(sim)).toBe(0);
  expect(sim.economy!.loot.every(({ collected }) => !collected)).toBe(true);
});

test.each([
  ["circle-wayfinder", true],
  ["circle-sentinel", false],
])("%s ordinary vision detects a wolf 11 tiles away: %s", (id, detects) => {
  const mission = opening();
  const map = createScenarioMap(missionTerrain(mission));
  const sim = createSessionSimulation(mission);
  const wolf = sim.actorById("lone-wolf")!;
  const { x, z } = wolf.worldPosition;
  spawnUnit(sim, "viewer", id, { x: x - 11 * map.tileSize, z });
  sim.tick();
  expect(sim.detects(sim.playerOwner, wolf)).toBe(detects);
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
  expect(
    gifts.every(
      ({ tile }) =>
        !sim.viewOf(sim.playerOwner).knowledge.fog!.isExplored(tile.x, tile.z),
    ),
  ).toBe(true);
  spawnUnit(
    sim,
    "gift-collector",
    "circle-wayfinder",
    map.tileCenter(gifts[0]!.tile.x, gifts[0]!.tile.z),
  );
  sim.tick();
  expect(balance(sim, "lifebloom")).toBe(175);
  expect(deposited(sim, "lifebloom")).toBe(0);
  expect(balance(sim)).toBe(0);
  expect(sim.economy!.loot[0]!.collected).toBe(true);
  const restored = reload(mission, sim);
  sim.tick();
  restored.tick();
  expect(restored.snapshot()).toEqual(sim.snapshot());
  expect(balance(restored, "lifebloom")).toBe(175);
});
