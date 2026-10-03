import {
  Color3,
  Mesh,
  StandardMaterial,
  Vector3,
  VertexData,
} from "@babylonjs/core";

import { clampToBounds, distance } from "../simulation/world";
import { TERRAIN_LAYER_OFFSET } from "./terrain-mesh";

import type { Scene } from "@babylonjs/core";
import type { TerrainMap } from "../map";
import type { FogView } from "../simulation/vision";

/** Below path, footprint, and support markers so they stay readable. */
const FOG_OFFSET = 0.02;
/** Draws after every terrain layer's blend slot. */
const FOG_ALPHA_INDEX = 1000;
export const EXPLORED_FOG_ALPHA = 0.55;

export type FogOverlay = {
  /** Redraws only when the fog version or terrain changes. */
  update: (fog: FogView | undefined) => void;
  dispose: () => void;
};

/**
 * A terrain-hugging sheet in the background color. Unexplored ground is
 * opaque, explored ground dimmed, and visible ground clear. Each corner takes
 * its darkest neighboring tile, so the soft edge falls inside known ground.
 */
export function createFogOverlay(
  scene: Scene,
  map: TerrainMap,
  color: Color3,
): FogOverlay {
  const columns = map.width + 1;
  const material = new StandardMaterial("fog-overlay", scene);
  material.diffuseColor = Color3.Black();
  material.specularColor = Color3.Black();
  material.emissiveColor = color.clone();
  material.disableLighting = true;
  material.disableDepthWrite = true;
  const mesh = new Mesh("fog-overlay", scene);
  const indices: number[] = [];
  // Matches the terrain mesh's triangle split so the sheet stays parallel.
  for (let z = 0; z < map.height; z += 1)
    for (let x = 0; x < map.width; x += 1) {
      const corner = z * columns + x;
      indices.push(
        corner,
        corner + 1,
        corner + columns,
        corner + 1,
        corner + columns + 1,
        corner + columns,
      );
    }
  const positions = () => {
    const offset = map.layerCount * TERRAIN_LAYER_OFFSET + FOG_OFFSET;
    const result: number[] = [];
    for (let z = 0; z <= map.height; z += 1)
      for (let x = 0; x <= map.width; x += 1) {
        const point = map.cornerPoint(x, z, offset);
        result.push(point.x, point.y, point.z);
      }
    return result;
  };
  const vertexData = new VertexData();
  vertexData.positions = positions();
  vertexData.indices = indices;
  vertexData.colors = cornerColors(map, undefined);
  vertexData.applyToMesh(mesh, true);
  mesh.material = material;
  mesh.hasVertexAlpha = true;
  mesh.isPickable = false;
  mesh.alphaIndex = FOG_ALPHA_INDEX;

  let version = -1;
  const terrainObserver = map.onChangedObservable.add(() =>
    mesh.updateVerticesData("position", positions()),
  );
  return {
    update: (fog) => {
      mesh.setEnabled(!!fog);
      if (!fog || fog.version === version) return;
      version = fog.version;
      mesh.updateVerticesData("color", cornerColors(map, fog));
    },
    dispose: () => {
      map.onChangedObservable.remove(terrainObserver);
      mesh.dispose();
      material.dispose();
    },
  };
}

/** How much fog covers a tile: opaque, dimmed, or clear. */
export function fogAlpha(fog: FogView, x: number, z: number): number {
  return fog.isVisible(x, z)
    ? 0
    : fog.isExplored(x, z)
      ? EXPLORED_FOG_ALPHA
      : 1;
}

/** White RGBA per corner; the material's emissive color sets the shade. */
export function cornerColors(
  map: TerrainMap,
  fog: FogView | undefined,
): number[] {
  const colors: number[] = [];
  for (let z = 0; z <= map.height; z += 1)
    for (let x = 0; x <= map.width; x += 1) {
      let alpha = 0;
      if (fog)
        for (const [tileX, tileZ] of [
          [x - 1, z - 1],
          [x, z - 1],
          [x - 1, z],
          [x, z],
        ])
          if (map.containsTile(tileX, tileZ))
            alpha = Math.max(alpha, fogAlpha(fog, tileX, tileZ));
      colors.push(1, 1, 1, alpha);
    }
  return colors;
}

/**
 * Keeps a camera focal point within `margin` world units of an explored tile
 * center, pulling it straight back towards the nearest one.
 */
export function limitToExplored(
  map: TerrainMap,
  fog: FogView,
  point: Vector3,
  margin: number,
): Vector3 {
  const ground = clampToBounds(point, map.worldBounds);
  const tile = map.tileAtWorldPosition(ground.x, ground.z);
  const center = map.tileCenter(tile.x, tile.z);
  if (fog.isExplored(tile.x, tile.z) && distance(point, center) <= margin)
    return point;
  let nearest: { x: number; z: number } | undefined;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (let z = 0; z < map.height; z += 1)
    for (let x = 0; x < map.width; x += 1) {
      if (!fog.isExplored(x, z)) continue;
      const center = map.tileCenter(x, z);
      const gap = distance(point, center);
      if (gap < nearestDistance) {
        nearest = center;
        nearestDistance = gap;
      }
    }
  if (!nearest || nearestDistance <= margin) return point;
  const scale = margin / nearestDistance;
  return new Vector3(
    nearest.x + (point.x - nearest.x) * scale,
    point.y,
    nearest.z + (point.z - nearest.z) * scale,
  );
}
