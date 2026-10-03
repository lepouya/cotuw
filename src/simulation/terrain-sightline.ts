import type { TerrainGrid } from "./terrain";
import type { WorldPosition } from "./world";

type SightPoint = WorldPosition & { height: number };

/** Heights are absolute; touching the terrain does not block the segment. */
export function terrainSightlineClear(
  map: TerrainGrid,
  from: SightPoint,
  to: SightPoint,
): boolean {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const clearAt = (t: number) =>
    map.heightAtWorldPosition(from.x + dx * t, from.z + dz * t) <=
    from.height + (to.height - from.height) * t;
  if (!clearAt(0) || !clearAt(1)) return false;
  const x = (from.x - map.worldBounds.minX) / map.tileSize;
  const z = (from.z - map.worldBounds.minZ) / map.tileSize;
  const gridDx = dx / map.tileSize;
  const gridDz = dz / map.tileSize;
  // Terrain and the segment are linear between grid edges and tile diagonals.
  for (const [start, delta] of [
    [x, gridDx],
    [z, gridDz],
    [x + z, gridDx + gridDz],
  ]) {
    const end = start + delta;
    for (
      let boundary = Math.floor(Math.min(start, end)) + 1;
      boundary < Math.max(start, end);
      boundary += 1
    )
      if (!clearAt((boundary - start) / delta)) return false;
  }
  return true;
}
