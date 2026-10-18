import { describe, expect, test, vi } from "vitest";
import { ARC_ACTOR_DEFINITIONS } from "./helpers/content";
import { createActor } from "../src/simulation/actor";
import { createMissionSimulation } from "../src/simulation/mission";
import { OccupancyGrid } from "../src/simulation/occupancy";
import { createTilePlacedActor } from "../src/simulation/placement";
import {
  createScenarioState,
  defineScenario,
} from "../src/simulation/scenario";
import { parseMission, serializeMission } from "../src/simulation/mission-file";
import { TerrainGrid } from "../src/simulation/terrain";
import { createTerrainMoveBehavior } from "../src/simulation/terrain-movement";
import { visibleTiles } from "../src/simulation/vision";

import type { MissionState } from "../src/simulation/mission";
import type { ActorDefinition } from "../src/simulation/actor";
import type { TerrainGridOptions } from "../src/simulation/terrain";

test("sight queries scan map tiles instead of the unbounded vision circle", () => {
  const map = new TerrainGrid({ width: 3, height: 2, tileSize: 1 });
  const contains = vi.spyOn(map, "containsTile");
  expect(visibleTiles(map, map.tileCenter(1, 1), 100)).toEqual([
    0, 1, 2, 3, 4, 5,
  ]);
  expect(contains.mock.calls.length).toBeLessThan(100);
  expect(visibleTiles(map, map.tileCenter(1, 1), Number.MAX_VALUE)).toEqual([
    0, 1, 2, 3, 4, 5,
  ]);
});

const definitions = new Map(
  ARC_ACTOR_DEFINITIONS.map((definition) => [definition.id, definition]),
);
const mapOptions = {
  width: 48,
  height: 24,
  tileSize: 1,
  terrainTypeIds: ["plain", "path", "rough", "water"],
};
const contentMap = new TerrainGrid(mapOptions);
const scenario = defineScenario({
  id: "vision-test",
  playerFaction: "arc",
  tileSize: 1,
  terrainTypeIds: mapOptions.terrainTypeIds,
  terrain: contentMap.terrainState(),
  materials: 1000,
  sites: [
    {
      id: "near",
      name: "Near",
      tile: { x: 5, z: 14 },
      initialMaterials: 100,
      remainingMaterials: 100,
    },
    {
      id: "far",
      name: "Far",
      tile: { x: 40, z: 20 },
      initialMaterials: 100,
      remainingMaterials: 100,
    },
  ],
  loot: [],
  buildings: [
    {
      actorId: "cc",
      definitionId: "arc-command-center-prototype",
      origin: { x: 2, z: 10 },
    },
  ],
});

