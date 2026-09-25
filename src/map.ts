import { Color4, Observable, Vector3 } from "@babylonjs/core";

import type { WorldBounds } from "./simulation/world";

/** Absorbs floating-point error in positions derived from the map edge. */
const EDGE_TOLERANCE_TILES = 1e-9;

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

/** Mutable terrain: heights on the shared corner grid, layers on tiles. */
export class TerrainMap {
  readonly width: number;
  readonly height: number;
  readonly tileSize: number;
  /** The map's horizontal extent, centered on the world origin. */
  readonly worldBounds: WorldBounds;
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
    const halfWidth = (width * tileSize) / 2;
    const halfHeight = (height * tileSize) / 2;
    this.worldBounds = {
      minX: -halfWidth,
      maxX: halfWidth,
      minZ: -halfHeight,
      maxZ: halfHeight,
    };
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

  containsCorner(x: number, z: number): boolean {
    return x >= 0 && z >= 0 && x <= this.width && z <= this.height;
  }

  containsTile(x: number, z: number): boolean {
    return x >= 0 && z >= 0 && x < this.width && z < this.height;
  }

  cornerIndex(x: number, z: number): number {
    if (!this.containsCorner(x, z)) {
      throw new RangeError(
        `Corner (${x}, ${z}) is outside a ${this.width}x${this.height} map.`,
      );
    }

    return z * (this.width + 1) + x;
  }

  tileIndex(x: number, z: number): number {
    if (!this.containsTile(x, z)) {
      throw new RangeError(
        `Tile (${x}, ${z}) is outside a ${this.width}x${this.height} map.`,
      );
    }

    return z * this.width + x;
  }

  worldPoint(x: number, z: number, height: number): Vector3 {
    return new Vector3(
      x * this.tileSize + this.worldBounds.minX,
      height,
      z * this.tileSize + this.worldBounds.minZ,
    );
  }

  cornerPoint(x: number, z: number, heightOffset = 0): Vector3 {
    return this.worldPoint(x, z, this.heightAt(x, z) + heightOffset);
  }

  heightAt(x: number, z: number): number {
    return this.heights[this.cornerIndex(x, z)];
  }

  /** Returns the rendered height of the terrain mesh at continuous world X/Z. */
  heightAtWorldPosition(worldX: number, worldZ: number): number {
    const rawGridX = (worldX - this.worldBounds.minX) / this.tileSize;
    const rawGridZ = (worldZ - this.worldBounds.minZ) / this.tileSize;

    if (!Number.isFinite(worldX) || !Number.isFinite(worldZ)) {
      throw new RangeError(
        `World position (${worldX}, ${worldZ}) is not finite.`,
      );
    }
    if (
      rawGridX < -EDGE_TOLERANCE_TILES ||
      rawGridZ < -EDGE_TOLERANCE_TILES ||
      rawGridX > this.width + EDGE_TOLERANCE_TILES ||
      rawGridZ > this.height + EDGE_TOLERANCE_TILES
    ) {
      throw new RangeError(
        `World position (${worldX}, ${worldZ}) is outside a ` +
          `${this.width}x${this.height} map.`,
      );
    }

    const gridX = Math.min(Math.max(rawGridX, 0), this.width);
    const gridZ = Math.min(Math.max(rawGridZ, 0), this.height);
    // The far map edge belongs to its preceding tile, with a fraction of one.
    const tileX = Math.min(Math.floor(gridX), this.width - 1);
    const tileZ = Math.min(Math.floor(gridZ), this.height - 1);
    const x = gridX - tileX;
    const z = gridZ - tileZ;
    const topLeft = this.heightAt(tileX, tileZ);
    const bottomLeft = this.heightAt(tileX, tileZ + 1);
    const topRight = this.heightAt(tileX + 1, tileZ);
    const bottomRight = this.heightAt(tileX + 1, tileZ + 1);

    // Match the terrain mesh's two triangles: top-left/top-right/bottom-left,
    // then top-right/bottom-right/bottom-left.
    if (x + z <= 1) {
      return topLeft * (1 - x - z) + topRight * x + bottomLeft * z;
    }

    return (
      topRight * (1 - z) + bottomLeft * (1 - x) + bottomRight * (x + z - 1)
    );
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
      for (const [index, layer] of layers.entries()) {
        count = Math.max(count, layerSlot(layer, index) + 1);
      }
    }

    return count;
  }

  notifyChange(bounds: TerrainBounds): void {
    this.onChangedObservable.notifyObservers(bounds);
  }

  tilesAroundCorner(x: number, z: number): TerrainBounds {
    return {
      minX: Math.max(0, x - 1),
      minZ: Math.max(0, z - 1),
      maxX: Math.min(this.width - 1, x),
      maxZ: Math.min(this.height - 1, z),
    };
  }
}
