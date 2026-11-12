import type { WorldPosition } from "./world";

/** Buckets fixed positions for local queries; rebuild after positions move. */
export function createSpatialIndex<T>(
  cellSize: number,
  positionOf: (item: T) => WorldPosition,
) {
  if (!Number.isFinite(cellSize) || cellSize <= 0)
    throw new RangeError("Spatial cells need a positive finite size.");
  const cells = new Map<string, { x: number; z: number; items: T[] }>();
  const cellOf = (value: number) => Math.floor(value / cellSize);
  const key = (x: number, z: number) => `${x},${z}`;
  return {
    add: (item: T) => {
      const point = positionOf(item);
      const x = cellOf(point.x);
      const z = cellOf(point.z);
      const cell = key(x, z);
      const bucket = cells.get(cell);
      if (bucket) bucket.items.push(item);
      else cells.set(cell, { x, z, items: [item] });
    },
    /** Visits candidates in cells touching the square; false stops early. */
    visitNear: (
      point: WorldPosition,
      radius: number,
      visit: (item: T) => boolean | void,
    ): boolean => {
      const minX = cellOf(point.x - radius);
      const maxX = cellOf(point.x + radius);
      const minZ = cellOf(point.z - radius);
      const maxZ = cellOf(point.z + radius);
      // Wide queries scan occupied cells instead of huge empty ranges.
      if ((maxX - minX + 1) * (maxZ - minZ + 1) > cells.size) {
        for (const cell of cells.values()) {
          if (cell.x < minX || cell.x > maxX || cell.z < minZ || cell.z > maxZ)
            continue;
          for (const item of cell.items)
            if (visit(item) === false) return false;
        }
        return true;
      }
      for (let z = minZ; z <= maxZ; z++)
        for (let x = minX; x <= maxX; x++)
          for (const item of cells.get(key(x, z))?.items ?? [])
            if (visit(item) === false) return false;
      return true;
    },
  };
}
