import { Color3, Mesh, StandardMaterial, VertexData } from "@babylonjs/core";
import { footprintOverlayOffset } from "./footprint-overlay";
import type { Scene, TransformNode } from "@babylonjs/core";
import type { TerrainMap, TileCoord } from "../map";

/** Marks the preferred exit; blocked exits may send units to another side. */
export function createProductionExitMarker(
  scene: Scene,
  map: TerrainMap,
  root: TransformNode,
  tiles: readonly TileCoord[],
  facing: number,
) {
  const forward = {
    x: Math.round(Math.sin(facing)),
    z: Math.round(Math.cos(facing)),
  };
  const points = tiles.map(({ x, z }) => map.tileCenter(x, z));
  const center = {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    z: points.reduce((sum, point) => sum + point.z, 0) / points.length,
  };
  const extent =
    Math.max(
      ...points.map(
        (point) =>
          (point.x - center.x) * forward.x + (point.z - center.z) * forward.z,
      ),
    ) +
    map.tileSize * 0.5;
  const positions: number[] = [];
  const heightOffset = footprintOverlayOffset(map) + 0.02;
  for (const [side, ahead] of [
    [-0.14, 0.15],
    [0.14, 0.15],
    [0.14, 0.65],
    [-0.14, 0.65],
    [-0.42, 0.6],
    [0.42, 0.6],
    [0, 1.1],
  ]) {
    const x =
      center.x +
      forward.x * (extent + ahead * map.tileSize) +
      forward.z * side * map.tileSize;
    const z =
      center.z +
      forward.z * (extent + ahead * map.tileSize) -
      forward.x * side * map.tileSize;
    const height = map.heightAtWorldPosition(
      Math.max(map.worldBounds.minX, Math.min(map.worldBounds.maxX, x)),
      Math.max(map.worldBounds.minZ, Math.min(map.worldBounds.maxZ, z)),
    );
    positions.push(x, height + heightOffset, z);
  }
  const mesh = new Mesh(`${root.name}-exit-arrow`, scene);
  const data = new VertexData();
  data.positions = positions;
  data.indices = [0, 1, 2, 0, 2, 3, 4, 5, 6];
  data.applyToMesh(mesh);
  mesh.parent = root;
  mesh.isPickable = false;
  const material = new StandardMaterial(`${mesh.name}-material`, scene);
  material.emissiveColor = new Color3(1, 0.82, 0.24);
  material.disableLighting = true;
  material.backFaceCulling = false;
  mesh.material = material;
  return {
    dispose: () => {
      mesh.dispose();
      material.dispose();
    },
  };
}
