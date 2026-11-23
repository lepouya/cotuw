import { Vector3 } from "@babylonjs/core";

import { withinBounds } from "../simulation/world";

import type { TerrainMap } from "../map";
import type { FogView } from "../simulation/vision";
import type { WorldPosition } from "../simulation/world";
import type { FocusLimit, ViewExtent } from "./camera";

const VIEW_FRACTION = 1 / 3;

/**
 * Builds the focus limit for one viewer's explored terrain: some explored tile
 * must stay within the central third of the view.
 */
export function exploredFrontier(map: TerrainMap, fog: FogView): FocusLimit {
  let previousView: ViewExtent | undefined;
  let previousCount = -1;
  let previousPoint: Vector3 | undefined;
  let tiles: WorldPosition[] = [];
  let correction: Correction;

  return (point, view) => {
    if (!fog.exploredCount) return point;
    if (withinBounds(point, map.worldBounds)) {
      const { x, z } = map.tileAtWorldPosition(point.x, point.z);
      if (fog.isExplored(x, z)) return point;
    }
    const viewChanged = previousView !== view;
    const explorationChanged = previousCount !== fog.exploredCount;
    if (!viewChanged && !explorationChanged && previousPoint?.equals(point))
      return point;

    if (viewChanged) {
      previousView = view;
      correction = viewportCorrection(view, map.tileSize / 2);
    }
    if (explorationChanged) {
      // Exploration only grows within a session. Loading creates a new limit.
      previousCount = fog.exploredCount;
      tiles = [];
      for (let z = 0; z < map.height; z++)
        for (let x = 0; x < map.width; x++)
          if (fog.isExplored(x, z)) tiles.push(map.tileCenter(x, z));
    }

    const best = { x: point.x, z: point.z, distance: Infinity };
    for (const tile of tiles) {
      correction(point, tile, best);
      if (best.distance === 0) {
        previousPoint = point.clone();
        return point;
      }
    }
    previousPoint = new Vector3(best.x, point.y, best.z);
    return previousPoint.clone();
  };
}

type NearestFocus = WorldPosition & { distance: number };
type Correction = (
  point: WorldPosition,
  tile: WorldPosition,
  best: NearestFocus,
) => void;

function viewportCorrection(
  { right, up }: ViewExtent,
  halfTile: number,
): Correction {
  const generators: WorldPosition[] = [
    { x: halfTile, z: 0 },
    { x: 0, z: halfTile },
    { x: right.x * VIEW_FRACTION, z: right.z * VIEW_FRACTION },
    { x: up.x * VIEW_FRACTION, z: up.z * VIEW_FRACTION },
  ];
  // Add the central viewport rectangle and tile square. Walking their
  // combined edges in angular order gives the convex region of valid focus.
  const ordered = generators
    .filter(({ x, z }) => x !== 0 || z !== 0)
    .map(({ x, z }) =>
      z < 0 || (z === 0 && x < 0) ? { x: -x, z: -z } : { x, z },
    )
    .sort((a, b) => a.z * b.x - a.x * b.z);
  let startX = -ordered.reduce((sum, { x }) => sum + x, 0);
  let startZ = -ordered.reduce((sum, { z }) => sum + z, 0);
  const edges = [1, -1].flatMap((direction) =>
    ordered.map(({ x, z }) => {
      const dx = 2 * direction * x;
      const dz = 2 * direction * z;
      const edge = {
        x: startX,
        z: startZ,
        dx,
        dz,
        lengthSquared: dx * dx + dz * dz,
      };
      startX += dx;
      startZ += dz;
      return edge;
    }),
  );
  const extentX = generators.reduce((sum, { x }) => sum + Math.abs(x), 0);
  const extentZ = generators.reduce((sum, { z }) => sum + Math.abs(z), 0);
  return (point, tile, best) => {
    const x = point.x - tile.x;
    const z = point.z - tile.z;
    const gapX = Math.max(0, Math.abs(x) - extentX);
    const gapZ = Math.max(0, Math.abs(z) - extentZ);
    if (gapX * gapX + gapZ * gapZ >= best.distance) return;

    let distance = best.distance;
    let closestX = 0;
    let closestZ = 0;
    let inside = true;
    for (const edge of edges) {
      const ox = x - edge.x;
      const oz = z - edge.z;
      if (edge.dx * oz < edge.dz * ox) inside = false;
      const along = Math.max(
        0,
        Math.min(1, (ox * edge.dx + oz * edge.dz) / edge.lengthSquared),
      );
      const dx = along * edge.dx;
      const dz = along * edge.dz;
      const gap = (ox - dx) ** 2 + (oz - dz) ** 2;
      if (gap < distance) {
        distance = gap;
        closestX = edge.x + dx;
        closestZ = edge.z + dz;
      }
    }
    if (inside) {
      best.distance = 0;
    } else if (distance < best.distance) {
      best.distance = distance;
      best.x = tile.x + closestX;
      best.z = tile.z + closestZ;
    }
  };
}
