import { expect, test, vi } from "vitest";
import { balance, deposited } from "./helpers/scenario";
import {
  SKIRMISH_OPENINGS,
  createSkirmishScenario,
  createSkirmishCultivationSites,
  createSkirmishMaterialsSites,
  skirmishLink,
} from "../src/content/skirmish";
import {
  SKIRMISH_CROSSINGS,
  SKIRMISH_MAP,
  SKIRMISH_RESOURCE_AREAS,
  SKIRMISH_STARTS,
  SKIRMISH_TERRAIN,
} from "../src/content/skirmish-map";
import { BASE_CONTENT } from "./helpers/content";
import { LEVEL_SOURCES } from "../src/content/levels";
import {
  assembleSkirmish,
  createSessionSimulation,
  loadMission,
  missionRestart,
} from "../src/mission-loading";
import { SIMULATION_TICK_SECONDS } from "../src/simulation/clock";
import { serializeMission } from "../src/simulation/mission-file";
import { DIFFICULTIES } from "../src/simulation/mission-setup";
import { createScenarioState } from "../src/simulation/scenario";
import { costAmount } from "../src/simulation/resources";
import { tileKey } from "../src/simulation/grid";
import {
  findNavigationPath,
  NavigationGrid,
} from "../src/simulation/navigation";
import { OccupancyGrid } from "../src/simulation/occupancy";
import { TerrainGrid } from "../src/simulation/terrain";

import type { SkirmishMap, SkirmishStart } from "../src/content/skirmish";
import type { RidgeCrossing } from "../src/content/skirmish-map";
import type { TileCoord } from "../src/simulation/grid";
import type { TerrainView } from "../src/simulation/terrain";
import type { MissionSimulation } from "../src/simulation/mission";

vi.mock("../scripts/levels/m0", () => {
  throw new Error("Skirmish authoring loaded the M0 mission.");
});

const definitions = new Map(
  BASE_CONTENT.actors.map((actor) => [actor.id, actor]),
);

function navigation(map = new TerrainGrid(SKIRMISH_TERRAIN)) {
  return new NavigationGrid(
    map,
    new OccupancyGrid(map),
    BASE_CONTENT.movementProfiles.find(({ id }) => id === "surface-ground")!,
  );
}

/** The center of open ground just north of the headquarters. */
const approach = (map: TerrainView, { headquartersOrigins }: SkirmishStart) =>
  map.tileCenter(headquartersOrigins.arc.x, headquartersOrigins.arc.z - 3);

const mirrored = (map: TerrainGrid, { x, z }: TileCoord) => ({
  x: map.width - 1 - x,
  z: map.height - 1 - z,
});

/** Walls off the ridge column through each crossing. */
function closeCrossings(map: TerrainGrid, crossings: readonly RidgeCrossing[]) {
  map.editTerrain({
    tiles: crossings.flatMap(({ minZ, maxZ }) =>
      Array.from({ length: maxZ - minZ + 1 }, (_, offset) => ({
        x: 60,
        z: minZ + offset,
        terrain: { typeId: "plain", surfacePassable: false },
      })),
    ),
  });
}

test("the preview uses the authored terrain without a combat or economy setup", () => {
  const { state } = loadMission(LEVEL_SOURCES.get("skirmish-map")!);
  expect(state.terrain).toEqual(
    new TerrainGrid(SKIRMISH_TERRAIN).terrainState(),
  );
  expect(state.actors).toEqual([]);
  expect(state.economy).toBeUndefined();
  expect(state.fog).toBeUndefined();
});

test("terrain and resource access are symmetric under swapping starts", () => {
  const map = new TerrainGrid(SKIRMISH_TERRAIN);
  for (let z = 0; z < map.height; z++)
    for (let x = 0; x < map.width; x++) {
      const opposite = mirrored(map, { x, z });
      expect(map.terrainAt(x, z)).toEqual(
        map.terrainAt(opposite.x, opposite.z),
      );
      expect(map.slopeAt(x, z)).toBeCloseTo(
        map.slopeAt(opposite.x, opposite.z),
      );
    }
  const sites = createSkirmishMaterialsSites();
  const lifebloom = createSkirmishCultivationSites();
  const all = [...sites, ...lifebloom];
  expect(new Set(all.map(({ id }) => id)).size).toBe(all.length);
  const tiles = new Set(all.map(({ tile }) => tileKey(tile)));
  expect(tiles.size).toBe(all.length);
  for (const { tile, capacity } of lifebloom) {
    const opposite = mirrored(map, tile);
    expect(
      lifebloom.find(
        ({ tile: other }) => other.x === opposite.x && other.z === opposite.z,
      )!.capacity,
    ).toBe(capacity);
  }
  for (const { tile, initialMaterials } of sites) {
    const opposite = mirrored(map, tile);
    expect(
      sites.find(
        ({ tile: other }) => other.x === opposite.x && other.z === opposite.z,
      )!.initialMaterials,
    ).toBe(initialMaterials);
  }
});

