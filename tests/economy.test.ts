import { describe, expect, test } from "vitest";
import { ARC_ACTOR_DEFINITIONS } from "../src/content/arc";
import { ECONOMY_SCENARIO } from "../src/content/economy-scenario";
import { createMissionSimulation } from "../src/simulation/mission";
import {
  createScenarioState,
  defineScenario,
  serializeMission,
  deserializeMission,
} from "../src/simulation/scenario";
import { TerrainGrid } from "../src/simulation/terrain";
import { OccupancyGrid } from "../src/simulation/occupancy";
import { createTerrainMoveBehavior } from "../src/simulation/terrain-movement";
import type {
  MissionState,
  MissionSimulation,
} from "../src/simulation/mission";
import type { MissionCommand } from "../src/simulation/command";

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
  materials: 150,
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
function fixture(state?: MissionState, tickSeconds = 1, fault = false) {
  const map = new TerrainGrid(mapOptions);
  const occupancy = new OccupancyGrid(map);
  const simulation = createMissionSimulation({
    state: state ?? createScenarioState(scenario, definitions),
    definitions,
    map,
    occupancy,
    tickSeconds,
    bounds: map.worldBounds,
    behaviorRegistry: new Map([
      [
        "terrain-move",
        createTerrainMoveBehavior(map, occupancy, [
          {
            id: "surface-ground",
            maxSlope: 0.75,
            slopeCostAtLimit: 2,
            terrainCosts: { plain: 1, path: 0.8, rough: 2.25, water: null },
          },
        ]),
      ],
      [
        "idle",
        {
          handleCommand: () => false,
          update: () => {
            if (fault) throw new Error("test fault");
          },
        },
      ],
    ]),
  });
  return { simulation, map, occupancy };
}
function command(simulation: MissionSimulation, command: MissionCommand) {
  simulation.submitCommand(command);
  return simulation.tick()[0];
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

describe("Materials economy", () => {
  test("starts with a fixed Command Center and exactly enough for the first economic pair", () => {
    const state = createScenarioState(ECONOMY_SCENARIO, definitions);
    expect(state.actors.map((actor) => actor.definitionId)).toEqual([
      "arc-command-center-prototype",
    ]);
    expect(state.economy!.materials).toBe(150);
    expect(Object.isFrozen(ECONOMY_SCENARIO.terrain.tiles)).toBe(true);
    const independent = createScenarioState(ECONOMY_SCENARIO, definitions);
    state.economy!.sites[0].remainingMaterials = 0;
    expect(independent.economy!.sites[0].remainingMaterials).toBe(200);
  });

  test("paid blueprints reserve footprints and one construction slot before becoming operational", () => {
    const state = createScenarioState(scenario, definitions);
    state.economy!.materials = 300;
    const { simulation, occupancy } = fixture(state);
    simulation.submitCommand(build());
    simulation.submitCommand({
      kind: "place-actor",
      actorId: "barracks",
      definitionId: "arc-field-barracks",
      origin: { x: 9, z: 10 },
    });
    expect(simulation.tick().every((outcome) => outcome.accepted)).toBe(true);
    expect(simulation.economy!.materials).toBe(100);
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
    expect(simulation.economy!.materials).toBe(100);
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
    const state = createScenarioState(scenario, definitions);
    state.economy!.materials = 300;
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
    expect(simulation.economy!.materials).toBe(200);
    expect(simulation.actorById("refinery")).toBeUndefined();
    expect(occupancy.ownerAt(6, 6, "surface")).toBeUndefined();
    expect(simulation.actorById("next")!.construction!.completedTicks).toBe(1);
    expect(simulation.unusedActorId("refinery")).toBe("refinery1");
    expect(
      command(simulation, { kind: "cancel-construction", actorId: "refinery" })
        .accepted,
    ).toBe(false);
    expect(simulation.economy!.materials).toBe(200);
    simulation.removeActor("next");
    expect(simulation.economy!.materials).toBe(200);
  });

  test("unfinished Refineries reject assignments without interrupting a worker", () => {
    const { simulation } = workerFixture();
    const state = simulation.snapshot();
    state.economy!.materials = 100;
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
      { paidMaterials: 99 },
    ]) {
      const saved = simulation.snapshot();
      Object.assign(
        saved.actors.find((actor) => actor.id === "refinery")!.construction!,
        patch,
      );
      expect(() => fixture(saved)).toThrow("invalid construction");
    }
  });

  test("same-tick placement spends against staged funds and rejects resources", () => {
    const { simulation, occupancy } = fixture();
    simulation.submitCommand(build());
    simulation.submitCommand(build("other", 9, 9));
    expect(simulation.tick().map((outcome) => outcome.accepted)).toEqual([
      true,
      false,
    ]);
    expect(simulation.economy!.materials).toBe(50);
    expect(occupancy.ownerAt(9, 9, "surface")).toBeUndefined();
    const state = simulation.snapshot();
    state.economy!.materials = 300;
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
    state.economy!.materials = 100;
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
    expect(restored.economy!.materials).toBe(50);
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
    expect(simulation.economy!.materials).toBe(0);
    simulation.tick();
    expect(worker(simulation).cargo).toBe(100);
    expect(worker(simulation).phase).toBe("returning");
    until(simulation, () => simulation.economy!.materials === 100);
    expect(worker(simulation).cargo).toBe(0);
    expect(simulation.economy!.depositedMaterials).toBe(100);
    expect(
      command(simulation, {
        kind: "place-actor",
        actorId: "barracks",
        definitionId: "arc-field-barracks",
        origin: { x: 9, z: 10 },
      }).accepted,
    ).toBe(true);
    until(simulation, () => simulation.economy!.materials >= 25);
    expect(
      command(simulation, {
        kind: "train-unit",
        actorId: "trooper",
        producerId: "barracks",
        definitionId: "arc-trooper",
      }).accepted,
    ).toBe(true);
    advance(simulation, 3);
    expect(simulation.actorById("trooper")).toBeDefined();
  });

  test("depletes nearby tiles, delivers a partial final load, and waits for reassignment", () => {
    const { simulation } = workerFixture();
    command(simulation, gather());
    until(simulation, () => worker(simulation).phase === "depleted");
    expect(simulation.economy!.materials).toBe(190);
    expect(
      simulation.economy!.sites.map((site) => site.remainingMaterials),
    ).toEqual([0, 0, 100]);
    expect(worker(simulation).cargo).toBe(0);
    expect(command(simulation, gather("far")).accepted).toBe(true);
    until(simulation, () => simulation.economy!.materials === 290);
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
    until(simulation, () => simulation.economy!.materials === cargo);
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
    state.economy!.materials = 200;
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
    until(restored, () => restored.economy!.materials === 100 + cargo);
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
    until(simulation, () => simulation.economy!.materials === cargo);
    expect(
      command(simulation, { kind: "sell-actor", actorId: "worker" }).accepted,
    ).toBe(false);
    expect(
      command(simulation, { kind: "sell-actor", actorId: "refinery" }).accepted,
    ).toBe(true);
    expect(simulation.economy!.materials).toBe(cargo + 50);
  });

  test("ordinary salvage is collected once by a mobile unit without a delivery", () => {
    const { simulation, map } = workerFixture();
    command(simulation, {
      kind: "move",
      actorId: "worker",
      target: map.tileCenter(22, 10),
    });
    until(simulation, () => simulation.economy!.materials === 25);
    expect(simulation.economy!.loot[0].collected).toBe(true);
    advance(simulation, 10);
    expect(simulation.economy!.materials).toBe(25);
  });

  test("five paid unit orders train in sequence; cancellation fully refunds and retires reserved identity", () => {
    const state = createScenarioState(scenario, definitions);
    state.economy!.materials = 250;
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
    expect(simulation.economy!.materials).toBe(25);
    expect(
      command(simulation, { kind: "cancel-production", actorId: "unit-1" })
        .accepted,
    ).toBe(true);
    expect(simulation.economy!.materials).toBe(50);
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
    const state = createScenarioState(scenario, definitions);
    state.economy!.materials = 1000;
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
    command(simulation, {
      kind: "terrain",
      tiles: exits.map((tile) => ({
        ...tile,
        terrain: { typeId: "plain", surfacePassable: false },
      })),
    });
    advance(simulation, 5);
    expect(simulation.actorById("worker")).toBeUndefined();
    expect(simulation.economy!.production[0].exitBlocked).toBe(true);
    const saved = simulation.snapshot();
    const cancelled = fixture(saved).simulation;
    command(cancelled, { kind: "cancel-production", actorId: "worker" });
    expect(cancelled.economy!.materials).toBe(900);
    command(simulation, {
      kind: "terrain",
      tiles: [{ x: 7, z: 8, terrain: { typeId: "plain" } }],
    });
    expect(simulation.actorById("worker")).toBeDefined();
  });

  test("a blocked patch reports stalled harvesting and resumes when navigation changes", () => {
    const { simulation } = workerFixture();
    command(simulation, {
      kind: "terrain",
      tiles: [
        { x: 22, z: 6, terrain: { typeId: "plain", surfacePassable: false } },
      ],
    });
    command(simulation, gather("far"));
    expect(worker(simulation).phase).toBe("blocked");
    advance(simulation, 5);
    expect(worker(simulation).cargo).toBe(0);
    command(simulation, {
      kind: "terrain",
      tiles: [{ x: 22, z: 6, terrain: { typeId: "plain" } }],
    });
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
      const saved = deserializeMission(
        serializeMission(simulation.snapshot(), 0.1),
        scenario,
        0.1,
      );
      const restored = fixture(saved, 0.1).simulation;
      expect(restored.snapshot()).toEqual(simulation.snapshot());
      for (let tick = 0; tick < 1000; tick++) {
        expect(restored.tick()).toEqual(simulation.tick());
      }
      expect(restored.snapshot()).toEqual(simulation.snapshot());
    },
  );

  test("JSON preserves active and queued construction and resumes the same ticks", () => {
    const state = createScenarioState(scenario, definitions);
    state.economy!.materials = 300;
    const { simulation } = fixture(state, 0.1);
    command(simulation, build());
    command(simulation, build("next", 9, 9));
    advance(simulation, 15);
    simulation.submitCommand({
      kind: "cancel-construction",
      actorId: "refinery",
    });
    const saved = deserializeMission(
      serializeMission(simulation.snapshot(), 0.1),
      scenario,
      0.1,
    );
    const restored = fixture(saved, 0.1).simulation;
    for (let tick = 0; tick < 100; tick++)
      expect(restored.tick()).toEqual(simulation.tick());
    expect(restored.snapshot()).toEqual(simulation.snapshot());
    expect(restored.actorById("next")!.construction).toBeUndefined();
    expect(restored.economy!.materials).toBe(200);
  });

  test("rejects incompatible versions, scenario content, and tick rates", () => {
    const { simulation } = fixture();
    const source = serializeMission(simulation.snapshot(), 1);
    expect(() =>
      deserializeMission(
        source.replace('"version":1', '"version":2'),
        scenario,
        1,
      ),
    ).toThrow("unsupported version");
    expect(() => deserializeMission(source, ECONOMY_SCENARIO, 1)).toThrow(
      "different scenario",
    );
    expect(() => deserializeMission(source, scenario, 0.1)).toThrow(
      "simulation settings",
    );
    const save = JSON.parse(source);
    save.state.economy.sites[0].initialMaterials = 999;
    expect(() => deserializeMission(JSON.stringify(save), scenario, 1)).toThrow(
      "resource content",
    );
  });
});
