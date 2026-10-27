import {
  harvestingRecoveryCost,
  harvestingStalled,
} from "../src/simulation/economy";
import { createActor } from "../src/simulation/actor";
import type { ActorDefinition } from "../src/simulation/actor";
import { describe, expect, test } from "vitest";
import { ARC_ACTOR_DEFINITIONS, BASE_CONTENT } from "./helpers/content";
import { SIMULATION_TICK_SECONDS } from "../src/simulation/clock";
import { LEVEL_SOURCES } from "../src/content/levels";
import { createMissionSimulation } from "../src/simulation/mission";
import {
  createScenarioState,
  defineScenario,
} from "../src/simulation/scenario";
import { parseMission, serializeMission } from "../src/simulation/mission-file";
import { TerrainGrid } from "../src/simulation/terrain";
import { OccupancyGrid } from "../src/simulation/occupancy";
import { createTerrainMoveBehavior } from "../src/simulation/terrain-movement";
import type {
  MissionState,
  MissionSimulation,
} from "../src/simulation/mission";
import type { MissionCommand } from "../src/simulation/command";
import {
  balance,
  command,
  deposited,
  exploredScenarioState,
  playerOwners,
  setBalance,
  stockpiles,
} from "./helpers/scenario";

const definitions = ARC_ACTOR_DEFINITIONS;
const mapOptions = {
  width: 30,
  height: 20,
  tileSize: 1,
  terrainTypeIds: ["plain", "path", "rough", "water"],
};
const contentMap = new TerrainGrid(mapOptions);
const scenario = defineScenario({
  id: "economy-test",
  ...playerOwners("arc"),
  tileSize: 1,
  terrainTypeIds: ["plain", "path", "rough", "water"],
  terrain: contentMap.terrainState(),
  buildings: [
    {
      actorId: "cc",
      definitionId: "arc-command-center-prototype",
      origin: { x: 2, z: 6 },
    },
  ],
  stockpiles: stockpiles(150),
  sites: [
    {
      id: "site",
      name: "Near Materials",
      tile: { x: 14, z: 6 },
      initialMaterials: 150,
      remainingMaterials: 150,
    },
    {
      id: "neighbor",
      name: "Near Materials",
      tile: { x: 15, z: 6 },
      initialMaterials: 40,
      remainingMaterials: 40,
    },
    {
      id: "far",
      name: "Far Materials",
      tile: { x: 22, z: 6 },
      initialMaterials: 100,
      remainingMaterials: 100,
    },
  ],
  loot: [
    {
      id: "loot",
      name: "Salvage",
      tile: { x: 22, z: 10 },
      materials: 25,
      collected: false,
    },
  ],
});
function fixture(
  state?: MissionState,
  tickSeconds = 1,
  fault: boolean | "move" = false,
  content: readonly ActorDefinition[] = definitions,
) {
  const map = new TerrainGrid(mapOptions);
  const occupancy = new OccupancyGrid(map);
  const movement = createTerrainMoveBehavior(map, occupancy, [
    {
      id: "surface-ground",
      maxSlope: 0.75,
      slopeCostAtLimit: 2,
      terrainCosts: { plain: 1, path: 0.8, rough: 2.25, water: null },
    },
  ]);
  if (fault === "move")
    movement.handleCommand = () => {
      throw new Error("test move fault");
    };
  const simulation = createMissionSimulation({
    state: state ?? exploredScenarioState(scenario, definitions),
    definitions: content,
    map,
    occupancy,
    tickSeconds,
    bounds: map.worldBounds,
    behaviorRegistry: new Map([
      ["terrain-move", movement],
      [
        "idle",
        {
          handleCommand: () => false,
          update: () => {
            if (fault === true) throw new Error("test fault");
          },
        },
      ],
    ]),
  });
  return { simulation, map, occupancy };
}
function advance(simulation: MissionSimulation, ticks: number) {
  for (let tick = 0; tick < ticks; tick++) simulation.tick();
}
function until(
  simulation: MissionSimulation,
  predicate: () => boolean,
  limit = 300,
) {
  for (let tick = 0; tick < limit && !predicate(); tick++) simulation.tick();
  expect(predicate()).toBe(true);
}
const build = (id = "refinery", x = 6, z = 6): MissionCommand => ({
  kind: "place-actor",
  actorId: id,
  definitionId: "arc-materials-refinery",
  origin: { x, z },
});
function finishBuilding(simulation: MissionSimulation, id = "refinery") {
  until(simulation, () => !simulation.actorById(id)?.construction);
}
function workerFixture(tickSeconds = 1) {
  const context = fixture(undefined, tickSeconds);
  const { simulation } = context;
  expect(command(simulation, build()).accepted).toBe(true);
  finishBuilding(simulation);
  expect(
    command(simulation, {
      kind: "train-unit",
      producerId: "refinery",
      actorId: "worker",
      definitionId: "arc-harvester",
    }).accepted,
  ).toBe(true);
  until(
    simulation,
    () => !!simulation.actorById("worker"),
    Math.ceil(7 / tickSeconds),
  );
  return context;
}
const worker = (simulation: MissionSimulation) =>
  simulation.economy!.harvesters[0];
const gather = (siteId = "site"): MissionCommand => ({
  kind: "gather",
  actorId: "worker",
  siteId,
});