test("start slots mirror each other's base and opening footprints", () => {
  const map = new TerrainGrid(SKIRMISH_TERRAIN);
  const [west, east] = SKIRMISH_STARTS;
  const footprint = (
    definitionId: string,
    origin: TileCoord,
    place = (tile: TileCoord) => tile,
  ) =>
    definitions
      .get(definitionId)!
      .footprint!.occupiedTiles.map(({ x, z }) =>
        tileKey(place({ x: origin.x + x, z: origin.z + z })),
      )
      .sort();
  const flip = (tile: TileCoord) => mirrored(map, tile);
  for (const faction of ["arc", "circle"] as const) {
    const { headquarters, dropoff } = SKIRMISH_OPENINGS[faction];
    expect(footprint(headquarters, east.headquartersOrigins[faction])).toEqual(
      footprint(headquarters, west.headquartersOrigins[faction], flip),
    );
    expect(footprint(dropoff, east.dropoffOrigins[faction])).toEqual(
      footprint(dropoff, west.dropoffOrigins[faction], flip),
    );
  }
  const { minX, maxX, minZ, maxZ } = west.baseArea;
  const low = flip({ x: maxX, z: maxZ });
  const high = flip({ x: minX, z: minZ });
  expect(east.baseArea).toEqual({
    minX: low.x,
    maxX: high.x,
    minZ: low.z,
    maxZ: high.z,
  });
});

test.each(SKIRMISH_CROSSINGS)(
  "the $id crossing connects the bases when the other crossings close",
  (crossing) => {
    const map = new TerrainGrid(SKIRMISH_TERRAIN);
    closeCrossings(
      map,
      SKIRMISH_CROSSINGS.filter(({ id }) => id !== crossing.id),
    );
    const grid = navigation(map);
    const [from, to] = SKIRMISH_STARTS.map((start) => approach(map, start));
    expect(findNavigationPath(grid, from, to)?.reachedTarget).toBe(true);
    closeCrossings(map, [crossing]);
    expect(findNavigationPath(grid, from, to)?.reachedTarget).not.toBe(true);
  },
);

test.each(SKIRMISH_STARTS)(
  "$id has flat base space and reachable income and expansions",
  (start) => {
    const grid = navigation();
    const { map } = grid;
    const { minX, maxX, minZ, maxZ } = start.baseArea;
    for (let z = minZ; z <= maxZ; z++)
      for (let x = minX; x <= maxX; x++) {
        expect(map.slopeAt(x, z)).toBe(0);
        expect(grid.costAt(x, z)).toBeDefined();
        expect(map.terrainAt(x, z).surfaceBuildable).not.toBe(false);
      }
    expect(SKIRMISH_RESOURCE_AREAS.map(({ id }) => id)).toContain(
      start.startingResourceAreaId,
    );
    const from = approach(map, start);
    for (const area of SKIRMISH_RESOURCE_AREAS) {
      for (const tile of [...area.tiles, ...area.lifebloomTiles]) {
        expect(grid.costAt(tile.x, tile.z)).toBeDefined();
        expect(
          findNavigationPath(grid, from, map.tileCenter(tile.x, tile.z))
            ?.reachedTarget,
          area.id,
        ).toBe(true);
      }
    }
  },
);

function until(simulation: MissionSimulation, ready: () => boolean) {
  const limit = 150 / SIMULATION_TICK_SECONDS;
  for (let tick = 0; tick < limit && !ready(); tick++) simulation.tick();
  expect(ready()).toBe(true);
}

function opening(faction: "arc" | "circle", start: SkirmishStart) {
  return createSessionSimulation(
    assembleSkirmish({
      factions: { west: faction, east: faction },
      playerSlot: start.id,
      difficulty: "normal",
    }),
  );
}

