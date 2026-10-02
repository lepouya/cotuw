import { Color4, Observable, Vector3 } from "@babylonjs/core";
import { TerrainGrid } from "./simulation/terrain";
import type { TerrainGridOptions, TerrainBounds } from "./simulation/terrain";
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
  createLayers?: (x: number, z: number) => TileLayer[];
};

/** Babylon presentation over renderer-independent simulation terrain. */
export class TerrainMap extends TerrainGrid {
  readonly layers: TileLayer[][];
  readonly onChangedObservable = new Observable<TerrainBounds>();
  constructor({ createLayers = () => [], ...options }: TerrainMapOptions) {
    super(options);
    this.layers = Array.from({ length: this.width * this.height }, (_, index) =>
      createLayers(index % this.width, Math.floor(index / this.width)),
    );
    this.onChanged((bounds) =>
      this.onChangedObservable.notifyObservers(bounds),
    );
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
