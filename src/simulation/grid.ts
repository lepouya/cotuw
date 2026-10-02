/** Integer coordinates on a tile or corner grid. */
export type TileCoord = { x: number; z: number };

export type TerrainBounds = {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
};

export function isTileCoord(value: unknown): value is TileCoord {
  if (typeof value !== "object" || value === null) return false;
  const { x, z } = value as Partial<TileCoord>;
  return Number.isSafeInteger(x) && Number.isSafeInteger(z);
}

export function containsGridPoint(
  x: number,
  z: number,
  width: number,
  height: number,
): boolean {
  return isTileCoord({ x, z }) && x >= 0 && z >= 0 && x < width && z < height;
}

export function tileBounds(tiles: readonly TileCoord[]): TerrainBounds {
  if (tiles.length === 0) throw new RangeError("Empty tile bounds.");
  return tiles.reduce(
    (bounds, { x, z }) => ({
      minX: Math.min(bounds.minX, x),
      minZ: Math.min(bounds.minZ, z),
      maxX: Math.max(bounds.maxX, x),
      maxZ: Math.max(bounds.maxZ, z),
    }),
    {
      minX: tiles[0]!.x,
      minZ: tiles[0]!.z,
      maxX: tiles[0]!.x,
      maxZ: tiles[0]!.z,
    },
  );
}

/** A tile's identity for sets and maps. */
export function tileKey({ x, z }: TileCoord): string {
  return `${x},${z}`;
}

/** Width × depth of the tiles' bounding box, for display. */
export function footprintSize(tiles: readonly TileCoord[]): string {
  const { minX, minZ, maxX, maxZ } = tileBounds(tiles);
  return `${maxX - minX + 1} × ${maxZ - minZ + 1}`;
}

export function unionBounds(
  left: TerrainBounds,
  right: TerrainBounds,
): TerrainBounds {
  return {
    minX: Math.min(left.minX, right.minX),
    minZ: Math.min(left.minZ, right.minZ),
    maxX: Math.max(left.maxX, right.maxX),
    maxZ: Math.max(left.maxZ, right.maxZ),
  };
}
