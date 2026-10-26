// The rough M1 skirmish map and its launch-assembly inputs.
import { currentContentPack } from "../../src/content/packs.ts";
import { deepFreeze } from "../../src/simulation/actor.ts";
import { defineScenario } from "../../src/simulation/scenario.ts";
import { TerrainGrid } from "../../src/simulation/terrain.ts";

import type { MaterialsSite } from "../../src/simulation/economy.ts";
import type { TerrainBounds, TileCoord } from "../../src/simulation/grid.ts";
import type { ScenarioDefinition } from "../../src/simulation/scenario.ts";
import type { TerrainGridOptions } from "../../src/simulation/terrain.ts";

/** The starting package one faction receives at its start slot. */
export type FactionOpening = {
  readonly headquarters: string;
  readonly worker: string;
  readonly dropoff: string;
  readonly resource: string;
  /** Pays for the first worker and drop-off building. */
  readonly stockpile: number;
};

/** One player position; the map is point-symmetric between its two slots. */
export type SkirmishStart = {
  readonly id: string;
  /** Flat buildable ground around the headquarters. */
  readonly baseArea: Readonly<TerrainBounds>;
  readonly headquartersOrigin: Readonly<TileCoord>;
  /** Authored drop-off placements for factions that place one directly. */
  readonly dropoffOrigins: Readonly<
    Partial<Record<SkirmishFaction, Readonly<TileCoord>>>
  >;
  /** Income from this area is not an expansion. */
  readonly startingResourceAreaId: string;
};

export type ResourceArea = {
  readonly id: string;
  readonly name: string;
  readonly tiles: readonly Readonly<TileCoord>[];
};

/** Inclusive tile rows through the ridge; heights use the bounding corners. */
export type RidgeCrossing = {
  readonly id: string;
  readonly minZ: number;
  readonly maxZ: number;
};

const SIZE = 120;
const SITE_MATERIALS = 1000;

const mirror = ({ x, z }: TileCoord): TileCoord => ({
  x: SIZE - 1 - x,
  z: SIZE - 1 - z,
});
const patch = (x: number, z: number): TileCoord[] => [
  { x, z },
  { x: x + 1, z },
  { x, z: z + 1 },
  { x: x + 1, z: z + 1 },
];

// Circle IDs reserve assembly inputs; the current pack supplies ARC only.
export const SKIRMISH_OPENINGS = deepFreeze({
  arc: {
    headquarters: "arc-command-center-prototype",
    worker: "arc-harvester",
    dropoff: "arc-materials-refinery",
    resource: "materials",
    stockpile: 150,
  },
  circle: {
    headquarters: "circle-heartgrove",
    worker: "circle-cultivator",
    dropoff: "circle-lifebloom-conservatory",
    resource: "lifebloom",
    stockpile: 150,
  },
} satisfies Record<string, FactionOpening>);

export type SkirmishFaction = keyof typeof SKIRMISH_OPENINGS;

export const SKIRMISH_STARTS: readonly SkirmishStart[] = deepFreeze([
  {
    id: "west",
    baseArea: { minX: 8, maxX: 35, minZ: 44, maxZ: 75 },
    headquartersOrigin: { x: 16, z: 59 },
    dropoffOrigins: { arc: { x: 22, z: 59 } },
    startingResourceAreaId: "west-home",
  },
  {
    id: "east",
    baseArea: { minX: 84, maxX: 111, minZ: 44, maxZ: 75 },
    headquartersOrigin: { x: 102, z: 59 },
    dropoffOrigins: { arc: { x: 95, z: 59 } },
    startingResourceAreaId: "east-home",
  },
]);

const westAreas = [
  { id: "home", name: "Home", tiles: patch(25, 65) },
  { id: "shelf", name: "Shelf expansion", tiles: patch(29, 30) },
  { id: "forward", name: "Forward expansion", tiles: patch(45, 59) },
];

