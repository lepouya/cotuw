import { Vector3 } from "@babylonjs/core";
import { clampToBounds } from "../simulation/world";
import type { TerrainMap } from "../map";
import type { WorldPosition } from "../simulation/world";

type GroundSampler = (point: Readonly<WorldPosition>) => Vector3;

export function groundPoint(
  map: TerrainMap,
  point: Readonly<WorldPosition>,
  offset: number,
): Vector3 {
  const sample = clampToBounds(point, map.worldBounds);
  return new Vector3(
    point.x,
    map.heightAtWorldPosition(sample.x, sample.z) + offset,
    point.z,
  );
}

export function groundRing(
  center: Readonly<WorldPosition>,
  radius: number,
  segments: number,
  sample: GroundSampler,
): Vector3[] {
  return Array.from({ length: segments + 1 }, (_, i) => {
    const angle = (i * Math.PI * 2) / segments;
    return sample({
      x: center.x + Math.cos(angle) * radius,
      z: center.z + Math.sin(angle) * radius,
    });
  });
}

export function groundCross(
  center: Readonly<WorldPosition>,
  diagonal: number,
  sample: GroundSampler,
): Vector3[][] {
  const corner = (x: number, z: number) =>
    sample({
      x: center.x + x * diagonal,
      z: center.z + z * diagonal,
    });
  return [
    [corner(-1, -1), corner(1, 1)],
    [corner(-1, 1), corner(1, -1)],
  ];
}
