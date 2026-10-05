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

import { createDebugOverlay } from "./debug-overlay";
import { loadClipFrames } from "./texture-clip";
import { compileTextureClip } from "../content/texture-clip";
import type { ClipFrames } from "./texture-clip";
import type { TextureClip } from "../content/texture-clip";

import type {
  TerrainBounds,
  TerrainMap,
  TileGraphics,
  TileLayer,
  TileType,
} from "../map";
import type { AbstractMesh } from "@babylonjs/core";

const CHUNK_SIZE = 32;
/** Clip lags round to this many shares of a cycle, each with one material. */
export const CLIP_PHASE_GROUPS = 8;
export const TERRAIN_LAYER_OFFSET = 0.012;
export const TERRAIN_PICK_KIND = "terrain";

type LayerTile = {
  x: number;
  z: number;
  layer: TileLayer;
};

type LayerGroup = {
  layerIndex: number;
  type?: TileType;
  /** The clip phase group its tiles share. */
  phase: number;
  tiles: LayerTile[];
};

export type TerrainMeshes = {
  dispose: () => void;
};

export type TerrainMeshOptions = {
  debugOverlay?: boolean;
  /** The content pack's clips, which tile graphics name. */
  clips?: Readonly<Record<string, TextureClip>>;
  /** Holds every clip on its first frame. */
  reducedMotion?: () => boolean;
};

