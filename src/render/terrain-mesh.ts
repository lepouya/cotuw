import {
  Color3,
  Material,
  Mesh,
  type Observer,
  Scene,
  StandardMaterial,
  Texture,
  VertexData,
} from "@babylonjs/core";

import { layerSlot } from "../map";
import { createDebugOverlay } from "./debug-overlay";

import type { TerrainBounds, TerrainMap, TileLayer } from "../map";

const CHUNK_SIZE = 32;
export const TERRAIN_LAYER_OFFSET = 0.012;

/** Textures a layer can name, and how each is sampled. */
export const TERRAIN_TEXTURES = {
  "terrain/dirt": { url: "/assets/terrain/dirt.png", hasAlpha: false },
  "terrain/clutter": {
    url: "/assets/terrain/clutter.png",
    hasAlpha: true,
  },
  "terrain/water": {
    url: "/assets/terrain/water.png",
    hasAlpha: true,
    // The texture's own alpha caps even the deepest water at about two thirds
    // opaque, so the tile layer owns transparency and can fade to a shore.
    layerAlphaOnly: true,
    scrollSpeed: { u: 0.025, v: 0.012 },
  },
  "terrain/water-ripples": {
    url: "/assets/terrain/water.png",
    hasAlpha: true,
    scale: { u: 1.37, v: 1.37 },
    scrollSpeed: { u: -0.018, v: 0.032 },
  },
} as const;

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
  const animatedTextures = new Map<Texture, { u: number; v: number }>();

  const materialFor = (texture?: string) => {
    let material = materials.get(texture);

    if (!material) {
      material = createLayerMaterial(scene, texture);
      materials.set(texture, material);

      const source = texture ? terrainTextureSource(texture) : undefined;
      if (
        source &&
        "scrollSpeed" in source &&
        material.diffuseTexture instanceof Texture
      ) {
        animatedTextures.set(material.diffuseTexture, source.scrollSpeed);
      }
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
        for (const [index, layer] of map.layersAt(x, z).entries()) {
          const layerIndex = layerSlot(layer, index);
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
  const markDirty = (bounds: TerrainBounds) => {
    for (const key of chunksForBounds(map, bounds)) {
      dirtyChunks.add(key);
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
  const animationObserver = scene.onBeforeRenderObservable.add(() => {
    const elapsedSeconds = scene.getEngine().getDeltaTime() / 1000;

    // One offset unit is one full repeat, so wrapping never moves the phase.
    for (const [texture, speed] of animatedTextures) {
      texture.uOffset = (texture.uOffset + speed.u * elapsedSeconds) % 1;
      texture.vOffset = (texture.vOffset + speed.v * elapsedSeconds) % 1;
    }
  });
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
    scene.onBeforeRenderObservable.remove(animationObserver);
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
    animatedTextures.clear();
    dirtyChunks.clear();
  };
  const sceneDisposeObserver = scene.onDisposeObservable.add(dispose);

  markDirty({ minX: 0, minZ: 0, maxX: map.width - 1, maxZ: map.height - 1 });
  refreshDirtyChunks();
  return { dispose };
}

/**
 * Chunks that must be rebuilt for an edit, widened by one tile because
 * feathered corner alpha reads the neighboring tiles.
 */
export function chunksForBounds(
  map: TerrainMap,
  { minX, minZ, maxX, maxZ }: TerrainBounds,
): string[] {
  const minChunkX = Math.floor(Math.max(0, minX - 1) / CHUNK_SIZE);
  const minChunkZ = Math.floor(Math.max(0, minZ - 1) / CHUNK_SIZE);
  const maxChunkX = Math.floor(Math.min(map.width - 1, maxX + 1) / CHUNK_SIZE);
  const maxChunkZ = Math.floor(Math.min(map.height - 1, maxZ + 1) / CHUNK_SIZE);
  const keys: string[] = [];

  for (let chunkZ = minChunkZ; chunkZ <= maxChunkZ; chunkZ += 1) {
    for (let chunkX = minChunkX; chunkX <= maxChunkX; chunkX += 1) {
      keys.push(`${chunkX},${chunkZ}`);
    }
  }

  return keys;
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
      const { r, g, b } = layer.color;
      positions.push(position.x, position.y, position.z);
      colors.push(r, g, b, cornerAlpha(map, layer, cornerX, cornerZ));
      // Global tile coordinates keep the texture phase continuous across
      // quads and chunk boundaries.
      uvs.push(cornerX, cornerZ);
    }

    indices.push(
      vertexOffset,
      vertexOffset + 2,
      vertexOffset + 1,
      vertexOffset + 2,
      vertexOffset + 3,
      vertexOffset + 1,
    );
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
  mesh.hasVertexAlpha = tiles.some(
    ({ layer }) => layer.color.a < 1 || layer.featherEdges,
  );
  mesh.material = material;
  // Layers overlap at almost the same depth, so blend order must follow the
  // stack rather than Babylon's distance sort.
  mesh.alphaIndex = layerIndex;
  return mesh;
}

/**
 * The layer's own alpha, or when it feathers, the average across the tiles
 * meeting at this corner, counting tiles without the layer as clear. Tiles off
 * the map are skipped so borders do not feather inward.
 */
export function cornerAlpha(
  map: TerrainMap,
  layer: TileLayer,
  cornerX: number,
  cornerZ: number,
): number {
  if (!layer.featherEdges) {
    return layer.color.a;
  }

  // Same empty-string normalization as the mesh grouping.
  const texture = layer.texture || undefined;
  let total = 0;
  let sampled = 0;
  for (const [x, z] of [
    [cornerX - 1, cornerZ - 1],
    [cornerX, cornerZ - 1],
    [cornerX - 1, cornerZ],
    [cornerX, cornerZ],
  ]) {
    if (!map.containsTile(x, z)) {
      continue;
    }

    const neighbor = map
      .layersAt(x, z)
      .find((candidate) => (candidate.texture || undefined) === texture);
    total += neighbor?.color.a ?? 0;
    sampled += 1;
  }

  return sampled > 0 ? total / sampled : 0;
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
    const source = terrainTextureSource(texture);
    material.diffuseTexture = createLayerTexture(scene, source);
    material.useAlphaFromDiffuseTexture =
      source.hasAlpha && !("layerAlphaOnly" in source);
    if (source.hasAlpha) {
      material.transparencyMode = Material.MATERIAL_ALPHABLEND;
    }
  }

  return material;
}

function createLayerTexture(
  scene: Scene,
  source: TerrainTextureSource,
): Texture {
  const texture = new Texture(source.url, scene);
  texture.hasAlpha = source.hasAlpha;
  // Repeating rather than mirroring, which would alternate reflected copies.
  // Relies on matching opposite edges; see scripts/reconcile-texture-edges.mjs.
  texture.wrapU = Texture.WRAP_ADDRESSMODE;
  texture.wrapV = Texture.WRAP_ADDRESSMODE;
  if ("scale" in source) {
    texture.uScale = source.scale.u;
    texture.vScale = source.scale.v;
  }
  return texture;
}

type TerrainTextureSource =
  (typeof TERRAIN_TEXTURES)[keyof typeof TERRAIN_TEXTURES];

function terrainTextureSource(textureId: string): TerrainTextureSource {
  if (!Object.prototype.hasOwnProperty.call(TERRAIN_TEXTURES, textureId)) {
    throw new Error(`Unknown terrain texture "${textureId}".`);
  }

  return TERRAIN_TEXTURES[textureId as keyof typeof TERRAIN_TEXTURES];
}
