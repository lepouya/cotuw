import { expect, test, vi } from "vitest";
import { balance, deposited } from "./helpers/scenario";
import {
  SKIRMISH_CROSSINGS,
  SKIRMISH_OPENINGS,
  SKIRMISH_RESOURCE_AREAS,
  SKIRMISH_STARTS,
  SKIRMISH_TERRAIN,
  createSkirmishMaterialsSites,
  createSkirmishOpening,
} from "../scripts/levels/skirmish-map";
import { BASE_CONTENT } from "./helpers/content";
import { LEVEL_SOURCES } from "../src/content/levels";
import { createSessionSimulation, loadMission } from "../src/mission-loading";
import { SIMULATION_TICK_SECONDS } from "../src/simulation/clock";
import { materialsCost } from "../src/simulation/resources";
import { tileKey } from "../src/simulation/grid";
import { serializeMission } from "../src/simulation/mission-file";
import {
  findNavigationPath,
  NavigationGrid,
} from "../src/simulation/navigation";
import { OccupancyGrid } from "../src/simulation/occupancy";
import { createScenarioState } from "../src/simulation/scenario";
import { TerrainGrid } from "../src/simulation/terrain";

import type {
  RidgeCrossing,
  SkirmishStart,
} from "../scripts/levels/skirmish-map";
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
const approach = (map: TerrainView, { headquartersOrigin }: SkirmishStart) =>
  map.tileCenter(headquartersOrigin.x, headquartersOrigin.z - 3);

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
  expect(new Set(sites.map(({ id }) => id)).size).toBe(sites.length);
  const tiles = new Set(sites.map(({ tile }) => tileKey(tile)));
  expect(tiles.size).toBe(sites.length);
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
  const { headquarters, dropoff } = SKIRMISH_OPENINGS.arc;
  expect(footprint(headquarters, east.headquartersOrigin)).toEqual(
    footprint(headquarters, west.headquartersOrigin, flip),
  );
  expect(footprint(dropoff, east.dropoffOrigins.arc!)).toEqual(
    footprint(dropoff, west.dropoffOrigins.arc!, flip),
  );
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
      for (const tile of area.tiles)
        expect(grid.costAt(tile.x, tile.z)).toBeDefined();
      const tile = area.tiles[0];
      expect(
        findNavigationPath(grid, from, map.tileCenter(tile.x, tile.z))
          ?.reachedTarget,
        area.id,
      ).toBe(true);
    }
  },
);

function until(simulation: MissionSimulation, ready: () => boolean) {
  const limit = 150 / SIMULATION_TICK_SECONDS;
  for (let tick = 0; tick < limit && !ready(); tick++) simulation.tick();
  expect(ready()).toBe(true);
}

test("only Materials openings assemble until owner economies exist", () => {
  expect(() => createSkirmishOpening(SKIRMISH_STARTS[0], "circle")).toThrow(
    /lifebloom/,
  );
});

test.each(SKIRMISH_STARTS)(
  "ARC can fund and deliver its first income from $id",
  (start) => {
    const opening = SKIRMISH_OPENINGS.arc;
    expect(
      materialsCost(definitions.get(opening.dropoff)!) +
        materialsCost(definitions.get(opening.worker)!),
    ).toBe(opening.stockpile);
    const scenario = createSkirmishOpening(start, "arc");
    const source = serializeMission(
      scenario,
      createScenarioState(scenario, BASE_CONTENT.actors),
      SIMULATION_TICK_SECONDS,
    );
    const simulation = createSessionSimulation(loadMission(source));
    try {
      simulation.submitCommand({
        kind: "place-actor",
        actorId: "refinery",
        definitionId: opening.dropoff,
        origin: start.dropoffOrigins.arc!,
      });
      expect(simulation.tick()[0].accepted).toBe(true);
      until(simulation, () => !simulation.actorById("refinery")!.construction);
      simulation.submitCommand({
        kind: "train-unit",
        producerId: "refinery",
        actorId: "harvester",
        definitionId: opening.worker,
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