/** Builds independently replaceable terrain chunks with shared materials. */
export function createTerrainMeshes(
  scene: Scene,
  map: TerrainMap,
  {
    debugOverlay = false,
    clips = {},
    reducedMotion = () => false,
  }: TerrainMeshOptions = {},
): TerrainMeshes {
  const chunkMeshes = new Map<string, Mesh[]>();
  const tileTypes = new Map<string, TileType>();
  // Types without graphics share one plain material.
  const materials = new Map<string, StandardMaterial>();
  const animatedTextures = new Map<Texture, { u: number; v: number }>();
  /** Each clip type's frame textures, shared by its phase groups. */
  const clipFrames = new Map<string, ClipFrames>();
  const timings = new Map<TextureClip, ReturnType<typeof compileTextureClip>>();
  const timingOf = (clip: TextureClip) => {
    let timing = timings.get(clip);
    if (!timing) {
      timing = compileTextureClip(clip);
      timings.set(clip, timing);
    }
    return timing;
  };
  const clipPlayers: {
    material: StandardMaterial;
    clip: TextureClip;
    frames: ClipFrames["frames"];
    frameAt: (seconds: number) => number;
    lagSeconds: number;
  }[] = [];
  let clipSeconds = 0;
  const clipOf = (type?: TileType) => {
    const id = type?.graphics?.clip;
    if (id === undefined) return undefined;
    const clip = clips[id];
    if (!clip) throw new Error(`Unknown texture clip: ${id}.`);
    return clip;
  };
  const phaseAt = (type: TileType | undefined, x: number, z: number) => {
    const clip = clipOf(type);
    const lag = type?.graphics?.clipPhase;
    if (!clip || !lag) return 0;
    const share = ((x * lag.u + z * lag.v) / timingOf(clip).duration) % 1;
    return (
      (Math.round(share * CLIP_PHASE_GROUPS) + CLIP_PHASE_GROUPS) %
      CLIP_PHASE_GROUPS
    );
  };
  const framesFor = (type: TileType, clip: TextureClip) => {
    let loading = clipFrames.get(type.id);
    if (!loading) {
      const graphics = type.graphics!;
      loading = loadClipFrames(scene, graphics.url, clip, (texture) => {
        configureLayerTexture(texture, graphics);
        if (graphics.scrollSpeed)
          animatedTextures.set(texture, graphics.scrollSpeed);
      });
      clipFrames.set(type.id, loading);
    }
    return loading.frames;
  };
  const canonicalType = (type?: TileType): TileType | undefined => {
    if (!type) {
      return undefined;
    }
    const known = tileTypes.get(type.id);
    if (known && !sameTileType(known, type)) {
      throw new Error(`Conflicting terrain tile type ID: ${type.id}.`);
    }
    if (known) {
      return known;
    }
    const copy = structuredClone(type);
    tileTypes.set(copy.id, copy);
    return copy;
  };
  // Validate the complete content catalog before allocating scene resources.
  for (let z = 0; z < map.height; z += 1) {
    for (let x = 0; x < map.width; x += 1) {
      for (const { type } of map.layersAt(x, z)) {
        canonicalType(type);
      }
    }
  }

  const materialFor = (type: TileType | undefined, phase: number) => {
    const textured = type?.graphics ? type : undefined;
    const clip = clipOf(textured);
    const key = JSON.stringify([textured?.id, clip ? phase : 0]);
    let material = materials.get(key);

    if (!material) {
      material = createLayerMaterial(scene, textured, !clip);
      materials.set(key, material);
      if (clip) {
        // Hidden until its frames load, rather than drawn as bare color.
        material.alpha = 0;
        clipPlayers.push({
          material,
          clip,
          frames: framesFor(textured!, clip),
          frameAt: timingOf(clip).frameAt,
          lagSeconds: (phase * timingOf(clip).duration) / CLIP_PHASE_GROUPS,
        });
      }

      const scrollSpeed = textured?.graphics?.scrollSpeed;
      if (scrollSpeed && material.diffuseTexture instanceof Texture) {
        animatedTextures.set(material.diffuseTexture, scrollSpeed);
      }
    }

    return material;
  };

  const rebuildChunk = (chunkX: number, chunkZ: number) => {
    const chunkKey = `${chunkX},${chunkZ}`;
    const minX = chunkX * CHUNK_SIZE;
    const minZ = chunkZ * CHUNK_SIZE;
    const maxX = Math.min(minX + CHUNK_SIZE, map.width);
    const maxZ = Math.min(minZ + CHUNK_SIZE, map.height);
    const groups = new Map<number, Map<string, LayerGroup>>();

    for (let z = minZ; z < maxZ; z += 1) {
      for (let x = minX; x < maxX; x += 1) {
        for (const [index, layer] of map.layersAt(x, z).entries()) {
          const type = canonicalType(layer.type);
          const layerIndex = type?.slot ?? index;
          const phase = phaseAt(type, x, z);
          const groupKey = JSON.stringify([type?.id, phase]);
          let layerGroups = groups.get(layerIndex);

          if (!layerGroups) {
            layerGroups = new Map();
            groups.set(layerIndex, layerGroups);
          }

          let group = layerGroups.get(groupKey);

          if (!group) {
            group = { layerIndex, type, phase, tiles: [] };
            layerGroups.set(groupKey, group);
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
            materialFor(group.type, group.phase),
          ),
        );
      }
    }
    for (const mesh of chunkMeshes.get(chunkKey) ?? []) {
      mesh.dispose();
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
    clipSeconds += elapsedSeconds;
    const still = reducedMotion();
    for (const { material, clip, frames, lagSeconds, frameAt } of clipPlayers) {
      const frame = frameAt(still ? 0 : clipSeconds - lagSeconds);
      const texture = frames.get(clip.frames[frame]!.cell);
      if (!texture || material.diffuseTexture === texture) continue;
      material.diffuseTexture = texture;
      material.alpha = 1;
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
    // Clip materials share frame textures, which are released once below.
    const clipMaterials = new Set(clipPlayers.map(({ material }) => material));
    for (const material of materials.values()) {
      material.dispose(true, !clipMaterials.has(material));
    }
    for (const loading of clipFrames.values()) loading.dispose();
    clipFrames.clear();
    timings.clear();
    clipPlayers.length = 0;
    chunkMeshes.clear();
    materials.clear();
    tileTypes.clear();
    animatedTextures.clear();
    dirtyChunks.clear();
  };
  const sceneDisposeObserver = scene.onDisposeObservable.add(dispose);

  markDirty({ minX: 0, minZ: 0, maxX: map.width - 1, maxZ: map.height - 1 });
  refreshDirtyChunks();
  return { dispose };
}

function sameTileType(left: TileType, right: TileType): boolean {
  return (
    left.id === right.id &&
    left.slot === right.slot &&
    Boolean(left.featherEdges) === Boolean(right.featherEdges) &&
    sameGraphics(left.graphics, right.graphics)
  );
}

function sameGraphics(
  left: TileGraphics | undefined,
  right: TileGraphics | undefined,
): boolean {
  if (!left || !right) {
    return left === right;
  }
  return (
    left.url === right.url &&
    left.clip === right.clip &&
    samePair(left.clipPhase, right.clipPhase) &&
    left.hasAlpha === right.hasAlpha &&
    Boolean(left.layerAlphaOnly) === Boolean(right.layerAlphaOnly) &&
    samePair(left.scale, right.scale) &&
    samePair(left.scrollSpeed, right.scrollSpeed) &&
    left.minimapColor.every(
      (channel, index) => channel === right.minimapColor[index],
    )
  );
}

function samePair(
  left: { u: number; v: number } | undefined,
  right: { u: number; v: number } | undefined,
): boolean {
  return left && right
    ? left.u === right.u && left.v === right.v
    : left === right;
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
  { layerIndex, type, tiles }: LayerGroup,
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
  const mesh = new Mesh(
    `terrain-${chunkX}-${chunkZ}-layer-${layerIndex}-${tileTypeName(type)}`,
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
    ({ layer }) => layer.color.a < 1 || layer.type?.featherEdges,
  );
  mesh.material = material;
  mesh.metadata = { pickKind: TERRAIN_PICK_KIND };
  // Layers overlap at almost the same depth, so blend order must follow the
  // stack rather than Babylon's distance sort.
  mesh.alphaIndex = layerIndex;
  return mesh;
}

/** Whether a mesh is one of this renderer's orderable terrain surfaces. */
export function isTerrainPickMesh(mesh: AbstractMesh | null): boolean {
  return mesh?.metadata?.pickKind === TERRAIN_PICK_KIND;
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
  if (!layer.type?.featherEdges) {
    return layer.color.a;
  }

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
      .find((candidate) => candidate.type?.id === layer.type?.id);
    total += neighbor?.color.a ?? 0;
    sampled += 1;
  }

  return sampled > 0 ? total / sampled : 0;
}

function tileTypeName(type?: TileType): string {
  return type ? `tile-${type.id}` : "plain";
}

/** `textured` false leaves the diffuse texture to a clip player. */
function createLayerMaterial(
  scene: Scene,
  type: TileType | undefined,
  textured: boolean,
): StandardMaterial {
  const material = new StandardMaterial(
    `terrain-material-${tileTypeName(type)}`,
    scene,
  );
  material.diffuseColor = Color3.White();
  material.specularColor = Color3.Black();

  const graphics = type?.graphics;
  if (graphics) {
    if (textured)
      material.diffuseTexture = configureLayerTexture(
        new Texture(graphics.url, scene),
        graphics,
      );
    material.useAlphaFromDiffuseTexture =
      graphics.hasAlpha && !graphics.layerAlphaOnly;
    if (graphics.hasAlpha) {
      material.transparencyMode = Material.MATERIAL_ALPHABLEND;
    }
  }

  return material;
}

function configureLayerTexture<T extends Texture>(
  texture: T,
  graphics: TileGraphics,
): T {
  texture.hasAlpha = graphics.hasAlpha;
  // Repeating rather than mirroring, which would alternate reflected copies.
  // Relies on matching opposite edges; see scripts/reconcile-texture-edges.ts.
  texture.wrapU = Texture.WRAP_ADDRESSMODE;
  texture.wrapV = Texture.WRAP_ADDRESSMODE;
  if (graphics.scale) {
    texture.uScale = graphics.scale.u;
    texture.vScale = graphics.scale.v;
  }
  return texture;
}
