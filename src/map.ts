import { Color4, Observable, Vector3 } from "@babylonjs/core";

import { NavigationChangeLog } from "./simulation/navigation-changes";

import type { WorldBounds, WorldPosition } from "./simulation/world";

/** Absorbs floating-point error in positions derived from the map edge. */
const EDGE_TOLERANCE_TILES = 1e-9;
const NAVIGATION_CHANGE_HISTORY = 128;

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

/** Integer tile coordinates on a map's tile grid. */
export type TileCoord = { x: number; z: number };

export type TerrainChangeOptions = {
  /** False for changes that only affect presentation. */
  affectsNavigation?: boolean;
};

export type TerrainMapOptions = {
  width: number;
  height: number;
  tileSize: number;
  createHeight?: (x: number, z: number) => number;
  createLayers?: (x: number, z: number) => TileLayer[];
  createTerrain?: (x: number, z: number) => TerrainTile;
  /** Terrain types tiles may use; defaults to those `createTerrain` places. */
  terrainTypeIds?: readonly string[];
};

/** Simulation-facing terrain authored for one tile. */
export type TerrainTile = {
  /** Resolves movement cost and default passability through a profile. */
  typeId: string;
  /** Overrides the profile and slope when explicitly set. */
  surfacePassable?: boolean;
  /** Blocks every movement profile and defines the playable map shape. */
  outOfBounds?: boolean;
};

/** Simulation terrain changes that apply together or not at all. */
export type TerrainEdit = {
  heights?: readonly { x: number; z: number; height: number }[];
  tiles?: readonly { x: number; z: number; terrain: TerrainTile }[];
};

/**
 * The mutable simulation terrain a mission save carries. Scenario content
 * supplies the map's size, visual layers, and declared terrain types.
 */
