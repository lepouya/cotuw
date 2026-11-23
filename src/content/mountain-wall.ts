/** Blocks surface use wherever an authored wall reaches a tile. */
export function mountainWallSurface(
  isWallCorner: (x: number, z: number) => boolean,
  x: number,
  z: number,
) {
  if (
    isWallCorner(x, z) ||
    isWallCorner(x + 1, z) ||
    isWallCorner(x, z + 1) ||
    isWallCorner(x + 1, z + 1)
  ) {
    return { surfacePassable: false, surfaceBuildable: false };
  }
}
