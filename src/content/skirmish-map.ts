// The rough M1 skirmish map.
import { deepFreeze } from "../simulation/actor";

import type { TileCoord } from "../simulation/grid";
import type { TerrainGridOptions } from "../simulation/terrain";
import type { ResourceArea, SkirmishMap } from "./skirmish";

/** Inclusive tile rows through the ridge; heights use the bounding corners. */
export type RidgeCrossing = {
  readonly id: string;
  readonly minZ: number;
  readonly maxZ: number;
};

const SIZE = 120;

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

export const SKIRMISH_STARTS: SkirmishMap["starts"] = deepFreeze([
  {
    id: "west",
    baseArea: { minX: 8, maxX: 35, minZ: 44, maxZ: 75 },
    headquartersOrigins: { arc: { x: 16, z: 59 }, circle: { x: 15, z: 58 } },
    dropoffOrigins: { arc: { x: 22, z: 59 }, circle: { x: 22, z: 59 } },
    startingResourceAreaId: "west-home",
  },
  {
    id: "east",
    baseArea: { minX: 84, maxX: 111, minZ: 44, maxZ: 75 },
    headquartersOrigins: {
      arc: { x: 102, z: 59 },
      circle: { x: 102, z: 59 },
    },
    dropoffOrigins: { arc: { x: 95, z: 59 }, circle: { x: 95, z: 59 } },
    startingResourceAreaId: "east-home",
  },
]);

const westAreas = [
  {
    id: "home",
    name: "Home",
    tiles: patch(25, 65),
    lifebloomTiles: [
      { x: 28, z: 62 },
      { x: 28, z: 67 },
    ],
  },
  {
    id: "shelf",
    name: "Shelf expansion",
    tiles: patch(29, 30),
    lifebloomTiles: [
      { x: 33, z: 31 },
      { x: 33, z: 35 },
    ],
  },
  {
    id: "forward",
    name: "Forward expansion",
    tiles: patch(45, 59),
    lifebloomTiles: [
      { x: 45, z: 63 },
      { x: 49, z: 63 },
    ],
  },
];
const northCrossing = {
  tiles: patch(59, 27),
  lifebloomTiles: [
    { x: 55, z: 24 },
    { x: 55, z: 31 },
  ],
};

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
    lifebloomTiles: area.lifebloomTiles.map(mirror),
  })),
  { ...northCrossing, id: "north-crossing", name: "North crossing" },
  {
    id: "south-crossing",
    name: "South crossing",
    tiles: northCrossing.tiles.map(mirror),
    lifebloomTiles: northCrossing.lifebloomTiles.map(mirror),
  },
]);

export const SKIRMISH_CROSSINGS: readonly RidgeCrossing[] = deepFreeze([
  { id: "north", minZ: 22, maxZ: 33 },
  { id: "center", minZ: 56, maxZ: 63 },
  { id: "south", minZ: 86, maxZ: 97 },
]);

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

export const SKIRMISH_MAP: SkirmishMap = {
  id: "skirmish",
  terrain: SKIRMISH_TERRAIN,
  starts: SKIRMISH_STARTS,
  resourceAreas: SKIRMISH_RESOURCE_AREAS,
};