export type TerrainState = {
  width: number;
  height: number;
  /** Corner heights, row by row. */
  heights: number[];
  /** Tile terrain, row by row. */
  tiles: TerrainTile[];
  /** Restores the version that saved routes were planned against. */
  navigationVersion: number;
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
  /** Every profile moving on this map must price each of these. */
  readonly terrainTypeIds: ReadonlySet<string>;
  readonly onChangedObservable = new Observable<TerrainBounds>();
  /** Records terrain changes that may affect an active route. */
  readonly navigationChanges = new NavigationChangeLog(
    NAVIGATION_CHANGE_HISTORY,
  );
  private readonly terrain: Readonly<TerrainTile>[];

  constructor({
    width,
    height,
    tileSize,
    createHeight = () => 0,
    createLayers = () => [],
    createTerrain = () => ({ typeId: "plain" }),
    terrainTypeIds,
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
    this.terrain = Array.from({ length: width * height });

    for (let z = 0; z <= height; z += 1) {
      for (let x = 0; x <= width; x += 1) {
        this.heights[this.cornerIndex(x, z)] = createHeight(x, z);
      }
    }

    for (let z = 0; z < height; z += 1) {
      for (let x = 0; x < width; x += 1) {
        this.layers[this.tileIndex(x, z)] = createLayers(x, z);
        this.terrain[this.tileIndex(x, z)] = { ...createTerrain(x, z) };
      }
    }
    this.terrainTypeIds = new Set(
      terrainTypeIds ?? this.terrain.map(({ typeId }) => typeId),
    );
    for (const { typeId } of this.terrain) {
      this.ensureTerrainType(typeId);
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

  /** Returns terrain mesh height at a continuous world X/Z position. */
  heightAtWorldPosition(worldX: number, worldZ: number): number {
    const { gridX, gridZ, tileX, tileZ } = this.gridPosition(worldX, worldZ);
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

  /** Validates a world position and locates it on the tile grid. */
  private gridPosition(
    worldX: number,
    worldZ: number,
  ): { gridX: number; gridZ: number; tileX: number; tileZ: number } {
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
    return {
      gridX,
      gridZ,
      tileX: Math.min(Math.floor(gridX), this.width - 1),
      tileZ: Math.min(Math.floor(gridZ), this.height - 1),
    };
  }

  setHeight(x: number, z: number, height: number): void {
    this.heights[this.cornerIndex(x, z)] = height;
  }

  layersAt(x: number, z: number): TileLayer[] {
    return this.layers[this.tileIndex(x, z)];
  }

  /** Read-only; `editTerrain` makes edits so navigation sees them. */
  terrainAt(x: number, z: number): Readonly<TerrainTile> {
    return this.terrain[this.tileIndex(x, z)];
  }

  /** Replaces a tile's simulation terrain and reports the navigation change. */
  setTerrain(x: number, z: number, terrain: TerrainTile): void {
    this.editTerrain({ tiles: [{ x, z, terrain }] });
  }

  /** Whether `editTerrain` would accept this edit. */
  isValidTerrainEdit({ heights = [], tiles = [] }: TerrainEdit): boolean {
    return (
      heights.every(({ x, z }) => this.containsCorner(x, z)) &&
      tiles.every(
        ({ x, z, terrain }) =>
          this.containsTile(x, z) && this.terrainTypeIds.has(terrain.typeId),
      )
    );
  }

  /** Applies every change, then reports their combined bounds once. */
  editTerrain(edit: TerrainEdit): void {
    for (const { terrain } of edit.tiles ?? []) {
      this.ensureTerrainType(terrain.typeId);
    }
    if (!this.isValidTerrainEdit(edit)) {
      throw new RangeError("Invalid terrain edit.");
    }
    let bounds: TerrainBounds | undefined;
    const include = (changed: TerrainBounds) => {
      bounds = bounds
        ? {
            minX: Math.min(bounds.minX, changed.minX),
            minZ: Math.min(bounds.minZ, changed.minZ),
            maxX: Math.max(bounds.maxX, changed.maxX),
            maxZ: Math.max(bounds.maxZ, changed.maxZ),
          }
        : changed;
    };
    for (const { x, z, height } of edit.heights ?? []) {
      this.setHeight(x, z, height);
      include(this.tilesAroundCorner(x, z));
    }
    for (const { x, z, terrain } of edit.tiles ?? []) {
      this.terrain[this.tileIndex(x, z)] = { ...terrain };
      include({ minX: x, minZ: z, maxX: x, maxZ: z });
    }
    if (bounds) {
      this.notifyChange(bounds);
    }
  }

  terrainState(): TerrainState {
    return {
      width: this.width,
      height: this.height,
      heights: Array.from(this.heights),
      tiles: this.terrain.map((tile) => ({ ...tile })),
      navigationVersion: this.navigationChanges.version,
    };
  }

  /**
   * Replaces all simulation terrain and resumes navigation at the saved
   * version, so routes planned against it stay current.
   */
  restoreTerrainState(state: TerrainState): void {
    if (
      state.width !== this.width ||
      state.height !== this.height ||
      state.heights.length !== this.heights.length ||
      state.tiles.length !== this.terrain.length ||
      !state.tiles.every(({ typeId }) => this.terrainTypeIds.has(typeId))
    ) {
      throw new RangeError("Terrain state does not fit this map.");
    }
    this.heights.set(state.heights);
    state.tiles.forEach((tile, index) => {
      this.terrain[index] = { ...tile };
    });
    this.navigationChanges.restart(state.navigationVersion);
    this.notifyChange(
      { minX: 0, minZ: 0, maxX: this.width - 1, maxZ: this.height - 1 },
      { affectsNavigation: false },
    );
  }

  private ensureTerrainType(typeId: string): void {
    if (!this.terrainTypeIds.has(typeId)) {
      throw new RangeError(
        `Terrain type ${typeId} is not declared by the map.`,
      );
    }
  }

  /** Returns the tile containing a world position, including the far edges. */
  tileAtWorldPosition(worldX: number, worldZ: number): TileCoord {
    const { tileX, tileZ } = this.gridPosition(worldX, worldZ);
    return { x: tileX, z: tileZ };
  }

  tileCenter(x: number, z: number): WorldPosition {
    this.tileIndex(x, z);
    const point = this.worldPoint(x + 0.5, z + 0.5, 0);
    return { x: point.x, z: point.z };
  }

  /** Maximum grade of either rendered triangle within a tile. */
  slopeAt(x: number, z: number): number {
    this.tileIndex(x, z);
    const topLeft = this.heightAt(x, z);
    const topRight = this.heightAt(x + 1, z);
    const bottomLeft = this.heightAt(x, z + 1);
    const bottomRight = this.heightAt(x + 1, z + 1);
    const first = Math.hypot(topRight - topLeft, bottomLeft - topLeft);
    const second = Math.hypot(bottomRight - bottomLeft, bottomRight - topRight);
    return Math.max(first, second) / this.tileSize;
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

  notifyChange(
    bounds: TerrainBounds,
    { affectsNavigation = true }: TerrainChangeOptions = {},
  ): void {
    if (affectsNavigation) {
      this.navigationChanges.record(bounds);
    }
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
