import {
  clampToBounds,
  distance,
  distanceToBounds,
  withinBounds,
} from "../simulation/world";
import { stableUnit } from "./actor";
import { hierarchyMeshes } from "./glb-model";

import type { TerrainMap } from "../map";
import type { TileCoord } from "../simulation/grid";
import type { BirdFlock } from "../simulation/mission-file";
import type { ModelAsset, ModelInstance } from "./glb-model";

/** Radians between neighbouring birds along their loop. */
const FLOCK_SPACING = 0.22;
/** Roll that raises the outer wing, banking toward the loop's center. */
const BANK = 0.25;
const MIN_RADIUS = 0.9;
const RADIUS_VARIATION = 0.2;

/** Terrain triangles stay below the corners of the tiles each loop crosses. */
function loopFloor(map: TerrainMap, { center, radius }: BirdFlock): number {
  const inner = radius * MIN_RADIUS;
  const outer = radius * (MIN_RADIUS + RADIUS_VARIATION);
  const tileAt = (x: number, z: number) => {
    const point = clampToBounds({ x, z }, map.worldBounds);
    return map.tileAtWorldPosition(point.x, point.z);
  };
  const low = tileAt(center.x - outer, center.z - outer);
  const high = tileAt(center.x + outer, center.z + outer);
  let floor = -Infinity;
  for (let z = low.z; z <= high.z; z++)
    for (let x = low.x; x <= high.x; x++) {
      const min = map.worldPoint(x, z, 0);
      const max = map.worldPoint(x + 1, z + 1, 0);
      const bounds = { minX: min.x, maxX: max.x, minZ: min.z, maxZ: max.z };
      if (
        distanceToBounds(center, bounds) > outer ||
        Math.max(
          distance(center, min),
          distance(center, max),
          distance(center, { x: min.x, z: max.z }),
          distance(center, { x: max.x, z: min.z }),
        ) < inner
      )
        continue;
      floor = Math.max(
        floor,
        map.heightAt(x, z),
        map.heightAt(x + 1, z),
        map.heightAt(x, z + 1),
        map.heightAt(x + 1, z + 1),
      );
    }
  return Number.isFinite(floor) ? floor : 0;
}

/**
 * Presentation-only birds circling authored loops. They hide over unexplored
 * terrain and hold still when motion is reduced.
 */
export function createAmbientBirdsView(
  map: TerrainMap,
  flocks: readonly BirdFlock[],
  {
    bird,
    explored,
    reducedMotion = () => false,
  }: {
    bird: () => ModelAsset | undefined;
    explored: (tile: TileCoord) => boolean;
    reducedMotion?: () => boolean;
  },
) {
  const inside = (x: number, z: number) =>
    withinBounds({ x, z }, map.worldBounds);
  let floors = flocks.map((flock) => loopFloor(map, flock));
  let terrainDirty = false;
  const terrainObserver = map.onChangedObservable.add(() => {
    terrainDirty = true;
  });
  let asset: ModelAsset | undefined;
  let birds: { instance: ModelInstance; flock: number; index: number }[] = [];
  let seconds = 0;
  const release = () => {
    for (const { instance } of birds) instance.dispose();
    birds = [];
  };
  return {
    /** `frameSeconds` is real time since the last update. */
    update: (frameSeconds: number) => {
      if (terrainDirty) {
        floors = flocks.map((flock) => loopFloor(map, flock));
        terrainDirty = false;
      }
      const loaded = bird();
      if (loaded !== asset) {
        release();
        asset = loaded;
        birds = asset
          ? flocks.flatMap((flock, flockIndex) =>
              Array.from({ length: flock.count }, (_, index) => {
                const instance = asset!.instantiate(
                  `bird-${flockIndex}-${index}`,
                );
                for (const mesh of hierarchyMeshes(instance.root))
                  mesh.isPickable = false;
                return { instance, flock: flockIndex, index };
              }),
            )
          : [];
      }
      if (!reducedMotion()) seconds += frameSeconds;
      for (const { instance, flock: flockIndex, index } of birds) {
        const flock = flocks[flockIndex]!;
        const seed = stableUnit(`bird-${flockIndex}-${index}`);
        const angle =
          ((seconds % flock.lapSeconds) / flock.lapSeconds) * Math.PI * 2 -
          index * FLOCK_SPACING;
        const radius = flock.radius * (MIN_RADIUS + seed * RADIUS_VARIATION);
        const x = flock.center.x + Math.cos(angle) * radius;
        const z = flock.center.z + Math.sin(angle) * radius;
        const shown = inside(x, z) && explored(map.tileAtWorldPosition(x, z));
        instance.root.setEnabled(shown);
        if (!shown) continue;
        instance.root.position.set(x, floors[flockIndex]! + flock.altitude, z);
        // Facing +Z, so the heading follows the loop's tangent.
        instance.root.rotation.y = Math.atan2(
          -Math.sin(angle),
          Math.cos(angle),
        );
        instance.root.rotation.z = BANK;
        instance.pose(seconds + seed);
      }
    },
    dispose: () => {
      map.onChangedObservable.remove(terrainObserver);
      release();
    },
  };
}