test("scripted worker enrollment rejects an absent economy before publishing the actor", () => {
  const { simulation, map } = fixture(undefined, 1, false, BASE_CONTENT.actors);
  try {
    const before = simulation.snapshot();
    const position = map.tileCenter(10, 10);
    expect(() =>
      simulation.spawnActor(
        createActor({
          id: "scripted-worker",
          definitionId: "circle-cultivator",
          owner: "player",
          worldPosition: position,
        }),
      ),
    ).toThrow("cultivation state");
    expect(simulation.snapshot()).toEqual(before);
    simulation.spawnActor(
      createActor({
        id: "scripted-worker",
        definitionId: "arc-trooper",
        owner: "player",
        worldPosition: position,
      }),
    );
    expect(simulation.actorById("scripted-worker")!.definitionId).toBe(
      "arc-trooper",
    );
  } finally {
    simulation.dispose();
  }
});

test("a zero price cannot spend a resource the mission does not hold", () => {
  const content = definitions.map((definition) => {
    if (definition.id === "arc-trooper")
      return { ...definition, materialsCost: undefined, lifebloomCost: 0 };
    if (definition.id === "arc-command-center-prototype")
      return {
        ...definition,
        production: { unitDefinitionIds: ["arc-trooper"] },
      };
    return definition;
  });
  const { simulation } = fixture(undefined, 1, false, content);
  try {
    const producer = simulation.actors.find(
      ({ definitionId }) => definitionId === "arc-command-center-prototype",
    )!;
    expect(
      command(simulation, {
        kind: "train-unit",
        actorId: "free-trooper",
        definitionId: "arc-trooper",
        producerId: producer.id,
      }),
    ).toMatchObject({ accepted: false, reason: "insufficient-resources" });
    expect(() => simulation.tick()).not.toThrow();
    expect(simulation.economy!.production).toEqual([]);
  } finally {
    simulation.dispose();
  }
});

test.each([
  { capacity: 7, loadSeconds: 10, cargo: [0, 1, 2, 2, 3, 4, 4, 5, 6, 7] },
  { capacity: 1_000_000_000, loadSeconds: 1, cargo: [1_000_000_000] },
])(
  "harvesting conserves Materials with capacity $capacity and load time $loadSeconds",
  ({ capacity, loadSeconds, cargo }) => {
    const { simulation: opening, map } = workerFixture();
    const state = opening.snapshot();
    const actor = state.actors.find(({ id }) => id === "worker")!;
    actor.worldPosition = map.tileCenter(14, 6);
    const worker = state.economy!.harvesters[0]!;
    worker.phase = "gathering";
    worker.targetSiteId = worker.activeSiteId = "site";
    const site = state.economy!.sites.find(({ id }) => id === "site")!;
    site.initialMaterials = site.remainingMaterials = capacity + 2;
    const content = definitions.map((definition) =>
      definition.harvesting
        ? {
            ...definition,
            harvesting: { ...definition.harvesting, capacity, loadSeconds },
          }
        : definition,
    );
    const { simulation } = fixture(state, 1, false, content);
    for (const expected of cargo) {
      simulation.tick();
      expect(simulation.economy!.harvesters[0]!.cargo).toBe(expected);
      expect(simulation.economy!.sites[0]!.remainingMaterials + expected).toBe(
        capacity + 2,
      );
    }
    expect(simulation.economy!.harvesters[0]!.phase).toBe("returning");
    expect(simulation.economy!.harvesters[0]!.gatherProgress).toBe(0);
  },
);

