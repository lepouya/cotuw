import { Color4, Observable, Vector3 } from "@babylonjs/core";
import { TerrainGrid } from "./simulation/terrain";
import type {
  TerrainGridOptions,
  TerrainBounds,
  TerrainTile,
  TerrainView,
} from "./simulation/terrain";
export type {
  TerrainBounds,
  TileCoord,
  TerrainChangeOptions,
  TerrainTile,
  TerrainEdit,
  TerrainState,
} from "./simulation/terrain";

/** How a tile type is drawn. */
export type TileGraphics = {
  /** An image that repeats once per tile, or a clip's sprite sheet. */
  url: string;
  /** Names a content-pack texture clip that plays cells of `url`. */
  clip?: string;
  /**
   * Seconds each tile's clip lags its neighbor toward negative x and z, so
   * motion rolls across the terrain instead of playing in unison.
   */
  clipPhase?: { u: number; v: number };
  hasAlpha: boolean;
  /** Ignores the image's alpha, so the layer color alone sets opacity. */
  layerAlphaOnly?: boolean;
  /** Image repeats per tile. */
  scale?: { u: number; v: number };
  /** Image repeats per second. */
  scrollSpeed?: { u: number; v: number };
  /** The image's mean color, with alpha as the share of a tile it covers. */
  minimapColor: readonly [number, number, number, number];
};

/** A kind of terrain layer, shared by every tile that carries it. */
export type TileType = {
  /** Layers whose types share an ID render and blend as one type. */
  id: string;
  /**
   * Fixed stack position, overriding the layer's array index. Optional types
   * need it so neighboring tiles keep the same height and blend order.
   */
  slot?: number;
  /** Fades alpha at corners shared with tiles that lack this type. */
  featherEdges?: boolean;
  /**
   * Fades alpha from full at grade `start` to none at grade `end`, as rise
   * over horizontal run. An `end` below `start` shows the layer on steep
   * ground only.
   */
  slopeFade?: { start: number; end: number };
  /** Absent for a plain surface drawn in the layer color alone. */
  graphics?: TileGraphics;
};

/** Visual coverage for one whole tile. Array order sets layer order. */
export type TileLayer = {
  /** Absent for a plain, unpinned, unfeathered layer. */
  type?: TileType;
  color: Color4;
};

export function layerSlot(layer: TileLayer, index: number): number {
  return layer.type?.slot ?? index;
}

/** The share of a layer's alpha its slope fade keeps at this grade. */
export function slopeCoverage(type: TileType | undefined, slope: number) {
  const fade = type?.slopeFade;
  if (!fade) return 1;
  const t = Math.max(
    0,
    Math.min(1, (slope - fade.start) / (fade.end - fade.start)),
  );
  return 1 - t * t * (3 - 2 * t);
}

/**
 * The layer's own alpha, or when it feathers, the average across the tiles
 * meeting at this corner, counting tiles without the layer as clear. Tiles off
 * the map are skipped so borders do not feather inward. Optional slope fading
 * multiplies coverage using the steepest tile meeting at the corner.
 */
export function cornerAlpha(
  map: TerrainMap,
  layer: TileLayer,
  cornerX: number,
  cornerZ: number,
): number {
  let coverage = 1;
  if (layer.type?.slopeFade) {
    // Shared corner coverage keeps adjacent tiles and chunks continuous.
    let slope = 0;
    for (let z = cornerZ - 1; z <= cornerZ; z++)
      for (let x = cornerX - 1; x <= cornerX; x++)
        if (map.containsTile(x, z)) slope = Math.max(slope, map.slopeAt(x, z));
    coverage = slopeCoverage(layer.type, slope);
  }
  if (!layer.type?.featherEdges) {
    return layer.color.a * coverage;
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

  return sampled > 0 ? (total / sampled) * coverage : 0;
}

export type TerrainMapOptions = TerrainGridOptions & {
  /** Receives each tile's simulation terrain, already validated. */
  createLayers?: (
    x: number,
    z: number,
    terrain: Readonly<TerrainTile>,
    map: TerrainView,
  ) => TileLayer[];
  /** Neighboring tiles whose layers can depend on a changed tile. */
  layerUpdateRadius?: number;
};

/**
 * Babylon presentation over renderer-independent simulation terrain. Terrain
 * semantics rebuild layers; height and visual edits preserve manual layers.
 */
export class TerrainMap extends TerrainGrid {
  readonly layers: TileLayer[][];
  readonly onChangedObservable = new Observable<TerrainBounds>();
  constructor({
    createLayers = () => [],
    layerUpdateRadius = 0,
    ...options
  }: TerrainMapOptions) {
    super(options);
    if (!Number.isSafeInteger(layerUpdateRadius) || layerUpdateRadius < 0)
      throw new RangeError("Invalid terrain layer update radius.");
    const layersAt = (x: number, z: number) =>
      createLayers(x, z, this.terrainAt(x, z), this);
    this.layers = Array.from({ length: this.width * this.height }, (_, index) =>
      layersAt(index % this.width, Math.floor(index / this.width)),
    );
    const knownTerrain = Array.from(
      { length: this.width * this.height },
      (_, index) =>
        this.terrainAt(index % this.width, Math.floor(index / this.width)),
    );
    this.onChanged((bounds) => {
      let terrainChanged = false;
      for (let z = bounds.minZ; z <= bounds.maxZ; z += 1)
        for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
          const index = this.tileIndex(x, z);
          const tile = this.terrainAt(x, z);
          if (knownTerrain[index] !== tile) terrainChanged = true;
          knownTerrain[index] = tile;
        }
      if (!terrainChanged) {
        this.onChangedObservable.notifyObservers(bounds);
        return;
      }
      const affected = {
        minX: Math.max(0, bounds.minX - layerUpdateRadius),
        minZ: Math.max(0, bounds.minZ - layerUpdateRadius),
        maxX: Math.min(this.width - 1, bounds.maxX + layerUpdateRadius),
        maxZ: Math.min(this.height - 1, bounds.maxZ + layerUpdateRadius),
      };
      for (let z = affected.minZ; z <= affected.maxZ; z += 1)
        for (let x = affected.minX; x <= affected.maxX; x += 1)
          this.layers[this.tileIndex(x, z)] = layersAt(x, z);
      this.onChangedObservable.notifyObservers(affected);
    });
  }
  worldPoint(x: number, z: number, height: number): Vector3 {
    const position = this.worldPositionAt(x, z);
    return new Vector3(position.x, height, position.z);
  }
  cornerPoint(x: number, z: number, heightOffset = 0): Vector3 {
    return this.worldPoint(x, z, this.heightAt(x, z) + heightOffset);
  }
  layersAt(x: number, z: number): TileLayer[] {
    return this.layers[this.tileIndex(x, z)];
  }
  get layerCount(): number {
    let count = 0;
    for (const layers of this.layers) {
      for (const [index, layer] of layers.entries()) {
        count = Math.max(count, layerSlot(layer, index) + 1);
      }
    }
    return count;
  }
}
