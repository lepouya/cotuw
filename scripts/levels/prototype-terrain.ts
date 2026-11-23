// Procedural terrain the wolf-den levels and sandbox bake into their files.
import {
  MAP_BORDER_TILES,
  withScenicBorder,
} from "../../src/content/map-border.ts";
import { mountainWallSurface } from "../../src/content/mountain-wall.ts";

import type { TileCoord } from "../../src/simulation/grid.ts";
import type { TerrainGridOptions } from "../../src/simulation/terrain.ts";

// Playable ground spans 94 tiles inside the border.
const MAP_SIZE = 94 + 2 * MAP_BORDER_TILES;
const WATER_CENTER = { x: 43, z: 59 };
const WATER_RADIUS = 10;
const MOUNTAIN_HEIGHT = 3;

/** Inclusive tile ranges, or corner ranges for heights. */
type Area = { x: readonly [number, number]; z: readonly [number, number] };

/** Conical peaks that rise from mountain walls as navigation landmarks. */
type TerrainLandmark = {
  readonly peaks: readonly Readonly<TileCoord>[];
  /** Peak height above the base terrain, independent of wall height. */
  readonly summitHeight: number;
  readonly radius: number;
};

const PATHS: readonly Area[] = [
  { x: [9, 92], z: [32, 35] },
  { x: [21, 92], z: [68, 71] },
  { x: [83, 86], z: [33, 70] },
  { x: [78, 80], z: [21, 33] },
];
const ROUGH: readonly Area[] = [
  { x: [41, 58], z: [46, 62] },
  { x: [69, 87], z: [17, 26] },
];
/** The ridge and the den walls that join it. */
const MOUNTAINS: readonly Area[] = [
  { x: [62, 66], z: [13, 89] },
  { x: [66, 93], z: [13, 16] },
  { x: [89, 93], z: [13, 30] },
  { x: [66, 93], z: [27, 30] },
];
/** Ridge crossings and the den's northern entrance. */
const PASSES: readonly Area[] = [
  { x: [62, 66], z: [33, 37] },
  { x: [62, 66], z: [67, 73] },
  // Heights are tile corners, so flat corners 78–81 open tiles 78–80.
  { x: [78, 81], z: [27, 30] },
];

const LANDMARKS: readonly TerrainLandmark[] = [
  {
    // Split summit
    peaks: [
      { x: 63, z: 43 },
      { x: 65, z: 45 },
    ],
    summitHeight: 10,
    radius: 2,
  },
  {
    // Den teeth
    peaks: [
      { x: 76, z: 28 },
      { x: 83, z: 28 },
    ],
    summitHeight: 9,
    radius: 2,
  },
];

const within = (areas: readonly Area[], x: number, z: number) =>
  areas.some(
    (area) =>
      x >= area.x[0] && x <= area.x[1] && z >= area.z[0] && z <= area.z[1],
  );

/** 1 at the pond's center, 0 at its bank, and negative beyond it. */
function prototypeWaterDepthAt(x: number, z: number): number {
  return (
    1 -
    Math.hypot(x + 0.5 - WATER_CENTER.x, z + 0.5 - WATER_CENTER.z) /
      WATER_RADIUS
  );
}

function prototypeTypeAt(x: number, z: number): string {
  if (prototypeWaterDepthAt(x, z) > 0) return "water";
  if (within(PATHS, x, z)) return "path";
  if (within(ROUGH, x, z)) return "rough";
  return "plain";
}

function isWallCorner(x: number, z: number): boolean {
  return within(MOUNTAINS, x, z) && !within(PASSES, x, z);
}

function wallHeightAt(x: number, z: number): number {
  // Peaks rise only from walls, so they never narrow a pass.
  if (!isWallCorner(x, z)) return 0;
  let height = MOUNTAIN_HEIGHT;
  for (const landmark of LANDMARKS)
    for (const peak of landmark.peaks)
      height = Math.max(
        height,
        MOUNTAIN_HEIGHT +
          (landmark.summitHeight - MOUNTAIN_HEIGHT) *
            (1 - Math.hypot(x - peak.x, z - peak.z) / landmark.radius),
      );
  return height;
}

function prototypeHeightAt(x: number, z: number): number {
  const hillDistance = Math.hypot(x - 40, z - 48);
  const hill = Math.max(0, 1 - hillDistance / 18) ** 2 * 3.5;
  // Keep the rolling terrain aligned with the playable ground.
  const rolling =
    Math.sin((x - 1) * 0.13) * 0.08 + Math.cos((z - 1) * 0.11) * 0.07;
  const height = hill + wallHeightAt(x, z) + rolling;
  // Adding zero normalizes signed zero for level files.
  return Math.round(height * 100) / 100 + 0;
}

const prototypeGround = {
  width: MAP_SIZE,
  height: MAP_SIZE,
  tileSize: 1,
  terrainTypeIds: ["plain", "path", "rough", "water"],
  createHeight: prototypeHeightAt,
  createTerrain: (x, z) => ({
    typeId: prototypeTypeAt(x, z),
    ...mountainWallSurface(isWallCorner, x, z),
  }),
} satisfies TerrainGridOptions;

export const PROTOTYPE_TERRAIN = withScenicBorder(
  prototypeGround,
  () => "rock",
);

/** Mountains close the wolf den's north and east, near its landmark summits. */
export const WOLF_DEN_TERRAIN = withScenicBorder(prototypeGround, (x, z) =>
  x > MAP_SIZE - MAP_BORDER_TILES || z > MAP_SIZE - MAP_BORDER_TILES
    ? "mountain"
    : "rock",
);