describe("Materials economy", () => {
  test("an armed Harvester's attack interrupts gathering", () => {
    const rifle = definitions.find(
      (definition) => definition.id === "arc-trooper",
    )!;
    const armed = definitions.map((definition) =>
      definition.harvesting
        ? { ...definition, weapon: rifle.weapon }
        : definition,
    );
    const { simulation } = fixture(undefined, 1, false, armed);
    command(simulation, build());
    finishBuilding(simulation);
    command(simulation, {
      kind: "train-unit",
      producerId: "refinery",
      actorId: "worker",
      definitionId: "arc-harvester",
    });
    until(simulation, () => !!simulation.actorById("worker"));
    command(simulation, gather());
    const point = simulation.actorById("worker")!.worldPosition;
    simulation.spawnActor(
      createActor({
        id: "enemy",
        definitionId: "arc-trooper",
        owner: "wildlife",
        worldPosition: { x: point.x + 1, z: point.z },
      }),
    );
    const outcome = command(simulation, {
      kind: "attack",
      actorId: "worker",
      targetId: "enemy",
    });
    expect(outcome.accepted).toBe(true);
    expect(worker(simulation).phase).toBe("idle");
    expect(worker(simulation).targetSiteId).toBeUndefined();
    expect(simulation.actorById("worker")!.combat?.attack?.targetId).toBe(
      "enemy",
    );
  });

  test("queued movement waits for Gather depletion and the final delivery", () => {
    const { simulation, map } = workerFixture();
    command(simulation, gather());
    const target = map.tileCenter(24, 10);
    const outcome = command(simulation, {
      kind: "move",
      actorId: "worker",
      target,
      queued: true,
    });
    expect(outcome.queued).toBe(true);
    until(
      simulation,
      () =>
        simulation
          .economy!.sites.slice(0, 2)
          .every((site) => site.remainingMaterials === 0),
      1000,
    );
    until(simulation, () => !simulation.actorById("worker")!.orders, 1000);
    expect(worker(simulation).cargo).toBe(0);
    expect(deposited(simulation)).toBe(190);
    until(simulation, () => !simulation.actorById("worker")!.movement);
    expect(simulation.actorById("worker")!.worldPosition).toEqual(target);
  });

  test("authored Harvesters start unassigned and can join a Refinery", () => {
    const content = defineScenario({
      ...scenario,
      units: [
        {
          actorId: "worker",
          definitionId: "arc-harvester",
          tile: { x: 12, z: 8 },
        },
      ],
    });
    const state = exploredScenarioState(content, definitions);
    const { simulation } = fixture(state);
    expect(worker(simulation)).toEqual({
      actorId: "worker",
      cargo: 0,
      gatherProgress: 0,
      phase: "unassigned",
    });
    command(simulation, build());
    finishBuilding(simulation);
    expect(
      command(simulation, {
        kind: "assign-refinery",
        actorId: "worker",
        refineryId: "refinery",
      }).accepted,
    ).toBe(true);
    expect(worker(simulation).phase).toBe("idle");
    expect(worker(simulation).refineryId).toBe("refinery");
    expect(fixture(simulation.snapshot()).simulation.snapshot()).toEqual(
      simulation.snapshot(),
    );
  });

  test("starts with a fixed Command Center and exactly enough for the first economic pair", () => {
    const level = () =>
      parseMission(
        LEVEL_SOURCES.get("arc-economy-opening")!,
        SIMULATION_TICK_SECONDS,
      ).state;
    const state = level();
    expect(
      state.actors
        .filter((actor) => actor.definitionId.startsWith("arc-"))
        .map((actor) => actor.definitionId),
    ).toEqual(["arc-command-center-prototype"]);
    expect(balance(state)).toBe(150);
    const independent = level();
    state.economy!.sites[0].remainingMaterials = 0;
    expect(independent.economy!.sites[0].remainingMaterials).toBe(200);
  });

  test("paid blueprints reserve footprints and one construction slot before becoming operational", () => {
    const state = exploredScenarioState(scenario, definitions);
    setBalance(state, 300);
    const { simulation, occupancy } = fixture(state);
    simulation.submitCommand(build());
    simulation.submitCommand({
      kind: "place-actor",
      actorId: "barracks",
      definitionId: "arc-field-barracks",
      origin: { x: 9, z: 10 },
    });
    expect(simulation.tick().every((outcome) => outcome.accepted)).toBe(true);
    expect(balance(simulation)).toBe(100);
    expect(occupancy.ownerAt(6, 6, "surface")).toBe("refinery");
    expect(simulation.actorById("refinery")!.construction).toMatchObject({
      completedTicks: 1,
      totalTicks: 8,
    });
    expect(simulation.actorById("barracks")!.construction!.completedTicks).toBe(
      0,
    );
    expect(
      command(simulation, {
        kind: "train-unit",
        producerId: "refinery",
        actorId: "worker",
        definitionId: "arc-harvester",
      }),
    ).toMatchObject({ accepted: false, reason: "under-construction" });
    expect(balance(simulation)).toBe(100);
    advance(simulation, 5);
    expect(simulation.actorById("refinery")!.construction!.completedTicks).toBe(
      7,
    );
    simulation.tick();
    expect(simulation.actorById("refinery")!.construction).toBeUndefined();
    expect(simulation.actorById("barracks")!.construction!.completedTicks).toBe(
      0,
    );
    expect(
      simulation.evaluateTraining({
        kind: "train-unit",
        producerId: "refinery",
        actorId: "worker",
        definitionId: "arc-harvester",
      }).accepted,
    ).toBe(true);
    advance(simulation, 8);
    expect(simulation.actorById("barracks")!.construction).toBeUndefined();
    expect(
      command(simulation, { kind: "cancel-construction", actorId: "barracks" })
        .accepted,
    ).toBe(false);
  });

  test("cancelling a blueprint refunds all spending, frees its footprint and advances the queue", () => {
    const state = exploredScenarioState(scenario, definitions);
    setBalance(state, 300);
    const { simulation, occupancy } = fixture(state);
    command(simulation, build());
    command(simulation, build("next", 9, 9));
    expect(
      command(simulation, { kind: "sell-actor", actorId: "refinery" }).accepted,
    ).toBe(false);
    expect(
      command(simulation, { kind: "cancel-construction", actorId: "refinery" })
        .accepted,
    ).toBe(true);
    expect(balance(simulation)).toBe(200);
    expect(simulation.actorById("refinery")).toBeUndefined();
    expect(occupancy.ownerAt(6, 6, "surface")).toBeUndefined();
    expect(simulation.actorById("next")!.construction!.completedTicks).toBe(1);
    expect(simulation.unusedActorId("refinery")).toBe("refinery1");
    expect(
      command(simulation, { kind: "cancel-construction", actorId: "refinery" })
        .accepted,
    ).toBe(false);
    expect(balance(simulation)).toBe(200);
    simulation.removeActor("next");
    expect(balance(simulation)).toBe(200);
  });

  test("unfinished Refineries reject assignments without interrupting a worker", () => {
    const { simulation } = workerFixture();
    const state = simulation.snapshot();
    setBalance(state, 100);
    const restored = fixture(state).simulation;
    command(restored, build("next", 9, 9));
    expect(
      command(restored, {
        kind: "assign-refinery",
        actorId: "worker",
        refineryId: "next",
      }),
    ).toMatchObject({ accepted: false, reason: "missing-refinery" });
    expect(worker(restored).refineryId).toBe("refinery");
  });

  test("restoration rejects invalid blueprint progress and investment", () => {
    const { simulation } = fixture();
    command(simulation, build());
    for (const patch of [
      { completedTicks: -1 },
      { completedTicks: 8 },
      { totalTicks: 9 },
      { paidCost: 99 },
    ]) {
      const saved = simulation.snapshot();
      Object.assign(
        saved.actors.find((actor) => actor.id === "refinery")!.construction!,
        patch,
      );
      expect(() => fixture(saved)).toThrow("invalid construction");
    }
  });

  test("recovery costs use completed, empty Refineries of the matching worker type", () => {
    const { simulation } = fixture();
    const otherWorker: ActorDefinition = {
      ...definitions.find((definition) => definition.harvesting)!,
      id: "other-worker",
      materialsCost: 10,
    };
    const otherRefinery: ActorDefinition = {
      ...definitions.find((definition) => definition.refinery)!,
      id: "other-refinery",
      materialsCost: 200,
      refinery: { harvesterDefinitionId: "other-worker" },
      production: { unitDefinitionIds: ["other-worker"] },
    };
    const content = new Map(
      [...definitions, otherWorker, otherRefinery].map((definition) => [
        definition.id,
        definition,
      ]),
    );
    command(simulation, build());
    expect(
      harvestingRecoveryCost(simulation.economy!, simulation.actors, content),
    ).toBe(150);
    finishBuilding(simulation);
    expect(
      harvestingRecoveryCost(simulation.economy!, simulation.actors, content),
    ).toBe(50);
    command(simulation, {
      kind: "train-unit",
      actorId: "worker",
      producerId: "refinery",
      definitionId: "arc-harvester",
    });
    expect(
      harvestingRecoveryCost(simulation.economy!, simulation.actors, content),
    ).toBe(150);
  });

  test("same-tick placement spends against staged funds and rejects resources", () => {
    const { simulation, occupancy } = fixture();
    simulation.submitCommand(build());
    simulation.submitCommand(build("other", 9, 9));
    expect(simulation.tick().map((outcome) => outcome.accepted)).toEqual([
      true,
      false,
    ]);
    expect(balance(simulation)).toBe(50);
    expect(occupancy.ownerAt(9, 9, "surface")).toBeUndefined();
    const state = simulation.snapshot();
    setBalance(state, 300);
    const restored = fixture(state).simulation;
    expect(
      restored.evaluatePlacement({
        actorId: "on-site",
        definitionId: "arc-materials-refinery",
        origin: { x: 14, z: 6 },
      }),
    ).toMatchObject({ accepted: false, reason: "resource-site" });
    expect(
      restored.evaluatePlacement({
        actorId: "on-loot",
        definitionId: "arc-materials-refinery",
        origin: { x: 22, z: 10 },
      }),
    ).toMatchObject({ accepted: false, reason: "resource-site" });
    expect(restored.unusedActorId("other")).toBe("other1");
  });

  test("one paid Harvester slot stays occupied through production and assignment", () => {
    const { simulation } = fixture();
    command(simulation, build());
    finishBuilding(simulation);
    const state = simulation.snapshot();
    setBalance(state, 100);
    const restored = fixture(state).simulation;
    for (const actorId of ["worker", "extra"])
      restored.submitCommand({
        kind: "train-unit",
        producerId: "refinery",
        actorId,
        definitionId: "arc-harvester",
      });
    expect(restored.tick()).toMatchObject([
      { accepted: true },
      { accepted: false, reason: "refinery-occupied" },
    ]);
    expect(balance(restored)).toBe(50);
    expect(restored.actorById("worker")).toBeUndefined();
    expect(restored.unusedActorId("worker")).toBe("worker1");
    advance(restored, 5);
    expect(restored.actorById("worker")).toBeDefined();
    expect(
      restored.evaluateTraining({
        kind: "train-unit",
        producerId: "refinery",
        actorId: "extra",
        definitionId: "arc-harvester",
      }),
    ).toMatchObject({ accepted: false, reason: "refinery-occupied" });
  });

  test("a full load takes 60 gathering seconds and enters stockpile only on delivery", () => {
    const { simulation } = workerFixture();
    command(simulation, gather());
    until(simulation, () => worker(simulation).phase === "gathering");
    advance(simulation, 58);
    expect(worker(simulation).cargo).toBe(98);
    expect(balance(simulation)).toBe(0);
    simulation.tick();
    expect(worker(simulation).cargo).toBe(100);
    expect(worker(simulation).phase).toBe("returning");
    until(simulation, () => balance(simulation) === 100);
    expect(worker(simulation).cargo).toBe(0);
    expect(deposited(simulation)).toBe(100);
    expect(simulation.buildingActivity).toEqual([
      { buildingId: "refinery", kind: "delivery", actorId: "worker" },
    ]);
    expect(
      command(simulation, {
        kind: "place-actor",
        actorId: "barracks",
        definitionId: "arc-field-barracks",
        origin: { x: 9, z: 10 },
      }).accepted,
    ).toBe(true);
    until(simulation, () => balance(simulation) >= 25);
    expect(
      command(simulation, {
        kind: "train-unit",
        actorId: "trooper",
        producerId: "barracks",
        definitionId: "arc-trooper",
      }).accepted,
    ).toBe(true);
    until(simulation, () => simulation.actorById("trooper") !== undefined);
    expect(simulation.buildingActivity).toEqual([
      { buildingId: "barracks", kind: "exit", actorId: "trooper" },
    ]);
    simulation.tick();
    expect(simulation.buildingActivity).toEqual([]);
  });

  test("depletes nearby tiles, delivers a partial final load, and waits for reassignment", () => {
    const { simulation } = workerFixture();
    command(simulation, gather());
    until(simulation, () => worker(simulation).phase === "depleted");
    expect(balance(simulation)).toBe(190);
    expect(
      simulation.economy!.sites.map((site) => site.remainingMaterials),
    ).toEqual([0, 0, 100]);
    expect(worker(simulation).cargo).toBe(0);
    expect(command(simulation, gather("far")).accepted).toBe(true);
    until(simulation, () => balance(simulation) === 290);
  });

  test("Move and Stop preserve cargo; changing patches deposits before new collection", () => {
    const { simulation, map } = workerFixture();
    command(simulation, gather());
    until(simulation, () => worker(simulation).cargo >= 20);
    const cargo = worker(simulation).cargo;
    command(simulation, { kind: "stop", actorId: "worker" });
    advance(simulation, 5);
    expect(worker(simulation)).toMatchObject({ cargo, phase: "idle" });
    command(simulation, {
      kind: "move",
      actorId: "worker",
      target: map.tileCenter(14, 8),
    });
    advance(simulation, 5);
    expect(worker(simulation).cargo).toBe(cargo);
    command(simulation, gather("far"));
    expect(worker(simulation).phase).toBe("returning");
    until(simulation, () => balance(simulation) === cargo);
    expect(simulation.economy!.sites[2].remainingMaterials).toBe(100);
    expect(worker(simulation).targetSiteId).toBe("far");
  });

  test("lost Refinery preserves cargo and manual movement; reassignment uses an empty slot", () => {
    const { simulation, map } = workerFixture();
    command(simulation, gather());
    until(simulation, () => worker(simulation).cargo >= 20);
    const cargo = worker(simulation).cargo;
    command(simulation, { kind: "remove-actor", actorId: "refinery" });
    expect(worker(simulation)).toMatchObject({ cargo, phase: "unassigned" });
    const position = map.tileCenter(14, 9);
    expect(
      command(simulation, { kind: "move", actorId: "worker", target: position })
        .accepted,
    ).toBe(true);
    advance(simulation, 5);
    expect(simulation.actorById("worker")!.worldPosition).toEqual(position);
    const state = simulation.snapshot();
    setBalance(state, 200);
    const restored = fixture(state).simulation;
    command(restored, build("new-refinery", 6, 6));
    finishBuilding(restored, "new-refinery");
    expect(
      command(restored, {
        kind: "assign-refinery",
        actorId: "worker",
        refineryId: "new-refinery",
      }).accepted,
    ).toBe(true);
    until(restored, () => balance(restored) === 100 + cargo);
    expect(worker(restored).cargo).toBe(0);
  });

  test("scripted removal preserves unrelated unassigned movement", () => {
    const { simulation, map } = workerFixture();
    simulation.removeActor("refinery");
    command(simulation, {
      kind: "move",
      actorId: "worker",
      target: map.tileCenter(20, 10),
    });
    const route = simulation.actorById("worker")!.movement;
    expect(route).toBeDefined();
    simulation.removeActor("cc");
    expect(simulation.actorById("worker")!.movement).toEqual(route);
    const restored = fixture(simulation.snapshot()).simulation;
    until(restored, () => !restored.actorById("worker")!.movement);
    expect(restored.actorById("worker")!.worldPosition).toEqual(
      map.tileCenter(20, 10),
    );
  });

  test("manual Return cargo works after stopping and sale excludes mobile actors", () => {
    const { simulation } = workerFixture();
    command(simulation, gather());
    until(simulation, () => worker(simulation).cargo >= 10);
    const cargo = worker(simulation).cargo;
    command(simulation, { kind: "stop", actorId: "worker" });
    expect(
      command(simulation, { kind: "return-cargo", actorId: "worker" }).accepted,
    ).toBe(true);
    until(simulation, () => balance(simulation) === cargo);
    expect(
      command(simulation, { kind: "sell-actor", actorId: "worker" }).accepted,
    ).toBe(false);
    expect(
      command(simulation, { kind: "sell-actor", actorId: "refinery" }).accepted,
    ).toBe(true);
    expect(balance(simulation)).toBe(cargo + 50);
  });

  test("ordinary salvage is collected once by a mobile unit without a delivery", () => {
    const { simulation, map } = workerFixture();
    command(simulation, {
      kind: "move",
      actorId: "worker",
      target: map.tileCenter(22, 10),
    });
    until(simulation, () => balance(simulation) === 25);
    expect(simulation.economy!.loot[0].collected).toBe(true);
    advance(simulation, 10);
    expect(balance(simulation)).toBe(25);
  });

  test("salvage ignores another owner's mobile actors", () => {
    const { simulation, map } = fixture();
    const worldPosition = map.tileCenter(22, 10);
    simulation.spawnActor(
      createActor({
        id: "visitor",
        definitionId: "arc-scout",
        owner: "wildlife",
        worldPosition,
      }),
    );
    simulation.tick();
    expect(simulation.economy!.loot[0].collected).toBe(false);
    expect(balance(simulation)).toBe(150);
    simulation.removeActor("visitor");
    simulation.spawnActor(
      createActor({
        id: "collector",
        definitionId: "arc-trooper",
        owner: "player",
        worldPosition,
      }),
    );
    simulation.tick();
    expect(simulation.economy!.loot[0].collected).toBe(true);
    expect(balance(simulation)).toBe(175);
  });

  test.each<MissionCommand>([
    gather(),
    { kind: "return-cargo", actorId: "worker" },
    { kind: "assign-refinery", actorId: "worker", refineryId: "refinery" },
  ])("%j replaces a blocked Attack Move before delivering cargo", (order) => {
    const { simulation, map } = workerFixture(0.1);
    command(simulation, gather());
    until(simulation, () => worker(simulation).cargo >= 10, 300);
    command(simulation, { kind: "stop", actorId: "worker" });
    const state = simulation.snapshot();
    const target = map.tileCenter(22, 2);
    state.actors.find(({ id }) => id === "worker")!.attackMove = {
      target,
      blocked: { at: target, navigationVersion: 0 },
    };
    const restored = fixture(state, 0.1).simulation;
    const cargo = worker(restored).cargo;
    expect(command(restored, order).accepted).toBe(true);
    expect(restored.actorById("worker")!.attackMove).toBeUndefined();
    expect(restored.actorById("worker")!.movement?.target).not.toEqual(target);
    until(restored, () => deposited(restored) === cargo);
    const position = restored.actorById("worker")!.worldPosition;
    expect(position.x).toBeLessThan(map.tileCenter(10, 6).x);
  });

  test("five paid unit orders train in sequence; cancellation fully refunds and retires reserved identity", () => {
    const state = exploredScenarioState(scenario, definitions);
    setBalance(state, 250);
    const { simulation } = fixture(state);
    command(simulation, {
      kind: "place-actor",
      actorId: "barracks",
      definitionId: "arc-field-barracks",
      origin: { x: 6, z: 6 },
    });
    finishBuilding(simulation, "barracks");
    for (let i = 1; i <= 6; i++)
      simulation.submitCommand({
        kind: "train-unit",
        actorId: `unit-${i}`,
        producerId: "barracks",
        definitionId: "arc-trooper",
      });
    expect(simulation.tick().map((outcome) => outcome.accepted)).toEqual([
      true,
      true,
      true,
      true,
      true,
      false,
    ]);
    expect(balance(simulation)).toBe(25);
    expect(
      command(simulation, { kind: "cancel-production", actorId: "unit-1" })
        .accepted,
    ).toBe(true);
    expect(balance(simulation)).toBe(50);
    expect(simulation.snapshot().retiredActorIds).toContain("unit-1");
    expect(simulation.actorById("unit-2")).toBeUndefined();
    advance(simulation, 3);
    expect(simulation.actorById("unit-2")).toBeDefined();
    expect(simulation.actorById("unit-3")).toBeUndefined();
    expect(
      command(simulation, { kind: "cancel-production", actorId: "unit-2" })
        .accepted,
    ).toBe(false);
  });

  test("completed training waits for a free exit and cancellation refunds that waiting order", () => {
    const state = exploredScenarioState(scenario, definitions);
    setBalance(state, 1000);
    const { simulation } = fixture(state);
    command(simulation, build());
    finishBuilding(simulation);
    // A terrain edit blocks every adjacent tile after the paid request.
    command(simulation, {
      kind: "train-unit",
      producerId: "refinery",
      actorId: "worker",
      definitionId: "arc-harvester",
    });
    const exits = [
      { x: 5, z: 6 },
      { x: 5, z: 7 },
      { x: 6, z: 5 },
      { x: 7, z: 5 },
      { x: 8, z: 5 },
      { x: 9, z: 6 },
      { x: 9, z: 7 },
      { x: 6, z: 8 },
      { x: 7, z: 8 },
      { x: 8, z: 8 },
    ];
    command(
      simulation,
      {
        kind: "terrain",
        tiles: exits.map((tile) => ({
          ...tile,
          terrain: { typeId: "plain", surfacePassable: false },
        })),
      },
      { script: true },
    );
    advance(simulation, 5);
    expect(simulation.actorById("worker")).toBeUndefined();
    expect(simulation.economy!.production[0].exitBlocked).toBe(true);
    const saved = simulation.snapshot();
    const cancelled = fixture(saved).simulation;
    command(cancelled, { kind: "cancel-production", actorId: "worker" });
    expect(balance(cancelled)).toBe(900);
    command(
      simulation,
      {
        kind: "terrain",
        tiles: [{ x: 7, z: 8, terrain: { typeId: "plain" } }],
      },
      { script: true },
    );
    expect(simulation.actorById("worker")).toBeDefined();
  });

  test("a blocked patch reports stalled harvesting and resumes when navigation changes", () => {
    const { simulation } = workerFixture();
    command(
      simulation,
      {
        kind: "terrain",
        tiles: [
          { x: 22, z: 6, terrain: { typeId: "plain", surfacePassable: false } },
        ],
      },
      { script: true },
    );
    command(simulation, gather("far"));
    expect(worker(simulation).phase).toBe("blocked");
    advance(simulation, 5);
    expect(worker(simulation).cargo).toBe(0);
    command(
      simulation,
      {
        kind: "terrain",
        tiles: [{ x: 22, z: 6, terrain: { typeId: "plain" } }],
      },
      { script: true },
    );
    until(simulation, () => worker(simulation).cargo > 0);
  });

  test("a route blocked while travelling reports stalled harvesting", () => {
    const { simulation, map } = workerFixture();
    command(simulation, gather("far"));
    advance(simulation, 2);
    expect(worker(simulation).phase).toBe("travelling");
    const { worldPosition } = simulation.actorById("worker")!;
    const center = map.tileAtWorldPosition(worldPosition.x, worldPosition.z);
    const ring = [-1, 0, 1].flatMap((dx) =>
      [-1, 0, 1]
        .filter((dz) => dx || dz)
        .map((dz) => ({ x: center.x + dx, z: center.z + dz })),
    );
    command(
      simulation,
      {
        kind: "terrain",
        tiles: ring.map((tile) => ({
          ...tile,
          terrain: { typeId: "plain", surfacePassable: false },
        })),
      },
      { script: true },
    );
    until(simulation, () => worker(simulation).phase === "blocked", 5);
    command(
      simulation,
      {
        kind: "terrain",
        tiles: ring.map((tile) => ({ ...tile, terrain: { typeId: "plain" } })),
      },
      { script: true },
    );
    until(simulation, () => worker(simulation).cargo > 0);
  });

  test("invalid economy and references fail restoration before changing live occupancy", () => {
    const { simulation, map, occupancy } = workerFixture();
    const saved = simulation.snapshot();
    saved.economy!.harvesters[0].cargo = 101;
    expect(() => fixture(saved)).toThrow("invalid economy");
    expect(occupancy.ownerAt(6, 6, "surface")).toBe("refinery");
    expect(map.navigationChanges.version).toBe(
      simulation.snapshot().terrain!.navigationVersion,
    );
    const bad = simulation.snapshot();
    bad.economy!.harvesters[0].refineryId = "missing";
    expect(() => fixture(bad)).toThrow("invalid economy");
  });

  test("a late economy fault rolls back a completed unit and its paid queue", () => {
    const { simulation } = workerFixture();
    const saved = simulation.snapshot();
    setBalance(saved, 125);
    const setup = fixture(saved).simulation;
    command(setup, {
      kind: "place-actor",
      actorId: "barracks",
      definitionId: "arc-field-barracks",
      origin: { x: 9, z: 10 },
    });
    finishBuilding(setup, "barracks");
    command(setup, {
      kind: "train-unit",
      actorId: "trooper",
      producerId: "barracks",
      definitionId: "arc-trooper",
    });
    advance(setup, 2);
    const { simulation: failing, occupancy } = fixture(
      setup.snapshot(),
      1,
      "move",
    );
    failing.submitCommand(gather());
    const before = failing.snapshot();
    expect(before.economy!.production[0].completedTicks).toBe(3);
    expect(() => failing.tick()).toThrow("test move fault");
    expect(failing.snapshot()).toEqual(before);
    expect(failing.actorById("trooper")).toBeUndefined();
    expect(occupancy.ownerAt(9, 10, "surface")).toBe("barracks");
  });

  test("a fault rolls back spending, production, resource state, and footprint edits together", () => {
    const { simulation, occupancy } = fixture(undefined, 1, true);
    simulation.submitCommand(build());
    const before = simulation.snapshot();
    expect(() => simulation.tick()).toThrow("test fault");
    expect(simulation.snapshot()).toEqual(before);
    expect(occupancy.ownerAt(6, 6, "surface")).toBeUndefined();
    expect(() => simulation.tick()).toThrow("faulted");
  });
});