/** Stable areas support starting-income attribution for either faction. */
export const SKIRMISH_RESOURCE_AREAS: readonly ResourceArea[] = deepFreeze([
  ...westAreas.map((area) => ({
    ...area,
    id: `west-${area.id}`,
    name: `West ${area.name}`,
  })),
  ...westAreas.map((area) => ({
    ...area,
    id: `east-${area.id}`,
    name: `East ${area.name}`,
    tiles: area.tiles.map(mirror),
  })),
  { id: "north-crossing", name: "North crossing", tiles: patch(59, 27) },
  {
    id: "south-crossing",
    name: "South crossing",
    tiles: patch(59, 27).map(mirror),
  },
]);

export const SKIRMISH_CROSSINGS: readonly RidgeCrossing[] = deepFreeze([
  { id: "north", minZ: 22, maxZ: 33 },
  { id: "center", minZ: 56, maxZ: 63 },
  { id: "south", minZ: 86, maxZ: 97 },
]);

/** Numbered per area so `<area ID>-1` names each area's first site. */
export function createSkirmishMaterialsSites(): MaterialsSite[] {
  return SKIRMISH_RESOURCE_AREAS.flatMap((area) =>
    area.tiles.map((tile, index) => ({
      id: `${area.id}-${index + 1}`,
      name: `${area.name} Materials`,
      tile: { ...tile },
      initialMaterials: SITE_MATERIALS,
      remainingMaterials: SITE_MATERIALS,
    })),
  );
}

export const SKIRMISH_TERRAIN = {
  width: SIZE,
  height: SIZE,
  tileSize: 1,
  terrainTypeIds: ["plain", "path", "rough", "water"],
  createHeight: (x, z) => {
    const crossing = SKIRMISH_CROSSINGS.some(
      ({ minZ, maxZ }) => z >= minZ && z <= maxZ + 1,
    );
    return x >= 58 && x <= 62 && !crossing ? 6 : 0;
  },
  createTerrain: (x, z) => {
    const edgeX = Math.min(x, SIZE - 1 - x);
    const edgeZ = Math.min(z, SIZE - 1 - z);
    const outOfBounds = edgeX < 4 || edgeZ < 4 || edgeX + edgeZ < 20;
    const water =
      Math.hypot(x + 0.5 - 44, z + 0.5 - 18) < 6 ||
      Math.hypot(x + 0.5 - 76, z + 0.5 - 102) < 6;
    const horizontal =
      x >= 12 &&
      x <= 107 &&
      [26, 58, 90].some((row) => z >= row && z <= row + 3);
    const feeder =
      z >= 26 && z <= 93 && ((x >= 15 && x <= 18) || (x >= 101 && x <= 104));
    const rough =
      ((x >= 36 && x <= 45) || (x >= 74 && x <= 83)) &&
      ((z >= 40 && z <= 51) || (z >= 68 && z <= 79));
    return {
      typeId: water
        ? "water"
        : horizontal || feeder
          ? "path"
          : rough
            ? "rough"
            : "plain",
      outOfBounds: outOfBounds || undefined,
    };
  },
} as const satisfies TerrainGridOptions;

/**
 * One faction's opening at a start slot, before owner-based assembly. The
 * economy holds Materials only, so other resources cannot assemble yet.
 */
export function createSkirmishOpening(
  start: SkirmishStart,
  faction: SkirmishFaction,
): ScenarioDefinition {
  const opening = SKIRMISH_OPENINGS[faction];
  if (opening.resource !== "materials")
    throw new RangeError(`The ${faction} opening needs ${opening.resource}.`);
  const content = currentContentPack("base");
  const map = new TerrainGrid(SKIRMISH_TERRAIN);
  return defineScenario({
    id: `skirmish-${faction}-${start.id}`,
    content: { id: content.id, version: content.version },
    tileSize: map.tileSize,
    terrainTypeIds: [...map.terrainTypeIds],
    terrain: map.terrainState(),
    playerFaction: faction,
    buildings: [
      {
        actorId: "headquarters",
        definitionId: opening.headquarters,
        origin: start.headquartersOrigin,
      },
    ],
    materials: opening.stockpile,
    sites: createSkirmishMaterialsSites(),
    loot: [],
  });
}
