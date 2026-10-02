export const PROTOTYPE_MAP_SIZE = 100;
const TILE_COUNT = PROTOTYPE_MAP_SIZE;
export const WATER_HALF_WIDTH = 10;
export const WATER_CENTER = { x: 42, z: 58 };

/** Authored semantics stay independent of Babylon terrain layers. */
export function prototypeTerrainAt(x: number, z: number) {
  const border = x < 3 || z < 3 || x >= TILE_COUNT - 3 || z >= TILE_COUNT - 3;
  const pond =
    Math.hypot(x + 0.5 - WATER_CENTER.x, z + 0.5 - WATER_CENTER.z) <
    WATER_HALF_WIDTH;
  const path =
    (z >= 31 && z <= 34 && x >= 8 && x <= 91) ||
    (z >= 67 && z <= 70 && x >= 20 && x <= 91) ||
    (x >= 82 && x <= 85 && z >= 32 && z <= 69);
  const rough = x >= 40 && x <= 57 && z >= 45 && z <= 61;

  return {
    typeId: pond ? "water" : path ? "path" : rough ? "rough" : "plain",
    outOfBounds: border || undefined,
  };
}

/** A gentle hill plus a high ridge with two deliberately legible crossings. */
export function prototypeHeightAt(x: number, z: number): number {
  const hillDistance = Math.hypot(x - 39, z - 47);
  const hill = Math.max(0, 1 - hillDistance / 18) ** 2 * 3.5;
  const inRidge = x >= 61 && x <= 65 && z >= 12 && z <= 88;
  const inCrossing = (z >= 30 && z <= 36) || (z >= 66 && z <= 72);
  const ridge = inRidge && !inCrossing ? 6 : 0;
  const rolling = Math.sin(x * 0.13) * 0.08 + Math.cos(z * 0.11) * 0.07;
  return hill + ridge + rolling;
}
