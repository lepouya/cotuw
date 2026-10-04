import { describe, expect, test } from "vitest";
import { ARC_ACTOR_DEFINITIONS } from "./helpers/content";
import {
  createSupportNetwork,
  createSupportResolver,
  supportsPosition,
} from "../src/simulation/support";
import { createMissionSimulation } from "../src/simulation/mission";
import type {
  MissionState,
  MissionSimulation,
} from "../src/simulation/mission";
import { defineScenario } from "../src/simulation/scenario";
import { parseMission, serializeMission } from "../src/simulation/mission-file";
import { TerrainGrid } from "../src/simulation/terrain";
import { OccupancyGrid } from "../src/simulation/occupancy";
import { createTerrainMoveBehavior } from "../src/simulation/terrain-movement";
import { createTilePlacedActor } from "../src/simulation/placement";
import type { Actor } from "../src/simulation/actor";
import type { MissionCommand } from "../src/simulation/command";
import { exploredScenarioState } from "./helpers/scenario";

const definitions = new Map(
  ARC_ACTOR_DEFINITIONS.map((definition) => [definition.id, definition]),
);
const mapOptions = {
  width: 64,
  height: 24,
  tileSize: 1,
  terrainTypeIds: ["plain", "path", "rough", "water"],
};
const contentMap = new TerrainGrid(mapOptions);
const scenario = defineScenario({
  id: "support-test",
  playerFaction: "arc",
  tileSize: 1,
  terrainTypeIds: mapOptions.terrainTypeIds,
  terrain: contentMap.terrainState(),
  materials: 2000,
  sites: [],
  loot: [],
  buildings: [
    {
      actorId: "cc",
      definitionId: "arc-command-center-prototype",
      origin: { x: 2, z: 10 },
    },
    {
      actorId: "bridge",
      definitionId: "arc-field-barracks",
      origin: { x: 13, z: 10 },
    },
    {
      actorId: "remote",
      definitionId: "arc-materials-refinery",
      origin: { x: 18, z: 10 },
    },
  ],
});
function fixture(
  state = exploredScenarioState(scenario, ARC_ACTOR_DEFINITIONS),
) {
  const map = new TerrainGrid(mapOptions);
  const occupancy = new OccupancyGrid(map);
  const simulation = createMissionSimulation({
    state,
    map,
    occupancy,
    definitions: ARC_ACTOR_DEFINITIONS,
    tickSeconds: 1,
    bounds: map.worldBounds,
    behaviorRegistry: new Map([
      ["idle", { handleCommand: () => false, update: () => {} }],
      [
        "terrain-move",
        createTerrainMoveBehavior(map, occupancy, [
          {
            id: "surface-ground",
            maxSlope: 0.75,
            slopeCostAtLimit: 2,
            terrainCosts: { plain: 1, path: 1, rough: 2, water: null },
          },
        ]),
      ],
    ]),
  });
  return { simulation, map };
}
function command(simulation: MissionSimulation, value: MissionCommand) {
  simulation.submitCommand(value);
  return simulation.tick()[0];
}
function ticks(simulation: MissionSimulation, count: number) {
  for (let i = 0; i < count; i++) simulation.tick();
}
function building(id: string, x: number, z: number): Actor {
  return createTilePlacedActor(
    contentMap,
    definitions.get("arc-field-barracks")!,
    { actorId: id, origin: { x, z } },
  );
}
function blueprint(id: string, x: number, z: number): Actor {
  return {
    ...building(id, x, z),
    construction: { paidMaterials: 100, completedTicks: 2, totalTicks: 8 },
  };
}