test.each(SKIRMISH_STARTS)(
  "ARC can fund and deliver its first income from $id",
  (start) => {
    const { dropoff, worker, stockpile } = SKIRMISH_OPENINGS.arc;
    expect(
      costAmount(definitions.get(dropoff)!) +
        costAmount(definitions.get(worker)!),
    ).toBe(stockpile);
    const simulation = opening("arc", start);
    try {
      simulation.submitCommand({
        kind: "place-actor",
        actorId: "refinery",
        definitionId: dropoff,
        origin: start.dropoffOrigins.arc,
      });
      expect(simulation.tick()[0].accepted).toBe(true);
      until(simulation, () => !simulation.actorById("refinery")!.construction);
      simulation.submitCommand({
        kind: "train-unit",
        producerId: "refinery",
        actorId: "harvester",
        definitionId: worker,
      });
      expect(simulation.tick()[0].accepted).toBe(true);
      expect(balance(simulation)).toBe(0);
      until(simulation, () => !!simulation.actorById("harvester"));
      simulation.submitCommand({
        kind: "gather",
        actorId: "harvester",
        siteId: `${start.startingResourceAreaId}-1`,
      });
      expect(simulation.tick()[0].accepted).toBe(true);
      until(simulation, () => deposited(simulation) > 0);
      expect(balance(simulation)).toBeGreaterThan(0);
    } finally {
      simulation.dispose();
    }
  },
);

test.each(SKIRMISH_STARTS)(
  "Circle can fund and deliver its first income from $id",
  (start) => {
    const { dropoff, headquarters, worker, stockpile } =
      SKIRMISH_OPENINGS.circle;
    expect(
      costAmount(definitions.get(dropoff)!) +
        costAmount(definitions.get(worker)!),
    ).toBe(stockpile);
    const simulation = opening("circle", start);
    const headquartersId = `${start.id}-headquarters`;
    try {
      expect(simulation.actorById(headquartersId)!.definitionId).toBe(
        headquarters,
      );
      simulation.submitCommand({
        kind: "train-unit",
        producerId: headquartersId,
        actorId: "cultivator",
        definitionId: worker,
      });
      expect(simulation.tick()[0].accepted).toBe(true);
      until(simulation, () => !!simulation.actorById("cultivator"));
      simulation.submitCommand({
        kind: "place-actor",
        actorId: "conservatory",
        definitionId: dropoff,
        origin: start.dropoffOrigins.circle,
        workerIds: ["cultivator"],
      });
      expect(simulation.tick()[0].accepted).toBe(true);
      expect(balance(simulation, "lifebloom")).toBe(0);
      until(
        simulation,
        () => !simulation.actorById("conservatory")!.construction,
      );
      simulation.submitCommand({
        kind: "gather",
        actorId: "cultivator",
        siteId: `${start.startingResourceAreaId}-lifebloom-1`,
      });
      expect(simulation.tick()[0].accepted).toBe(true);
      until(simulation, () => deposited(simulation, "lifebloom") > 0);
      expect(balance(simulation, "lifebloom")).toBeGreaterThan(0);
    } finally {
      simulation.dispose();
    }
  },
);

test.each([
  { west: "arc", east: "circle", playerSlot: "west" },
  { west: "arc", east: "circle", playerSlot: "east" },
  { west: "circle", east: "arc", playerSlot: "west" },
  { west: "arc", east: "arc", playerSlot: "east" },
])(
  "$west at west and $east at east assemble for the $playerSlot player",
  ({ west, east, playerSlot }) => {
    const mission = assembleSkirmish({
      factions: { west, east },
      playerSlot,
      difficulty: "hard",
    });
    const { scenario, state } = mission;
    expect(state.tick).toBe(0);
    expect(state.playerOwner).toBe(playerSlot);
    expect(state.owners).toEqual([
      { id: "west", faction: west },
      { id: "east", faction: east },
    ]);
    expect(
      state.actors.map(({ owner, definitionId }) => [owner, definitionId]),
    ).toEqual([
      ["west", SKIRMISH_OPENINGS[west as "arc"].headquarters],
      ["east", SKIRMISH_OPENINGS[east as "arc"].headquarters],
    ]);
    expect(state.economy!.stockpiles).toEqual([
      {
        resource: SKIRMISH_OPENINGS[west as "arc"].resource,
        owners: ["west"],
        amount: 150,
      },
      {
        resource: SKIRMISH_OPENINGS[east as "arc"].resource,
        owners: ["east"],
        amount: 150,
      },
    ]);
    expect(scenario.emergencyHeadquarters).toBe(true);
    expect(scenario.savePolicy).toBe("skirmish");
    expect(scenario.skirmish!.startingResourceSites.west).toEqual([
      "west-home-1",
      "west-home-2",
      "west-home-3",
      "west-home-4",
      "west-home-lifebloom-1",
      "west-home-lifebloom-2",
    ]);
    expect(scenario.setup).toEqual({
      difficulty: "hard",
      enemyScale: DIFFICULTIES.hard.scale,
      enemyOwners: [playerSlot === "west" ? "east" : "west"],
      factions: { west, east },
    });
  },
);

