import {
  Color3,
  DynamicTexture,
  Material,
  Mesh,
  Scene,
  StandardMaterial,
  VertexData,
} from "@babylonjs/core";
import type { TerrainMap, TileCorners, TileLayer } from "../map";
import { worldPoint } from "./world";

const LAYER_OFFSET = 0.012;
const UNTEXTURED = "color";

type LayerTile = {
  x: number;
  z: number;
  layer: TileLayer;
  corners: Readonly<TileCorners>;
};

/** The height above the terrain surface occupied by the layer stack. */
export function layerStackHeight(map: TerrainMap): number {
  return map.layerCount * LAYER_OFFSET;
}

export type TerrainMeshes = {
  /** Rebuilds terrain geometry from the current map state. */
  refresh: () => void;
};

/** Builds one mesh per layer index and texture, so each draws in one call. */
export function createTerrainMeshes(
  scene: Scene,
  map: TerrainMap,
): TerrainMeshes {
  let meshes: Mesh[] = [];

  const refresh = () => {
    for (const mesh of meshes) {
      mesh.dispose(false, true);
    }
    meshes = [];

    const layerCount = map.layerCount;

    for (let layerIndex = 0; layerIndex < layerCount; layerIndex += 1) {
      const groups = new Map<string, LayerTile[]>();

      for (let z = 0; z < map.height; z += 1) {
        for (let x = 0; x < map.width; x += 1) {
          const layer = map.getTileLayer(x, z, layerIndex);

          if (!layer) {
            continue;
          }

          const key = layer.texture ?? UNTEXTURED;
          const tiles = groups.get(key) ?? [];
          tiles.push({ x, z, layer, corners: map.getTileCorners(x, z) });
          groups.set(key, tiles);
        }
      }

      for (const [texture, tiles] of groups) {
        meshes.push(createLayerMesh(scene, map, layerIndex, texture, tiles));
      }
    }
  };

  refresh();
  return { refresh };
}

function createLayerMesh(
  scene: Scene,
  map: TerrainMap,
  layerIndex: number,
  texture: string,
  tiles: LayerTile[],
): Mesh {
  const positions: number[] = [];
  const indices: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const uvs: number[] = [];
  const heightOffset = layerIndex * LAYER_OFFSET;

  for (const { x, z, layer, corners: tileCorners } of tiles) {
    const vertexOffset = positions.length / 3;
    const corners = [
      [x, z, tileCorners.nw],
      [x, z + 1, tileCorners.sw],
      [x + 1, z, tileCorners.ne],
      [x + 1, z + 1, tileCorners.se],
    ] as const;

    for (const [cornerX, cornerZ, height] of corners) {
      const position = worldPoint(map, cornerX, cornerZ, height + heightOffset);
      positions.push(position.x, position.y, position.z);
      colors.push(...layer.tint, layer.alpha);
    }

    indices.push(
      vertexOffset,
      vertexOffset + 1,
      vertexOffset + 2,
      vertexOffset + 2,
      vertexOffset + 1,
      vertexOffset + 3,
    );
    uvs.push(0, 0, 0, 1, 1, 0, 1, 1);
  }

  VertexData.ComputeNormals(positions, indices, normals);
  const mesh = new Mesh(`terrain-layer-${layerIndex}-${texture}`, scene);
  const vertexData = new VertexData();
  vertexData.positions = positions;
  vertexData.indices = indices;
  vertexData.normals = normals;
  vertexData.colors = colors;
  vertexData.uvs = uvs;
  vertexData.applyToMesh(mesh);
  mesh.hasVertexAlpha = true;
  mesh.material = createLayerMaterial(scene, texture, layerIndex);
  return mesh;
}

function createLayerMaterial(
  scene: Scene,
  texture: string,
  layerIndex: number,
): StandardMaterial {
  const material = new StandardMaterial(
    `terrain-material-${layerIndex}-${texture}`,
    scene,
  );
  material.diffuseColor = Color3.White();
  material.specularColor = Color3.Black();

  if (texture !== UNTEXTURED) {
    material.diffuseTexture = createLayerTexture(scene, texture);
    material.useAlphaFromDiffuseTexture = true;
    material.transparencyMode = Material.MATERIAL_ALPHABLEND;
  }

  return material;
}

function createLayerTexture(scene: Scene, textureId: string): DynamicTexture {
  const texture = new DynamicTexture(
    `terrain-texture-${textureId}`,
    { width: 64, height: 64 },
    scene,
    false,
  );
  const context = texture.getContext() as CanvasRenderingContext2D;
  context.clearRect(0, 0, 64, 64);

  if (textureId === "terrain/dirt") {
    context.fillStyle = "rgb(255 255 255 / 56%)";
    for (let index = 0; index < 14; index += 1) {
      const x = (index * 23 + 7) % 64;
      const y = (index * 37 + 11) % 64;
      context.fillRect(x, y, 7, 5);
    }
  } else {
    context.fillStyle = "rgb(255 255 255 / 75%)";
    for (let index = 0; index < 19; index += 1) {
      const x = (index * 17 + 5) % 64;
      const y = (index * 29 + 13) % 64;
      context.beginPath();
      context.arc(x, y, 1.5, 0, Math.PI * 2);
      context.fill();
    }
  }

  texture.hasAlpha = true;
  texture.update(false);
  return texture;
}
