import { Vector3 } from "@babylonjs/core";
import type { TerrainMap } from "../map";

/** Converts map grid coordinates and a height into a world-space point. */
export function worldPoint(
  map: TerrainMap,
  x: number,
  z: number,
  height: number,
): Vector3 {
  return new Vector3(
    x * map.tileSize - (map.width * map.tileSize) / 2,
    height,
    z * map.tileSize - (map.height * map.tileSize) / 2,
  );
}

/** The world-space point on a map corner, raised by `heightOffset`. */
export function cornerPoint(
  map: TerrainMap,
  x: number,
  z: number,
  heightOffset = 0,
): Vector3 {
  return worldPoint(map, x, z, map.getCorner(x, z) + heightOffset);
}
