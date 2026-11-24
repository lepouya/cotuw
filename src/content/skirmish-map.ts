// The rough M1 skirmish map.
import { deepFreeze } from "../simulation/actor";
import { MAP_BORDER_TILES, withScenicBorder } from "./map-border";
import { mountainWallSurface } from "./mountain-wall";

import type { BorderScenery } from "./map-border";
import type { TerrainBounds, TileCoord } from "../simulation/grid";
import type { TerrainGridOptions } from "../simulation/terrain";

export type SkirmishFaction = "arc" | "circle";

/** One player position. */
export type SkirmishStart = {
  readonly id: string;
  /** Flat buildable ground around the headquarters. */
  readonly baseArea: Readonly<TerrainBounds>;
  /** Headquarters footprints differ by faction. */
  readonly headquartersOrigins: Readonly<
    Record<SkirmishFaction, Readonly<TileCoord>>
  >;
  /** Verified first drop-off placements. */
  readonly dropoffOrigins: Readonly<
    Record<SkirmishFaction, Readonly<TileCoord>>
  >;
  /** Income from this area is not an expansion. */
  readonly startingResourceAreaId: string;
  /** Turns the start's buildings, whose origins assume this rotation. */
  readonly quarterTurns: number;
};

export type ResourceArea = {
  readonly id: string;
  readonly name: string;
  readonly materialsTiles: readonly Readonly<TileCoord>[];
  readonly lifebloomTiles: readonly Readonly<TileCoord>[];
};

/** Everything assembly needs from a map, whether authored or generated. */
export type SkirmishMap = {
  /** Stable scenario ID; distinct maps use distinct IDs. */
  readonly id: string;
  readonly terrain: TerrainGridOptions;
  readonly starts: readonly [SkirmishStart, SkirmishStart];
  readonly resourceAreas: readonly ResourceArea[];
};

/** Inclusive tile rows through the ridge; heights use the bounding corners. */
export type RidgeCrossing = {
  readonly id: string;
  readonly minZ: number;
  readonly maxZ: number;
};

const SIZE = 120;
const RIDGE_HEIGHT = 3;

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

const WEST_START: SkirmishStart = {
  id: "west",
  baseArea: { minX: 8, maxX: 35, minZ: 44, maxZ: 75 },
  headquartersOrigins: { arc: { x: 16, z: 59 }, circle: { x: 15, z: 58 } },
  dropoffOrigins: { arc: { x: 22, z: 59 }, circle: { x: 22, z: 59 } },
  startingResourceAreaId: "west-home",
  quarterTurns: 0,
};
const mirrorOrigins = <K extends string>(
  origins: Readonly<Record<K, Readonly<TileCoord>>>,
) =>
  Object.fromEntries(
    Object.entries<Readonly<TileCoord>>(origins).map(([faction, origin]) => [
      faction,
      mirror(origin),
    ]),
  ) as Record<K, TileCoord>;

/** East is west turned a half turn about the map center, buildings included. */
const SKIRMISH_STARTS: SkirmishMap["starts"] = deepFreeze([
  WEST_START,
  {
    id: "east",
    baseArea: {
      minX: SIZE - 1 - WEST_START.baseArea.maxX,
      maxX: SIZE - 1 - WEST_START.baseArea.minX,
      minZ: SIZE - 1 - WEST_START.baseArea.maxZ,
      maxZ: SIZE - 1 - WEST_START.baseArea.minZ,
    },
    headquartersOrigins: mirrorOrigins(WEST_START.headquartersOrigins),
    dropoffOrigins: mirrorOrigins(WEST_START.dropoffOrigins),
    startingResourceAreaId: "east-home",
    quarterTurns: 2,
  },
]);