describe("economy persistence", () => {
  test.each(["training", "travelling", "gathering", "returning"])(
    "resumes %s exactly through JSON and preserves pending commands",
    (phase) => {
      let simulation: MissionSimulation;
      if (phase === "training") {
        simulation = fixture(undefined, 0.1).simulation;
        command(simulation, build());
        finishBuilding(simulation);
        command(simulation, {
          kind: "train-unit",
          actorId: "worker",
          producerId: "refinery",
          definitionId: "arc-harvester",
        });
      } else {
        simulation = workerFixture(0.1).simulation;
        command(simulation, gather());
        if (phase !== "travelling")
          until(simulation, () => worker(simulation).phase === phase, 1000);
      }
      simulation.submitCommand({
        kind: "move",
        actorId: "cc",
        target: { x: 0, z: 0 },
      });
      const saved = parseMission(
        serializeMission(scenario, simulation.snapshot(), 0.1),
        0.1,
      ).state;
      const restored = fixture(saved, 0.1).simulation;
      expect(restored.snapshot()).toEqual(simulation.snapshot());
      for (let tick = 0; tick < 1000; tick++) {
        expect(restored.tick()).toEqual(simulation.tick());
      }
      expect(restored.snapshot()).toEqual(simulation.snapshot());
    },
  );

  test("JSON preserves active and queued construction and resumes the same ticks", () => {
    const state = exploredScenarioState(scenario, definitions);
    setBalance(state, 300);
    const { simulation } = fixture(state, 0.1);
    command(simulation, build());
    command(simulation, build("next", 9, 9));
    advance(simulation, 15);
    simulation.submitCommand({
      kind: "cancel-construction",
      actorId: "refinery",
    });
    const saved = parseMission(
      serializeMission(scenario, simulation.snapshot(), 0.1),
      0.1,
    ).state;
    const restored = fixture(saved, 0.1).simulation;
    for (let tick = 0; tick < 100; tick++)
      expect(restored.tick()).toEqual(simulation.tick());
    expect(restored.snapshot()).toEqual(simulation.snapshot());
    expect(restored.actorById("next")!.construction).toBeUndefined();
    expect(balance(restored)).toBe(200);
  });

  test("saves carry their own resource content", () => {
    const { simulation } = fixture();
    const save = JSON.parse(
      serializeMission(scenario, simulation.snapshot(), 1),
    );
    save.state.economy.sites[0].name = "Different patch";
    save.state.economy.sites[0].remainingMaterials = 50;
    const restored = fixture(parseMission(JSON.stringify(save), 1).state);
    expect(restored.simulation.economy!.sites[0]).toMatchObject({
      name: "Different patch",
      remainingMaterials: 50,
    });
  });
});

