// Procedural terrain for the economy opening, baked into its level file.
import type { TileCoord } from "../../src/simulation/grid.ts";
import type { TerrainGridOptions } from "../../src/simulation/terrain.ts";

const MAP_SIZE = 100;
const WATER_CENTER = { x: 42, z: 58 };
const WATER_RADIUS = 10;
const MOUNTAIN_HEIGHT = 6;

/** Inclusive tile ranges, or corner ranges for heights. */
type Area = { x: readonly [number, number]; z: readonly [number, number] };

/** Conical peaks that rise from mountain walls as navigation landmarks. */
export type TerrainLandmark = {
  readonly id: string;
  readonly peaks: readonly Readonly<TileCoord>[];
  readonly rise: number;
  readonly radius: number;
};

const PATHS: readonly Area[] = [
  { x: [8, 91], z: [31, 34] },
  { x: [20, 91], z: [67, 70] },
  { x: [82, 85], z: [32, 69] },
  { x: [77, 79], z: [20, 32] },
];
const ROUGH: readonly Area[] = [
  { x: [40, 57], z: [45, 61] },
  { x: [68, 86], z: [16, 25] },
];
/** The ridge and the den walls that join it. */
const MOUNTAINS: readonly Area[] = [
  { x: [61, 65], z: [12, 88] },
  { x: [65, 92], z: [12, 15] },
  { x: [88, 92], z: [12, 29] },
  { x: [65, 92], z: [26, 29] },
];
/** Ridge crossings and the den's northern entrance. */
const PASSES: readonly Area[] = [
  { x: [61, 65], z: [32, 36] },
  { x: [61, 65], z: [66, 72] },
  // Heights are tile corners, so flat corners 77–80 open tiles 77–79.
  { x: [77, 80], z: [26, 29] },
];

export const PROTOTYPE_LANDMARKS: readonly TerrainLandmark[] = [
  {
    id: "split-summit",
    peaks: [
      { x: 62, z: 42 },
      { x: 64, z: 44 },
    ],
    rise: 4,
    radius: 2,
  },
  {
    id: "den-teeth",
    peaks: [
      { x: 75, z: 27 },
      { x: 82, z: 27 },
    ],
    rise: 3,
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

function prototypeTerrainAt(x: number, z: number) {
  const border = x < 3 || z < 3 || x >= MAP_SIZE - 3 || z >= MAP_SIZE - 3;
  const typeId =
    prototypeWaterDepthAt(x, z) > 0
      ? "water"
      : within(PATHS, x, z)
        ? "path"
        : within(ROUGH, x, z)
          ? "rough"
          : "plain";
  return { typeId, outOfBounds: border || undefined };
}

function landmarkRiseAt(x: number, z: number): number {
  let rise = 0;
  for (const landmark of PROTOTYPE_LANDMARKS)
    for (const peak of landmark.peaks)
      rise = Math.max(
        rise,
        landmark.rise *
          (1 - Math.hypot(x - peak.x, z - peak.z) / landmark.radius),
      );
  return rise;
}

/**
 * The den's mountain walls join the ridge and leave one northern entrance.
 * Heights keep two decimals so the level file stays readable.
 */
function prototypeHeightAt(x: number, z: number): number {
  const hillDistance = Math.hypot(x - 39, z - 47);
  const hill = Math.max(0, 1 - hillDistance / 18) ** 2 * 3.5;
  const mountain = within(MOUNTAINS, x, z) && !within(PASSES, x, z);
  const wall = mountain ? MOUNTAIN_HEIGHT : 0;
  // Peaks rise only from walls, so they never narrow a pass.
  const peak = mountain ? landmarkRiseAt(x, z) : 0;
  const rolling = Math.sin(x * 0.13) * 0.08 + Math.cos(z * 0.11) * 0.07;
  // Adding 0 turns -0 into 0. The sign means nothing for terrain, but the
  // level file writes it and it has differed across platforms.
  return Math.round((hill + wall + peak + rolling) * 100) / 100 + 0;
}

export const PROTOTYPE_TERRAIN = {
  width: MAP_SIZE,
  height: MAP_SIZE,
  tileSize: 1,
  terrainTypeIds: ["plain", "path", "rough", "water"],
  createHeight: prototypeHeightAt,
  createTerrain: prototypeTerrainAt,
} as const satisfies TerrainGridOptions;