test("assembled sites do not depend on the matchup", () => {
  const sites = (west: string, east: string) => {
    const { economy } = assembleSkirmish({
      factions: { west, east },
      playerSlot: "west",
      difficulty: "normal",
    }).state;
    return [economy!.sites, economy!.cultivation!.sites];
  };
  expect(sites("arc", "arc")).toEqual(sites("circle", "arc"));
});

test("custom maps keep their identity and restart from their registered level", () => {
  const alternate: SkirmishMap = {
    ...SKIRMISH_MAP,
    id: "flat-skirmish",
    terrain: { ...SKIRMISH_MAP.terrain, createHeight: () => 0 },
  };
  const scenario = createSkirmishScenario(
    {
      factions: { west: "arc", east: "circle" },
      playerSlot: "east",
      difficulty: "hard",
    },
    alternate,
  );
  const source = serializeMission(
    scenario,
    createScenarioState(scenario, BASE_CONTENT.actors),
    SIMULATION_TICK_SECONDS,
  );
  const opening = loadMission(source);
  const simulation = createSessionSimulation(opening);
  try {
    simulation.tick();
    const saved = loadMission(
      serializeMission(
        scenario,
        simulation.snapshot(),
        SIMULATION_TICK_SECONDS,
        {
          save: { name: "Alternate map", savedAt: "2026-11-06T00:00:00.000Z" },
        },
      ),
    );
    expect(saved.scenario.id).toBe(alternate.id);
    expect(missionRestart(saved)).toBeUndefined();
    const restarted = missionRestart(saved, source)!();
    expect(restarted.state.tick).toBe(0);
    expect(restarted.state.terrain).toEqual(opening.state.terrain);
    expect(restarted.scenario.setup).toEqual(opening.scenario.setup);
  } finally {
    simulation.dispose();
  }
});

test("assembly requires an authored home resource area", () => {
  expect(() =>
    createSkirmishScenario(
      {
        factions: { west: "arc", east: "arc" },
        playerSlot: "west",
        difficulty: "normal",
      },
      { ...SKIRMISH_MAP, resourceAreas: [] },
    ),
  ).toThrow(
    new RangeError('Start slot west has no resource area "west-home".'),
  );
});

test("inherited faction assignments are not authored content", () => {
  const factions: Record<string, string> = Object.assign(
    Object.create({ west: "arc" }),
    { east: "circle", other: "arc" },
  );
  expect(() =>
    createSkirmishScenario({
      factions,
      playerSlot: "west",
      difficulty: "normal",
    }),
  ).toThrow("Start slot west has no playable faction.");
});

test("assembly rejects unknown factions and slots", () => {
  const difficulty = "normal";
  expect(() =>
    assembleSkirmish({
      factions: { west: "arc", east: "wildlife" },
      playerSlot: "west",
      difficulty,
    }),
  ).toThrow("Start slot east has no playable faction.");
  expect(() =>
    assembleSkirmish({
      factions: { west: "arc", east: "arc" },
      playerSlot: "north",
      difficulty,
    }),
  ).toThrow('no start slot named "north"');
});

test.each([
  ["skirmish=arc", "Start slot east has no playable faction."],
  ["skirmish=arc-circle-arc", "no start slot for an assigned faction"],
  ["skirmish=arc-arc&difficulty=brutal", "invalid difficulty"],
])("the link %s is rejected rather than reinterpreted", (query, message) => {
  const choice = skirmishLink(new URLSearchParams(query))!;
  expect(() => assembleSkirmish(choice)).toThrow(message);
});

test("skirmish links resolve matchups, sides, and difficulty", () => {
  expect(skirmishLink(new URLSearchParams("level=sandbox"))).toBeUndefined();
  expect(skirmishLink(new URLSearchParams("skirmish=arc-circle"))).toEqual({
    factions: { west: "arc", east: "circle" },
    playerSlot: "west",
    difficulty: "normal",
  });
  expect(
    skirmishLink(
      new URLSearchParams("skirmish=circle-arc&player=east&difficulty=hard"),
    ),
  ).toEqual({
    factions: { west: "circle", east: "arc" },
    playerSlot: "east",
    difficulty: "hard",
  });
});
