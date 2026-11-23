import { Color3, Mesh, StandardMaterial, VertexData } from "@babylonjs/core";

import { aboveTerrainLayers } from "./terrain-mesh";

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
  const surfaceSize = columns * (map.height + 1);
  const perimeter = perimeterCorners(map.width, map.height);
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
  // The raised sheet can leave a sliver of terrain exposed at oblique angles.
  for (const [i, top] of perimeter.entries()) {
    const next = (i + 1) % perimeter.length;
    indices.push(
      top,
      surfaceSize + i,
      perimeter[next],
      perimeter[next],
      surfaceSize + i,
      surfaceSize + next,
    );
  }
  const positions = () => {
    const offset = aboveTerrainLayers(map, FOG_OFFSET);
    const result: number[] = [];
    for (let z = 0; z <= map.height; z += 1)
      for (let x = 0; x <= map.width; x += 1) {
        const point = map.cornerPoint(x, z, offset);
        result.push(point.x, point.y, point.z);
      }
    for (const corner of perimeter) {
      const x = corner % columns;
      const z = Math.floor(corner / columns);
      const point = map.cornerPoint(x, z);
      result.push(point.x, point.y, point.z);
    }
    return result;
  };
  const colors = (fog: FogView | undefined) => {
    const result = cornerColors(map, fog);
    for (const corner of perimeter)
      result.push(1, 1, 1, result[4 * corner + 3]);
    return result;
  };
  const vertexData = new VertexData();
  vertexData.positions = positions();
  vertexData.indices = indices;
  vertexData.colors = colors(undefined);
  vertexData.applyToMesh(mesh, true);
  mesh.material = material;
  mesh.hasVertexAlpha = true;
  mesh.isPickable = false;
  mesh.alphaIndex = FOG_ALPHA_INDEX;

  let version = -1;
  const terrainObserver = map.onChangedObservable.add(() => {
    mesh.updateVerticesData("position", positions());
    version = -1;
  });
  return {
    update: (fog) => {
      mesh.setEnabled(!!fog);
      if (!fog || fog.version === version) return;
      version = fog.version;
      mesh.updateVerticesData("color", colors(fog));
    },
    dispose: () => {
      map.onChangedObservable.remove(terrainObserver);
      mesh.dispose();
      material.dispose();
    },
  };
}

function perimeterCorners(width: number, height: number): number[] {
  const columns = width + 1;
  const corners: number[] = [];
  for (let x = 0; x < width; x++) corners.push(x);
  for (let z = 0; z < height; z++) corners.push(z * columns + width);
  for (let x = width; x > 0; x--) corners.push(height * columns + x);
  for (let z = height; z > 0; z--) corners.push(z * columns);
  return corners;
}

/** How much fog covers a tile: opaque, dimmed, or clear. */
export function fogAlpha(fog: FogView, x: number, z: number): number {
  if (fog.isVisible(x, z)) return 0;
  return fog.isExplored(x, z) ? EXPLORED_FOG_ALPHA : 1;
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
      if (fog) {
        // Fade the outer edge of scenic terrain into the background.
        let scenicEdge =
          x === 0 || x === map.width || z === 0 || z === map.height;
        for (let tileZ = z - 1; tileZ <= z; tileZ += 1)
          for (let tileX = x - 1; tileX <= x; tileX += 1) {
            if (!map.containsTile(tileX, tileZ)) continue;
            alpha = Math.max(alpha, fogAlpha(fog, tileX, tileZ));
            scenicEdge &&= map.terrainAt(tileX, tileZ).outOfBounds === true;
          }
        if (scenicEdge) alpha = 1;
      }
      colors.push(1, 1, 1, alpha);
    }
  return colors;
}
