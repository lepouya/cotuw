import {
  Color3,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  Vector3,
  VertexData,
} from "@babylonjs/core";

import { TERRAIN_LAYER_OFFSET } from "./terrain-mesh";

import type { Scene } from "@babylonjs/core";
import type { TerrainMap, TileCoord } from "../map";

const OVERLAY_OFFSET = 0.045;

/** Height that clears every terrain layer; scans every tile, so cache it. */
export function footprintOverlayOffset(map: TerrainMap): number {
  return map.layerCount * TERRAIN_LAYER_OFFSET + OVERLAY_OFFSET;
}

/** Draws a ground-hugging footprint; blocked previews also carry crosses. */
export function createFootprintOverlay(
  scene: Scene,
  map: TerrainMap,
  tiles: readonly TileCoord[],
  {
    name,
    color,
    blocked = false,
    heightOffset = footprintOverlayOffset(map),
  }: {
    name: string;
    color: Color3;
    blocked?: boolean;
    heightOffset?: number;
  },
) {
  const material = new StandardMaterial(`${name}-material`, scene);
  material.diffuseColor = color;
  material.emissiveColor = color;
  material.alpha = 0.22;
  material.backFaceCulling = false;
  const positions: number[] = [];
  const indices: number[] = [];
  const lines: Vector3[][] = [];
  for (const { x, z } of tiles) {
    if (!map.containsTile(x, z)) continue;
    const corners = [
      map.cornerPoint(x, z, heightOffset),
      map.cornerPoint(x + 1, z, heightOffset),
      map.cornerPoint(x + 1, z + 1, heightOffset),
      map.cornerPoint(x, z + 1, heightOffset),
    ];
    const start = positions.length / 3;
    positions.push(...corners.flatMap((corner) => corner.asArray()));
    // Use the terrain's diagonal so the fill follows nonplanar tiles.
    indices.push(start, start + 1, start + 3, start + 1, start + 2, start + 3);
    lines.push([...corners, corners[0]!]);
    if (blocked) {
      const center = map.worldPoint(x + 0.5, z + 0.5, 0);
      center.y = map.heightAtWorldPosition(center.x, center.z) + heightOffset;
      lines.push(
        [corners[0]!, center, corners[2]!],
        [corners[1]!, corners[3]!],
      );
    }
  }
  const fill = new Mesh(`${name}-fill`, scene);
  const data = new VertexData();
  data.positions = positions;
  data.indices = indices;
  data.normals = [];
  VertexData.ComputeNormals(positions, indices, data.normals);
  data.applyToMesh(fill);
  fill.material = material;
  fill.isPickable = false;
  const outline = lines.length
    ? MeshBuilder.CreateLineSystem(`${name}-outline`, { lines }, scene)
    : undefined;
  if (outline) {
    outline.color = color;
    outline.isPickable = false;
  }
  return {
    dispose: () => {
      fill.dispose();
      outline?.dispose();
      material.dispose();
    },
  };
}
