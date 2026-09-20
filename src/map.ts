import { Color4, Observable, Vector3 } from "@babylonjs/core";

/** Visual coverage for one whole tile. Array order controls layer order. */
export type TileLayer = {
  texture?: string;
  color: Color4;
  /**
   * Fades the layer's alpha out at corners shared with tiles that do not carry
   * it, so its outline reads as a soft edge instead of a staircase of tiles.
   */
  featherEdges?: boolean;
};

/** Inclusive tile coordinates affected by terraforming. */
export type TerrainBounds = {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
};

export type TerrainMapOptions = {
  width: number;
  height: number;
  tileSize: number;
  createHeight?: (x: number, z: number) => number;
  createLayers?: (x: number, z: number) => TileLayer[];
};

/**
 * Mutable terrain state. Heights live on the shared corner grid while visual
 * layers live on tiles; neither storage model is hidden behind tile views.
 */
export class TerrainMap {
  readonly width: number;
  readonly height: number;
  readonly tileSize: number;
  readonly heights: Float32Array;
  readonly layers: TileLayer[][];
  readonly onChangedObservable = new Observable<TerrainBounds>();

  constructor({
    width,
    height,
    tileSize,
    createHeight = () => 0,
    createLayers = () => [],
  }: TerrainMapOptions) {
    this.width = width;
    this.height = height;
    this.tileSize = tileSize;
    this.heights = new Float32Array((width + 1) * (height + 1));
    this.layers = Array.from({ length: width * height });

    for (let z = 0; z <= height; z += 1) {
      for (let x = 0; x <= width; x += 1) {
        this.heights[this.cornerIndex(x, z)] = createHeight(x, z);
      }
    }

    for (let z = 0; z < height; z += 1) {
      for (let x = 0; x < width; x += 1) {
        this.layers[this.tileIndex(x, z)] = createLayers(x, z);
      }
    }
  }

  cornerIndex(x: number, z: number): number {
    return z * (this.width + 1) + x;
  }

  tileIndex(x: number, z: number): number {
    return z * this.width + x;
  }

  worldPoint(x: number, z: number, height: number): Vector3 {
    return new Vector3(
      x * this.tileSize - (this.width * this.tileSize) / 2,
      height,
      z * this.tileSize - (this.height * this.tileSize) / 2,
    );
  }

  cornerPoint(x: number, z: number, heightOffset = 0): Vector3 {
    return this.worldPoint(x, z, this.heightAt(x, z) + heightOffset);
  }

  heightAt(x: number, z: number): number {
    return this.heights[this.cornerIndex(x, z)];
  }

  setHeight(x: number, z: number, height: number): void {
    this.heights[this.cornerIndex(x, z)] = height;
  }

  layersAt(x: number, z: number): TileLayer[] {
    return this.layers[this.tileIndex(x, z)];
  }

  get layerCount(): number {
    let count = 0;

    for (const layers of this.layers) {
      count = Math.max(count, layers.length);
    }

    return count;
  }

  notifyChange(bounds: TerrainBounds): void {
    this.onChangedObservable.notifyObservers(bounds);
  }

  /** Tile bounds touched when a shared corner height changes. */
  tilesAroundCorner(x: number, z: number): TerrainBounds {
    return {
      minX: Math.max(0, x - 1),
      minZ: Math.max(0, z - 1),
      maxX: Math.min(this.width - 1, x),
      maxZ: Math.min(this.height - 1, z),
    };
  }
}