test("paid production uses the current rally point when it completes", () => {
  const { simulation, map } = fixture();
  command(simulation, build());
  finishBuilding(simulation);
  command(simulation, {
    kind: "train-unit",
    actorId: "worker",
    producerId: "refinery",
    definitionId: "arc-harvester",
  });
  const target = map.tileCenter(10, 12);
  command(simulation, { kind: "set-rally-point", actorId: "refinery", target });
  const restored = fixture(
    JSON.parse(JSON.stringify(simulation.snapshot())),
  ).simulation;
  until(restored, () => !!restored.actorById("worker"));
  expect(restored.actorById("worker")!.movement?.target).toEqual(target);
  expect(worker(restored)).toMatchObject({
    refineryId: "refinery",
    phase: "idle",
  });
  until(restored, () => !restored.actorById("worker")!.movement);
  expect(restored.actorById("worker")!.worldPosition).toEqual(target);
});

test("gifts must name one positive resource available in their mission", () => {
  for (const reward of [
    { materials: 25, lifebloom: 25 },
    { lifebloom: 25 },
    { materials: 0 },
  ]) {
    const state = exploredScenarioState(scenario, definitions);
    state.economy!.loot = [
      {
        id: "bad-gift",
        name: "Gift",
        tile: { x: 20, z: 10 },
        collected: false,
        ...reward,
      },
    ] as NonNullable<typeof state.economy>["loot"];
    expect(() => fixture(state)).toThrow("invalid economy state");
  }
});