describe("construction support", () => {
  test("a legally built branch depends on its bridge and can gain a redundant path", () => {
    const state = exploredScenarioState(scenario, ARC_ACTOR_DEFINITIONS);
    state.actors = state.actors.filter((actor) => actor.id === "cc");
    const { simulation } = fixture(state);
    const place = (id: string, x: number, z: number) => {
      expect(
        command(simulation, {
          kind: "place-actor",
          actorId: id,
          definitionId: "arc-field-barracks",
          origin: { x, z },
        }).accepted,
      ).toBe(true);
      ticks(simulation, 8);
      expect(simulation.actorById(id)!.construction).toBeUndefined();
    };
    place("built-bridge", 13, 10);
    place("built-remote", 18, 10);
    command(simulation, { kind: "sell-actor", actorId: "built-bridge" });
    expect(
      simulation.support!.nodes.find((node) => node.actorId === "built-remote")!
        .connected,
    ).toBe(false);
    place("replacement", 13, 10);
    place("backup", 13, 12);
    command(simulation, { kind: "sell-actor", actorId: "replacement" });
    expect(simulation.support!.nodes.every((node) => node.connected)).toBe(
      true,
    );
  });

  test("support views survive unrelated changes and invalidate staged topology", () => {
    const { simulation } = fixture();
    const initial = simulation.support;
    expect(simulation.support).toBe(initial);
    simulation.tick();
    expect(simulation.support).toBe(initial);
    command(simulation, {
      kind: "set-rally-point",
      actorId: "bridge",
      target: contentMap.tileCenter(15, 14),
    });
    expect(simulation.support).toBe(initial);
    command(simulation, {
      kind: "place-actor",
      actorId: "site",
      definitionId: "arc-field-barracks",
      origin: { x: 23, z: 10 },
    });
    const blueprint = simulation.support;
    ticks(simulation, 2);
    expect(simulation.support).toBe(blueprint);
    ticks(simulation, 6);
    expect(simulation.support).not.toBe(blueprint);
    expect(
      simulation.support!.nodes.find((node) => node.actorId === "site")!
        .complete,
    ).toBe(true);

    const resolve = createSupportResolver(definitions);
    const actors = exploredScenarioState(
      scenario,
      ARC_ACTOR_DEFINITIONS,
    ).actors;
    const before = resolve(actors);
    actors.splice(
      actors.findIndex((actor) => actor.id === "bridge"),
      1,
    );
    expect(resolve(actors)).not.toBe(before);
    expect(
      resolve(actors).nodes.find((node) => node.actorId === "remote")!
        .connected,
    ).toBe(false);
  });

  test("overlap alone does not connect completed centers", () => {
    const actors = exploredScenarioState(
      scenario,
      ARC_ACTOR_DEFINITIONS,
    ).actors;
    actors[1] = building("bridge", 18, 10);
    actors.pop();
    const network = createSupportNetwork(actors, definitions);
    expect(network.links).toEqual([]);
    expect(
      network.nodes.find((node) => node.actorId === "bridge")!.connected,
    ).toBe(false);
  });

  test("covered completed centers connect to roots with stable redundant edges", () => {
    const state = exploredScenarioState(scenario, ARC_ACTOR_DEFINITIONS);
    const network = createSupportNetwork(state.actors, definitions);
    expect(network.nodes.every((node) => node.connected)).toBe(true);
    expect(supportsPosition(network, contentMap.tileCenter(23, 10))).toBe(true);
    expect(supportsPosition(network, contentMap.tileCenter(50, 10))).toBe(
      false,
    );
    expect(
      createSupportNetwork([...state.actors].reverse(), definitions),
    ).toEqual(network);
    state.actors.push(building("backup", 13, 12));
    const redundant = createSupportNetwork(
      state.actors.filter((actor) => actor.id !== "bridge"),
      definitions,
    );
    expect(redundant.nodes.every((node) => node.connected)).toBe(true);
    expect(redundant.links.every((link) => link.active)).toBe(true);
  });

  test("blueprints never relay and rootless clusters stay disconnected", () => {
    const state = exploredScenarioState(scenario, ARC_ACTOR_DEFINITIONS);
    state.actors[1] = blueprint("bridge", 13, 10);
    const network = createSupportNetwork(state.actors, definitions);
    expect(
      network.nodes.find((node) => node.actorId === "remote")!.connected,
    ).toBe(false);
    expect(supportsPosition(network, contentMap.tileCenter(18, 10))).toBe(
      false,
    );
    expect(
      createSupportNetwork(
        state.actors.filter((actor) => actor.id !== "cc"),
        definitions,
      ).nodes.every((node) => !node.connected),
    ).toBe(true);
  });

  test("placement requires live coverage and rejected orders spend nothing", () => {
    const { simulation } = fixture();
    const before = simulation.economy!.materials;
    expect(
      command(simulation, {
        kind: "place-actor",
        actorId: "far",
        definitionId: "arc-field-barracks",
        origin: { x: 50, z: 10 },
      }),
    ).toMatchObject({ accepted: false, reason: "outside-support" });
    expect(simulation.economy!.materials).toBe(before);
    simulation.submitCommand({ kind: "sell-actor", actorId: "bridge" });
    simulation.submitCommand({
      kind: "place-actor",
      actorId: "new",
      definitionId: "arc-field-barracks",
      origin: { x: 34, z: 12 },
    });
    expect(simulation.tick().map((outcome) => outcome.accepted)).toEqual([
      true,
      false,
    ]);
    expect(
      simulation.support!.nodes.find((node) => node.actorId === "remote")!
        .connected,
    ).toBe(false);
  });

  test("disconnected production preserves paid queues, cargo, and save continuation", () => {
    const { simulation, map } = fixture();
    command(simulation, {
      kind: "set-rally-point",
      actorId: "remote",
      target: map.tileCenter(34, 12),
    });
    command(simulation, {
      kind: "train-unit",
      actorId: "worker",
      producerId: "remote",
      definitionId: "arc-harvester",
    });
    command(simulation, { kind: "sell-actor", actorId: "bridge" });
    const job = structuredClone(simulation.economy!.production[0]);
    ticks(simulation, 20);
    expect(simulation.economy!.production[0]).toEqual(job);
    expect(
      simulation.evaluateTraining({
        kind: "train-unit",
        actorId: "other",
        producerId: "remote",
        definitionId: "arc-harvester",
      }),
    ).toMatchObject({ accepted: false, reason: "disconnected" });
    const restored = fixture(
      parseMission(serializeMission(scenario, simulation.snapshot(), 1), 1)
        .state,
    ).simulation;
    for (const current of [simulation, restored]) {
      current.spawnActor(building("restored-bridge", 13, 10));
      ticks(current, 6);
      expect(current.actorById("worker")).toBeDefined();
    }
    expect(restored.snapshot()).toEqual(simulation.snapshot());
    expect(restored.economy!.harvesters[0]).toMatchObject({
      cargo: 0,
      refineryId: "remote",
      phase: "idle",
    });
  });

  test("paused blueprints yield the slot, resume automatically, and refund fully", () => {
    const state = exploredScenarioState(scenario, ARC_ACTOR_DEFINITIONS);
    state.actors.push(
      blueprint("remote-work", 22, 13),
      blueprint("local-work", 7, 10),
    );
    const { simulation } = fixture(state);
    command(simulation, { kind: "sell-actor", actorId: "bridge" });
    const paused = simulation.actorById("remote-work")!.construction;
    ticks(simulation, 8);
    expect(simulation.actorById("remote-work")!.construction).toEqual(paused);
    expect(simulation.actorById("local-work")!.construction).toBeUndefined();
    simulation.spawnActor(building("replacement", 13, 10));
    simulation.tick();
    expect(
      simulation.actorById("remote-work")!.construction!.completedTicks,
    ).toBe(3);
    const materials = simulation.economy!.materials;
    expect(
      command(simulation, {
        kind: "cancel-construction",
        actorId: "remote-work",
      }).accepted,
    ).toBe(true);
    expect(simulation.economy!.materials).toBe(materials + 100);
  });

  test("a disconnected Refinery holds delivered cargo until reconnection", () => {
    const state: MissionState = exploredScenarioState(
      scenario,
      ARC_ACTOR_DEFINITIONS,
    );
    state.actors = state.actors.filter((actor) => actor.id !== "bridge");
    state.actors.push({
      id: "worker",
      definitionId: "arc-harvester",
      worldPosition: contentMap.tileCenter(19, 12),
      facing: 0,
      occupancyLayer: "surface",
    });
    state.economy!.harvesters.push({
      actorId: "worker",
      refineryId: "remote",
      cargo: 50,
      gatherProgress: 0,
      phase: "returning",
    });
    const { simulation } = fixture(state);
    const materials = simulation.economy!.materials;
    ticks(simulation, 20);
    expect(simulation.economy!.harvesters[0]).toMatchObject({
      cargo: 50,
      phase: "returning",
    });
    expect(simulation.economy!.materials).toBe(materials);
    simulation.spawnActor(building("replacement", 13, 10));
    ticks(simulation, 2);
    expect(simulation.economy!.materials).toBe(materials + 50);
    expect(simulation.economy!.harvesters[0].cargo).toBe(0);
  });
});
