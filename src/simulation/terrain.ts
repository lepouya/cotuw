import { NavigationChangeLog } from "./navigation-changes";
import { containsGridPoint, unionBounds } from "./grid";

import type { NavigationChangeView } from "./navigation-changes";
import type { TerrainBounds, TileCoord } from "./grid";
import type { WorldBounds, WorldPosition } from "./world";
export type { TerrainBounds, TileCoord } from "./grid";

/** Absorbs floating-point error in positions derived from the map edge. */
const EDGE_TOLERANCE_TILES = 1e-9;
const NAVIGATION_CHANGE_HISTORY = 128;

export type TerrainChangeOptions = {
  /** False for changes that only affect presentation. */
  affectsNavigation?: boolean;
};

export type TerrainGridOptions = {
  width: number;
  height: number;
  tileSize: number;
  createHeight?: (x: number, z: number) => number;
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
  /** Explicitly prevents surface construction without changing traversal. */
  surfaceBuildable?: boolean;
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

/** Queries used by placement and navigation, without rendering or mutation. */
export type TerrainView = Pick<
  TerrainGrid,
  | "width"
  | "height"
  | "tileSize"
  | "worldBounds"
  | "terrainTypeIds"
  | "containsTile"
  | "containsCorner"
  | "tileIndex"
  | "heightAt"
  | "slopeAt"
  | "terrainAt"
  | "tileCenter"
  | "tileAtWorldPosition"
  | "worldPositionAt"
  | "tilesAroundCorner"
> & { readonly navigationChanges: NavigationChangeView };

/** The world area a rectangle of tiles covers. */
export function tileAreaBounds(
  map: Pick<TerrainView, "worldPositionAt">,
  area: TerrainBounds,
): WorldBounds {
  const low = map.worldPositionAt(area.minX, area.minZ);
  const high = map.worldPositionAt(area.maxX + 1, area.maxZ + 1);
  return { minX: low.x, minZ: low.z, maxX: high.x, maxZ: high.z };
}

/** A constraint every terrain edit must satisfy. */
export type TerrainEditRule = (edit: TerrainEdit) => boolean;

/** Mutable terrain: heights on the shared corner grid, layers on tiles. */
export class TerrainGrid {
  readonly width: number;
  readonly height: number;
  readonly tileSize: number;
  /** The map's horizontal extent, centered on the world origin. */
  readonly worldBounds: WorldBounds;
  private readonly cornerHeights: Float32Array;
  /** Every profile moving on this map must price each of these. */
  readonly terrainTypeIds: ReadonlySet<string>;
  private readonly listeners = new Set<(bounds: TerrainBounds) => void>();
  private readonly editRules = new Set<TerrainEditRule>();
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
    createTerrain = () => ({ typeId: "plain" }),
    terrainTypeIds,
  }: TerrainGridOptions) {
    if (
      !Number.isSafeInteger(width) ||
      width <= 0 ||
      !Number.isSafeInteger(height) ||
      height <= 0 ||
      !Number.isFinite(tileSize) ||
      tileSize <= 0 ||
      !Number.isFinite(width * tileSize) ||
      !Number.isFinite(height * tileSize)
    ) {
      throw new RangeError("Invalid terrain grid dimensions.");
    }
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
    this.cornerHeights = new Float32Array((width + 1) * (height + 1));
    this.terrain = Array.from({ length: width * height });

    for (let z = 0; z <= height; z += 1) {
      for (let x = 0; x <= width; x += 1) {
        this.writeHeight(x, z, createHeight(x, z));
      }
    }

    for (let z = 0; z < height; z += 1) {
      for (let x = 0; x < width; x += 1) {
        this.terrain[this.tileIndex(x, z)] = Object.freeze({
          ...createTerrain(x, z),
        });
      }
    }
    this.terrainTypeIds = new Set(
      terrainTypeIds ?? this.terrain.map(({ typeId }) => typeId),
    );
    for (const { typeId } of this.terrain) {
      this.ensureTerrainType(typeId);
    }
    if (!this.terrain.every((tile) => this.isValidTerrainTile(tile))) {
      throw new RangeError("Invalid terrain tile.");
    }
  }

  containsCorner(x: number, z: number): boolean {
    return containsGridPoint(x, z, this.width + 1, this.height + 1);
  }

  containsTile(x: number, z: number): boolean {
    return containsGridPoint(x, z, this.width, this.height);
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

  worldPositionAt(x: number, z: number): WorldPosition {
    return {
      x: x * this.tileSize + this.worldBounds.minX,
      z: z * this.tileSize + this.worldBounds.minZ,
    };
  }

  heightAt(x: number, z: number): number {
    return this.cornerHeights[this.cornerIndex(x, z)];
  }

  /** A copy of corner heights; edits must use the validated mutation APIs. */
  get heights(): Float32Array {
    return this.cornerHeights.slice();
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

  /** Edits one corner and reports its affected tiles to navigation and views. */
  setHeight(x: number, z: number, height: number): void {
    this.editTerrain({ heights: [{ x, z, height }] });
  }

  private writeHeight(x: number, z: number, height: number): void {
    if (!isValidHeight(height)) throw new RangeError("Invalid terrain height.");
    this.cornerHeights[this.cornerIndex(x, z)] = height;
  }

  /** Read-only; `editTerrain` makes edits so navigation sees them. */
  terrainAt(x: number, z: number): Readonly<TerrainTile> {
    return this.terrain[this.tileIndex(x, z)];
  }

  /** Replaces a tile's simulation terrain and reports the navigation change. */
  setTerrain(x: number, z: number, terrain: TerrainTile): void {
    this.editTerrain({ tiles: [{ x, z, terrain }] });
  }

  /** Rejects later edits that fail `rule`; returns its removal. */
  addEditRule(rule: TerrainEditRule): () => void {
    this.editRules.add(rule);
    return () => {
      this.editRules.delete(rule);
    };
  }

  /** Whether `editTerrain` would accept this edit, which may be untrusted. */
  isValidTerrainEdit(edit: TerrainEdit): boolean {
    const { heights = [], tiles = [] } = edit;
    return (
      Array.isArray(heights) &&
      Array.isArray(tiles) &&
      heights.every(
        (change) =>
          change != null &&
          this.containsCorner(change.x, change.z) &&
          isValidHeight(change.height),
      ) &&
      tiles.every(
        (change) =>
          change != null &&
          this.containsTile(change.x, change.z) &&
          this.isValidTerrainTile(change.terrain),
      ) &&
      [...this.editRules].every((rule) => rule(edit))
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
      bounds = bounds ? unionBounds(bounds, changed) : changed;
    };
    for (const { x, z, height } of edit.heights ?? []) {
      this.writeHeight(x, z, height);
      include(this.tilesAroundCorner(x, z));
    }
    for (const { x, z, terrain } of edit.tiles ?? []) {
      this.terrain[this.tileIndex(x, z)] = Object.freeze({ ...terrain });
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
      heights: Array.from(this.cornerHeights),
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
      state.heights.length !== this.cornerHeights.length ||
      state.tiles.length !== this.terrain.length ||
      !state.heights.every(isValidHeight) ||
      !state.tiles.every((tile) => this.isValidTerrainTile(tile)) ||
      !Number.isSafeInteger(state.navigationVersion) ||
      state.navigationVersion < 0
    ) {
      throw new RangeError("Terrain state does not fit this map.");
    }
    this.cornerHeights.set(state.heights);
    state.tiles.forEach((tile, index) => {
      this.terrain[index] = Object.freeze({ ...tile });
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

  private isValidTerrainTile(tile: TerrainTile): boolean {
    return (
      tile !== null &&
      typeof tile === "object" &&
      this.terrainTypeIds.has(tile.typeId) &&
      [tile.surfacePassable, tile.surfaceBuildable, tile.outOfBounds].every(
        (flag) => flag === undefined || typeof flag === "boolean",
      )
    );
  }

  /** Returns the tile containing a world position, including the far edges. */
  tileAtWorldPosition(worldX: number, worldZ: number): TileCoord {
    const { tileX, tileZ } = this.gridPosition(worldX, worldZ);
    return { x: tileX, z: tileZ };
  }

  tileCenter(x: number, z: number): WorldPosition {
    this.tileIndex(x, z);
    const point = this.worldPositionAt(x + 0.5, z + 0.5);
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

  onChanged(listener: (bounds: TerrainBounds) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  notifyChange(
    bounds: TerrainBounds,
    { affectsNavigation = true }: TerrainChangeOptions = {},
  ): void {
    if (affectsNavigation) {
      this.navigationChanges.record(bounds);
    }
    for (const listener of this.listeners) listener({ ...bounds });
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

function isValidHeight(height: number): boolean {
  return typeof height === "number" && Number.isFinite(Math.fround(height));
}