function fixture(
  state = createScenarioState(scenario, ARC_ACTOR_DEFINITIONS),
  actorDefinitions: readonly ActorDefinition[] = ARC_ACTOR_DEFINITIONS,
) {
  const map = new TerrainGrid(mapOptions);
  const occupancy = new OccupancyGrid(map);
  const simulation = createMissionSimulation({
    state,
    map,
    occupancy,
    definitions: actorDefinitions,
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
  return { simulation, map, fog: simulation.fog! };
}

function placed(id: string, definitionId: string, x: number, z: number) {
  return createTilePlacedActor(contentMap, definitions.get(definitionId)!, {
    actorId: id,
    origin: { x, z },
  });
}

/** A scout at tile (10, 11) sent east until it stands on tile (40, 11). */
function scouted() {
  const { simulation, map, fog } = fixture();
  simulation.spawnActor(
    createActor({
      id: "scout",
      definitionId: "arc-scout",
      worldPosition: map.tileCenter(10, 11),
    }),
  );
  simulation.submitCommand({
    kind: "move",
    actorId: "scout",
    target: map.tileCenter(40, 11),
  });
  for (let tick = 0; tick < 8; tick += 1) simulation.tick();
  expect(simulation.actorById("scout")!.movement).toBeUndefined();
  return { simulation, map, fog };
}

describe("fog of war", () => {
  test("the map starts unexplored except around the Command Center", () => {
    const { fog } = fixture();
    expect(fog.isVisible(3, 11)).toBe(true);
    expect(fog.isExplored(16, 11)).toBe(true);
    expect(fog.isExplored(18, 11)).toBe(false);
    expect(fog.isVisible(18, 11)).toBe(false);
    expect(fog.isExplored(-1, 11)).toBe(false);
  });

  test("a moving Scout explores terrain that stays remembered", () => {
    const { fog } = scouted();
    expect(fog.isVisible(40, 11)).toBe(true);
    expect(fog.isExplored(25, 11)).toBe(true);
    expect(fog.isVisible(25, 11)).toBe(false);
    expect(fog.isVisible(3, 11)).toBe(true);
  });

  test("blueprints and disconnected buildings provide no vision", () => {
    const state = createScenarioState(scenario, ARC_ACTOR_DEFINITIONS);
    state.actors.push(
      placed("connected", "arc-field-barracks", 12, 10),
      placed("offline", "arc-materials-refinery", 30, 10),
      {
        ...placed("blueprint", "arc-field-barracks", 40, 10),
        construction: { paidMaterials: 100, completedTicks: 1, totalTicks: 8 },
      },
    );
    const { fog } = fixture(state);
    expect(fog.isVisible(20, 11)).toBe(true);
    expect(fog.isExplored(31, 11)).toBe(false);
    expect(fog.isExplored(41, 11)).toBe(false);
  });

  test("snapshots keep explored terrain and malformed fog is rejected", () => {
    const { simulation } = scouted();
    const { fog } = fixture(
      parseMission(serializeMission(scenario, simulation.snapshot(), 1), 1)
        .state,
    );
    expect(fog.isExplored(25, 11)).toBe(true);
    expect(fog.isVisible(25, 11)).toBe(false);
    const invalid: MissionState = {
      ...createScenarioState(scenario, ARC_ACTOR_DEFINITIONS),
      fog: { explored: "01" },
    };
    expect(() => fixture(invalid)).toThrow("Mission state has invalid fog.");
  });

  test("saves without explored terrain reveal the whole map", () => {
    const state = createScenarioState(scenario, ARC_ACTOR_DEFINITIONS);
    const saved = JSON.parse(serializeMission(scenario, state, 1));
    delete saved.state.fog;
    const { simulation } = fixture(
      parseMission(JSON.stringify(saved), 1).state,
    );
    expect(simulation.fog).toBeUndefined();
    saved.state.fog = { explored: ["2".repeat(scenario.terrain.width)] };
    expect(() => parseMission(JSON.stringify(saved), 1)).toThrow(
      "explored rows",
    );
  });

  test("building placement and rally points require explored terrain", () => {
    const state = createScenarioState(scenario, ARC_ACTOR_DEFINITIONS);
    state.actors.push(placed("barracks", "arc-field-barracks", 6, 10));
    const { simulation, map } = fixture(state);
    const barracks = (x: number, z: number) =>
      simulation.evaluatePlacement({
        actorId: "next",
        definitionId: "arc-field-barracks",
        origin: { x, z },
      });
    expect(barracks(9, 14).accepted).toBe(true);
    expect(barracks(20, 10)).toMatchObject({
      accepted: false,
      reason: "unexplored",
    });
    expect(
      simulation.evaluateRallyPoint("barracks", map.tileCenter(10, 14)),
    ).toBe(true);
    expect(
      simulation.evaluateRallyPoint("barracks", map.tileCenter(30, 11)),
    ).toBe(false);
  });
});

test("harvesters cannot be ordered to undiscovered sites", () => {
  const { simulation, map } = fixture();
  simulation.spawnActor(
    createActor({
      id: "harvester",
      definitionId: "arc-harvester",
      worldPosition: map.tileCenter(6, 16),
    }),
  );
  const gather = (siteId: string) => {
    simulation.submitCommand({ kind: "gather", actorId: "harvester", siteId });
    return simulation.tick()[0];
  };
  expect(gather("far")).toMatchObject({ reason: "missing-site" });
  // An explored site passes the fog check and fails on the missing Refinery.
  expect(gather("near")).toMatchObject({ reason: "missing-refinery" });
});

test("automatic harvesting waits for unexplored patch tiles to be discovered", () => {
  const actorDefinitions = ARC_ACTOR_DEFINITIONS.map((definition) => ({
    ...definition,
    vision: { radius: 0.5 },
  }));
  const state = createScenarioState(scenario, actorDefinitions);
  state.economy!.sites = [
    {
      id: "known",
      name: "Patch",
      tile: { x: 30, z: 11 },
      initialMaterials: 1,
      remainingMaterials: 0,
    },
    {
      id: "hidden",
      name: "Patch",
      tile: { x: 32, z: 11 },
      initialMaterials: 100,
      remainingMaterials: 100,
    },
  ];
  state.actors.push(
    placed("refinery", "arc-materials-refinery", 6, 10),
    createActor({
      id: "worker",
      definitionId: "arc-harvester",
      worldPosition: contentMap.tileCenter(30, 11),
    }),
  );
  state.economy!.harvesters.push({
    actorId: "worker",
    refineryId: "refinery",
    cargo: 0,
    gatherProgress: 0,
    phase: "idle",
  });
  const { simulation, fog, map } = fixture(state, actorDefinitions);
  expect(fog.isExplored(30, 11)).toBe(true);
  expect(fog.isExplored(32, 11)).toBe(false);
  const gather = () => {
    simulation.submitCommand({
      kind: "gather",
      actorId: "worker",
      siteId: "known",
    });
    expect(simulation.tick()[0].accepted).toBe(true);
  };
  gather();
  expect(simulation.economy!.harvesters[0].phase).toBe("depleted");
  expect(simulation.actorById("worker")!.movement).toBeUndefined();
  simulation.spawnActor(
    createActor({
      id: "scout",
      definitionId: "arc-scout",
      worldPosition: map.tileCenter(32, 11),
    }),
  );
  gather();
  expect(simulation.economy!.harvesters[0].activeSiteId).toBe("hidden");
  expect(simulation.actorById("worker")!.movement!.target).toEqual(
    map.tileCenter(32, 11),
  );
});

describe("visibleTiles", () => {
  const wallMap = (createHeight: TerrainGridOptions["createHeight"]) =>
    new TerrainGrid({ width: 24, height: 12, tileSize: 1, createHeight });
  const sees = (map: TerrainGrid, from: number, to: number) =>
    visibleTiles(map, map.tileCenter(from, 5), 12).includes(5 * map.width + to);

  test("is a radius on flat ground", () => {
    const map = wallMap(() => 0);
    const tiles = visibleTiles(map, map.tileCenter(12, 6), 3);
    expect(tiles).toHaveLength(29);
    expect(tiles).toContain(6 * map.width + 15);
    expect(tiles).not.toContain(9 * map.width + 15);
  });

  test("a diagonal corner peak hides the tile behind it", () => {
    const map = wallMap((x, z) => (x === 2 && z === 2 ? 1.1 : 0));
    const tiles = visibleTiles(map, map.tileCenter(1, 1), 3);
    expect(tiles).not.toContain(2 * map.width + 2);
  });

  test("a ridge hides the ground behind it but not its own face", () => {
    const map = wallMap((x) => (x >= 10 && x <= 11 ? 4 : 0));
    expect(sees(map, 3, 10)).toBe(true);
    expect(sees(map, 3, 14)).toBe(false);
  });

  test("high ground near its rim sees over a lower ridge", () => {
    const map = wallMap((x) => (x <= 6 ? 12 : x >= 10 && x <= 11 ? 4 : 0));
    expect(sees(map, 5, 14)).toBe(true);
    // The plateau's own rim hides low ground from farther back.
    expect(sees(map, 3, 14)).toBe(false);
  });
});
