import {
  Color3,
  DynamicTexture,
  Material,
  Mesh,
  type Observer,
  Scene,
  StandardMaterial,
  VertexData,
} from "@babylonjs/core";
import type { TerrainBounds, TerrainMap, TileLayer } from "../map";
import { createDebugOverlay } from "./debug-overlay";

const CHUNK_SIZE = 32;
export const TERRAIN_LAYER_OFFSET = 0.012;

type LayerTile = {
  x: number;
  z: number;
  layer: TileLayer;
};

type LayerGroup = {
  layerIndex: number;
  texture?: string;
  tiles: LayerTile[];
};

export type TerrainMeshes = {
  dispose: () => void;
};

export type TerrainMeshOptions = {
  debugOverlay?: boolean;
};

/** Builds independently replaceable terrain chunks with shared materials. */
export function createTerrainMeshes(
  scene: Scene,
  map: TerrainMap,
  { debugOverlay = false }: TerrainMeshOptions = {},
): TerrainMeshes {
  const chunkMeshes = new Map<string, Mesh[]>();
  const materials = new Map<string | undefined, StandardMaterial>();

  const materialFor = (texture?: string) => {
    let material = materials.get(texture);

    if (!material) {
      material = createLayerMaterial(scene, texture);
      materials.set(texture, material);
    }

    return material;
  };

  const rebuildChunk = (chunkX: number, chunkZ: number) => {
    const chunkKey = `${chunkX},${chunkZ}`;

    for (const mesh of chunkMeshes.get(chunkKey) ?? []) {
      mesh.dispose();
    }

    const minX = chunkX * CHUNK_SIZE;
    const minZ = chunkZ * CHUNK_SIZE;
    const maxX = Math.min(minX + CHUNK_SIZE, map.width);
    const maxZ = Math.min(minZ + CHUNK_SIZE, map.height);
    const groups = new Map<number, Map<string | undefined, LayerGroup>>();

    for (let z = minZ; z < maxZ; z += 1) {
      for (let x = minX; x < maxX; x += 1) {
        for (const [layerIndex, layer] of map.layersAt(x, z).entries()) {
          const texture = layer.texture || undefined;
          let layerGroups = groups.get(layerIndex);

          if (!layerGroups) {
            layerGroups = new Map();
            groups.set(layerIndex, layerGroups);
          }

          let group = layerGroups.get(texture);

          if (!group) {
            group = { layerIndex, texture, tiles: [] };
            layerGroups.set(texture, group);
          }

          group.tiles.push({ x, z, layer });
        }
      }
    }

    const meshes: Mesh[] = [];
    for (const layerGroups of groups.values()) {
      for (const group of layerGroups.values()) {
        meshes.push(
          createLayerMesh(
            scene,
            map,
            chunkX,
            chunkZ,
            group,
            materialFor(group.texture),
          ),
        );
      }
    }
    chunkMeshes.set(chunkKey, meshes);
  };

  const dirtyChunks = new Set<string>();
  const markDirty = ({ minX, minZ, maxX, maxZ }: TerrainBounds) => {
    const minChunkX = Math.floor(minX / CHUNK_SIZE);
    const minChunkZ = Math.floor(minZ / CHUNK_SIZE);
    const maxChunkX = Math.floor(maxX / CHUNK_SIZE);
    const maxChunkZ = Math.floor(maxZ / CHUNK_SIZE);

    for (let chunkZ = minChunkZ; chunkZ <= maxChunkZ; chunkZ += 1) {
      for (let chunkX = minChunkX; chunkX <= maxChunkX; chunkX += 1) {
        dirtyChunks.add(`${chunkX},${chunkZ}`);
      }
    }
  };

  const refreshDirtyChunks = () => {
    for (const key of dirtyChunks) {
      const [chunkX, chunkZ] = key.split(",").map(Number);
      rebuildChunk(chunkX, chunkZ);
    }
    dirtyChunks.clear();
  };

  let refreshObserver: Observer<Scene> | undefined;
  let disposed = false;
  const overlay = debugOverlay
    ? createDebugOverlay(scene, map, { layerOffset: TERRAIN_LAYER_OFFSET })
    : undefined;
  const changeObserver = map.onChangedObservable.add((bounds) => {
    markDirty(bounds);

    if (!refreshObserver) {
      refreshObserver = scene.onBeforeRenderObservable.addOnce(() => {
        refreshDirtyChunks();
        refreshObserver = undefined;
      });
    }
  });
  const dispose = () => {
    if (disposed) {
      return;
    }

    disposed = true;
    overlay?.dispose();
    map.onChangedObservable.remove(changeObserver);
    if (refreshObserver) {
      scene.onBeforeRenderObservable.remove(refreshObserver);
    }
    scene.onDisposeObservable.remove(sceneDisposeObserver);

    for (const meshes of chunkMeshes.values()) {
      for (const mesh of meshes) {
        mesh.dispose();
      }
    }
    for (const material of materials.values()) {
      material.dispose(true, true);
    }
    chunkMeshes.clear();
    materials.clear();
    dirtyChunks.clear();
  };
  const sceneDisposeObserver = scene.onDisposeObservable.add(dispose);

  markDirty({ minX: 0, minZ: 0, maxX: map.width - 1, maxZ: map.height - 1 });
  refreshDirtyChunks();
  return { dispose };
}

function createLayerMesh(
  scene: Scene,
  map: TerrainMap,
  chunkX: number,
  chunkZ: number,
  { layerIndex, texture, tiles }: LayerGroup,
  material: StandardMaterial,
): Mesh {
  const positions: number[] = [];
  const indices: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const uvs: number[] = [];
  const heightOffset = layerIndex * TERRAIN_LAYER_OFFSET;

  for (const { x, z, layer } of tiles) {
    const vertexOffset = positions.length / 3;
    const corners = [
      [x, z],
      [x, z + 1],
      [x + 1, z],
      [x + 1, z + 1],
    ] as const;

    for (const [cornerX, cornerZ] of corners) {
      const position = map.worldPoint(
        cornerX,
        cornerZ,
        map.heightAt(cornerX, cornerZ) + heightOffset,
      );
      positions.push(position.x, position.y, position.z);
      layer.color.toArray(colors, colors.length);
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
  const textureName = texture ? `texture-${texture}` : "plain";
  const mesh = new Mesh(
    `terrain-${chunkX}-${chunkZ}-layer-${layerIndex}-${textureName}`,
    scene,
  );
  const vertexData = new VertexData();
  vertexData.positions = positions;
  vertexData.indices = indices;
  vertexData.normals = normals;
  vertexData.colors = colors;
  vertexData.uvs = uvs;
  vertexData.applyToMesh(mesh);
  mesh.hasVertexAlpha = true;
  mesh.material = material;
  return mesh;
}

function createLayerMaterial(scene: Scene, texture?: string): StandardMaterial {
  const textureName = texture ? `texture-${texture}` : "plain";
  const material = new StandardMaterial(
    `terrain-material-${textureName}`,
    scene,
  );
  material.diffuseColor = Color3.White();
  material.specularColor = Color3.Black();

  if (texture) {
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