describe("owner economies", () => {
  const rivalScenario = defineScenario({
    id: "owner-economy-test",
    tileSize: scenario.tileSize,
    terrainTypeIds: scenario.terrainTypeIds,
    terrain: scenario.terrain,
    playerOwner: "player",
    sites: scenario.sites!,
    loot: [],
    owners: [
      { id: "player", faction: "arc" },
      { id: "rival", faction: "arc" },
    ],
    relationships: [],
    buildings: [
      ...scenario.buildings,
      {
        actorId: "rival-cc",
        definitionId: "arc-command-center-prototype",
        origin: { x: 2, z: 13 },
        owner: "rival",
      },
      {
        actorId: "rival-refinery",
        definitionId: "arc-materials-refinery",
        origin: { x: 6, z: 13 },
        owner: "rival",
      },
    ],
    stockpiles: [...stockpiles(150), ...stockpiles(200, "materials", "rival")],
  });
  // Without fog every owner knows the sites.
  const rivalState = (): MissionState => {
    const { fog: _, ...state } = createScenarioState(
      rivalScenario,
      definitions,
    );
    return state;
  };
  const balances = (simulation: MissionSimulation) => [
    balance(simulation),
    balance(simulation, "materials", "rival"),
  ];
  const train = (actorId: string): MissionCommand => ({
    kind: "train-unit",
    producerId: "rival-refinery",
    actorId,
    definitionId: "arc-harvester",
  });

  test("spending, refunds, and deliveries stay with each owner", () => {
    const { simulation } = fixture(rivalState());
    const rival = { owner: "rival" };
    expect(command(simulation, train("rival-worker"), rival).accepted).toBe(
      true,
    );
    expect(balances(simulation)).toEqual([150, 150]);
    command(
      simulation,
      { kind: "cancel-production", actorId: "rival-worker" },
      rival,
    );
    expect(balances(simulation)).toEqual([150, 200]);
    expect(command(simulation, build()).accepted).toBe(true);
    expect(balances(simulation)).toEqual([50, 200]);
    command(simulation, { kind: "cancel-construction", actorId: "refinery" });
    expect(balances(simulation)).toEqual([150, 200]);

    expect(command(simulation, train("rival-worker-2"), rival).accepted).toBe(
      true,
    );
    until(simulation, () => !!simulation.actorById("rival-worker-2"), 10);
    command(
      simulation,
      { kind: "gather", actorId: "rival-worker-2", siteId: "site" },
      rival,
    );
    until(simulation, () => deposited(simulation, "materials", "rival") > 0);
    const income = deposited(simulation, "materials", "rival");
    expect(balances(simulation)).toEqual([150, 150 + income]);
    expect(deposited(simulation)).toBe(0);

    const sale = balance(simulation, "materials", "rival");
    command(simulation, { kind: "sell-actor", actorId: "rival-cc" }, rival);
    expect(balance(simulation)).toBe(150);
    expect(balance(simulation, "materials", "rival")).toBe(sale + 150);

    const restored = fixture(
      JSON.parse(JSON.stringify(simulation.snapshot())),
    ).simulation;
    expect(restored.economy!.stockpiles).toEqual(
      simulation.economy!.stockpiles,
    );
    expect(restored.economy!.deposited).toEqual(simulation.economy!.deposited);
  });

  test("stalls are judged from the owner's workers and balance", () => {
    const state = rivalState();
    setBalance(state, 0, "materials", "rival");
    state.actors.push(
      createActor({
        id: "player-worker",
        definitionId: "arc-harvester",
        owner: "player",
        worldPosition: contentMap.tileCenter(5, 5),
      }),
    );
    state.economy!.harvesters.push({
      actorId: "player-worker",
      cargo: 0,
      gatherProgress: 0,
      phase: "unassigned",
    });
    const { simulation } = fixture(state);
    const stalled = (owner: string) =>
      harvestingStalled(
        simulation.economy!,
        owner,
        simulation.actors,
        new Map(definitions.map((definition) => [definition.id, definition])),
      );
    expect(stalled("rival")).toBe(true);
    expect(stalled("player")).toBe(false);
  });

  test.each([
    (state: MissionState) => {
      state.economy!.stockpiles[0].amount = 0.5;
    },
    (state: MissionState) => {
      state.economy!.stockpiles[0].owners = [];
    },
    (state: MissionState) => {
      state.economy!.stockpiles[0].owners = ["stranger"];
    },
    (state: MissionState) => {
      state.economy!.stockpiles[1].owners.push("player");
    },
    (state: MissionState) => {
      Object.assign(state.economy!.stockpiles[0], { resource: "gold" });
    },
    (state: MissionState) => {
      state.economy!.deposited.push({
        owner: "stranger",
        resource: "materials",
        amount: 1,
      });
    },
    (state: MissionState) => {
      state.economy!.deposited.push(
        { owner: "player", resource: "materials", amount: 1 },
        { owner: "player", resource: "materials", amount: 1 },
      );
    },
  ])("malformed stockpiles are rejected (%#)", (change) => {
    const state = rivalState();
    change(state);
    expect(() => fixture(state)).toThrow("invalid economy state");
  });
});
