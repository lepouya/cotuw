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
  /** An image that repeats once per tile. */
  url: string;
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