const westAreas = [
  {
    id: "home",
    name: "Home",
    materialsTiles: patch(25, 65),
    lifebloomTiles: [
      { x: 28, z: 62 },
      { x: 28, z: 67 },
    ],
  },
  {
    id: "shelf",
    name: "Shelf expansion",
    materialsTiles: patch(29, 30),
    lifebloomTiles: [
      { x: 33, z: 31 },
      { x: 33, z: 35 },
    ],
  },
  {
    id: "forward",
    name: "Forward expansion",
    materialsTiles: patch(45, 59),
    lifebloomTiles: [
      { x: 45, z: 63 },
      { x: 49, z: 63 },
    ],
  },
];
const northCrossing = {
  materialsTiles: patch(59, 27),
  lifebloomTiles: [
    { x: 55, z: 24 },
    { x: 55, z: 31 },
  ],
};

/** Stable areas support starting-income attribution for either faction. */
const SKIRMISH_RESOURCE_AREAS: readonly ResourceArea[] = deepFreeze([
  ...westAreas.map((area) => ({
    ...area,
    id: `west-${area.id}`,
    name: `West ${area.name}`,
  })),
  ...westAreas.map((area) => ({
    ...area,
    id: `east-${area.id}`,
    name: `East ${area.name}`,
    materialsTiles: area.materialsTiles.map(mirror),
    lifebloomTiles: area.lifebloomTiles.map(mirror),
  })),
  { ...northCrossing, id: "north-crossing", name: "North crossing" },
  {
    id: "south-crossing",
    name: "South crossing",
    materialsTiles: northCrossing.materialsTiles.map(mirror),
    lifebloomTiles: northCrossing.lifebloomTiles.map(mirror),
  },
]);

export const SKIRMISH_CROSSINGS: readonly RidgeCrossing[] = deepFreeze([
  { id: "north", minZ: 22, maxZ: 33 },
  { id: "center", minZ: 56, maxZ: 63 },
  { id: "south", minZ: 86, maxZ: 97 },
]);

function isRidgeCorner(x: number, z: number): boolean {
  return (
    x >= 58 &&
    x <= 62 &&
    !SKIRMISH_CROSSINGS.some(({ minZ, maxZ }) => z >= minZ && z <= maxZ + 1)
  );
}

/** Border tiles cut each corner along this sum of edge distances. */
const CORNER_CUT = 20;

function cutCornerDepth(x: number, z: number): number {
  const edgeX = Math.min(x, SIZE - x);
  const edgeZ = Math.min(z, SIZE - z);
  return (CORNER_CUT - edgeX - edgeZ) / 2;
}

/** One lake near the south edge and its mirror near the north. */
const LAKES = [
  { x: 44, z: 18 },
  { x: SIZE - 44, z: SIZE - 18 },
];
const LAKE_RADIUS = 6;
/** How far along the border its water rim reaches from a lake's center. */
const LAKE_RIM_REACH = 10;

/** Water rims the border beside each lake; rock rises elsewhere. */
function borderSceneryAt(x: number, z: number): BorderScenery {
  const nearEdge = (lakeZ: number) =>
    lakeZ < SIZE / 2 ? z < MAP_BORDER_TILES : z > SIZE - MAP_BORDER_TILES;
  return LAKES.some(
    (lake) => nearEdge(lake.z) && Math.abs(x - lake.x) < LAKE_RIM_REACH,
  )
    ? "water"
    : "rock";
}

const skirmishGround = {
  width: SIZE,
  height: SIZE,
  tileSize: 1,
  terrainTypeIds: ["plain", "path", "rough", "water"],
  createHeight: (x, z) => (isRidgeCorner(x, z) ? RIDGE_HEIGHT : 0),
  createTerrain: (x, z) => {
    const water = LAKES.some(
      (lake) => Math.hypot(x + 0.5 - lake.x, z + 0.5 - lake.z) < LAKE_RADIUS,
    );
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
      ...mountainWallSurface(isRidgeCorner, x, z),
    };
  },
} as const satisfies TerrainGridOptions;

export const SKIRMISH_TERRAIN = withScenicBorder(
  skirmishGround,
  borderSceneryAt,
  cutCornerDepth,
);

export const SKIRMISH_MAP: SkirmishMap = {
  id: "skirmish",
  terrain: SKIRMISH_TERRAIN,
  starts: SKIRMISH_STARTS,
  resourceAreas: SKIRMISH_RESOURCE_AREAS,
};
