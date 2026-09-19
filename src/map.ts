export type TileCorners = {
  nw: number;
  ne: number;
  sw: number;
  se: number;
};

export type RGB = readonly [r: number, g: number, b: number];

export type TileLayer = Readonly<{
  texture?: string;
  tint: RGB;
  alpha: number;
}>;

/** A live, read-only view of a tile's current terrain data. */
export type TerrainTile = {
  readonly corners: Readonly<TileCorners>;
  readonly layers: readonly TileLayer[];
};

/** Inclusive tile coordinates affected by a terrain edit. */
export type TerrainBounds = Readonly<{
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}>;

export type TerrainChange = Readonly<{
  bounds: TerrainBounds;
  heightsChanged: boolean;
  layersChanged: boolean;
}>;

type PendingChange = {
  bounds: TerrainBounds;
  heightsChanged: boolean;
  layersChanged: boolean;
};

class TerrainTileView implements TerrainTile {
  constructor(
    private readonly map: TerrainMap,
    private readonly x: number,
    private readonly z: number,
  ) {}

  get corners(): Readonly<TileCorners> {
    return this.map.getTileCorners(this.x, this.z);
  }

  get layers(): readonly TileLayer[] {
    return this.map.getTileLayers(this.x, this.z);
  }
}

export class TerrainMap {
  /** A two-dimensional, live view of the map's tiles. */
  readonly tiles: readonly (readonly TerrainTile[])[];
  private readonly cornerHeights: number[][];
  private readonly layerStacks: TileLayer[][][];
  private readonly changeListeners = new Set<(change: TerrainChange) => void>();
  private editDepth = 0;
  private pendingChange: PendingChange | undefined;

  constructor(
    readonly width: number,
    readonly height: number,
    readonly tileSize: number,
    createHeight: (x: number, z: number) => number,
  ) {
    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width <= 0 ||
      height <= 0 ||
      !Number.isFinite(tileSize) ||
      tileSize <= 0
    ) {
      throw new RangeError(
        "Terrain width and height must be positive integers and tile size positive.",
      );
    }

    this.cornerHeights = Array.from({ length: height + 1 }, (_, z) =>
      Array.from({ length: width + 1 }, (_, x) => {
        const cornerHeight = createHeight(x, z);

        if (!Number.isFinite(cornerHeight)) {
          throw new RangeError("Terrain corner heights must be finite.");
        }

        return cornerHeight;
      }),
    );
    this.layerStacks = Array.from({ length: height }, () =>
      Array.from({ length: width }, () => []),
    );
    this.tiles = Array.from({ length: height }, (_, z) =>
      Array.from({ length: width }, (_, x) => new TerrainTileView(this, x, z)),
    );
  }

  /** The size of the deepest layer stack on any tile. */
  get layerCount(): number {
    let count = 0;

    for (const row of this.layerStacks) {
      for (const layers of row) {
        count = Math.max(count, layers.length);
      }
    }

    return count;
  }

  getTile(x: number, z: number): TerrainTile {
    this.assertTile(x, z);
    return this.tiles[z][x];
  }

  getTileCorners(x: number, z: number): Readonly<TileCorners> {
    this.assertTile(x, z);
    return {
      nw: this.cornerHeights[z][x],
      ne: this.cornerHeights[z][x + 1],
      sw: this.cornerHeights[z + 1][x],
      se: this.cornerHeights[z + 1][x + 1],
    };
  }

  getTileLayers(x: number, z: number): readonly TileLayer[] {
    this.assertTile(x, z);
    return this.layerStacks[z][x].map((layer) => this.copyLayer(layer));
  }

  getTileLayer(
    x: number,
    z: number,
    layerIndex: number,
  ): TileLayer | undefined {
    this.assertTile(x, z);

    if (!Number.isInteger(layerIndex) || layerIndex < 0) {
      throw new RangeError(
        "Terrain layer index must be a non-negative integer.",
      );
    }

    const layer = this.layerStacks[z][x][layerIndex];
    return layer && this.copyLayer(layer);
  }

  getCorner(x: number, z: number): number {
    this.assertCorner(x, z);
    return this.cornerHeights[z][x];
  }

  /**
   * Groups terrain mutations into one notification. Nested edits are also
   * coalesced, so a brush can make many changes without repeated redraws.
   */
  edit<Result>(operation: (terrain: TerrainMap) => Result): Result {
    this.editDepth += 1;

    try {
      return operation(this);
    } finally {
      this.editDepth -= 1;
      this.flushChanges();
    }
  }

  setCorner(x: number, z: number, height: number): void {
    this.assertCorner(x, z);

    if (!Number.isFinite(height)) {
      throw new RangeError("Terrain corner heights must be finite.");
    }

    if (this.cornerHeights[z][x] === height) {
      return;
    }

    this.cornerHeights[z][x] = height;
    this.recordChange(this.tilesAroundCorner(x, z), true, false);
  }

  addTileLayer(x: number, z: number, layer: TileLayer): void {
    this.assertTile(x, z);
    this.assertLayer(layer);
    this.layerStacks[z][x].push(this.copyLayer(layer));
    this.recordChange(this.singleTile(x, z), false, true);
  }

  setTileLayers(x: number, z: number, layers: readonly TileLayer[]): void {
    this.assertTile(x, z);
    layers.forEach((layer) => this.assertLayer(layer));
    this.layerStacks[z][x] = layers.map((layer) => this.copyLayer(layer));
    this.recordChange(this.singleTile(x, z), false, true);
  }

  setTileLayer(
    x: number,
    z: number,
    layerIndex: number,
    layer: TileLayer,
  ): void {
    this.assertTile(x, z);
    this.assertLayerIndex(x, z, layerIndex);
    this.assertLayer(layer);
    this.layerStacks[z][x][layerIndex] = this.copyLayer(layer);
    this.recordChange(this.singleTile(x, z), false, true);
  }

  removeTileLayer(x: number, z: number, layerIndex: number): TileLayer {
    this.assertTile(x, z);
    this.assertLayerIndex(x, z, layerIndex);
    const [removed] = this.layerStacks[z][x].splice(layerIndex, 1);
    this.recordChange(this.singleTile(x, z), false, true);
    return this.copyLayer(removed);
  }

  onChange(listener: (change: TerrainChange) => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  private assertTile(x: number, z: number): void {
    if (!this.isTileInBounds(x, z)) {
      throw new RangeError("Terrain tile is outside the map.");
    }
  }

  private assertCorner(x: number, z: number): void {
    if (
      !Number.isInteger(x) ||
      !Number.isInteger(z) ||
      x < 0 ||
      x > this.width ||
      z < 0 ||
      z > this.height
    ) {
      throw new RangeError("Terrain corner is outside the map.");
    }
  }

  private assertLayerIndex(x: number, z: number, layerIndex: number): void {
    if (
      !Number.isInteger(layerIndex) ||
      layerIndex < 0 ||
      layerIndex >= this.layerStacks[z][x].length
    ) {
      throw new RangeError("Terrain layer is outside the tile stack.");
    }
  }

  private assertLayer({ alpha, tint }: TileLayer): void {
    if (
      !Number.isFinite(alpha) ||
      alpha < 0 ||
      alpha > 1 ||
      tint.some(
        (component) =>
          !Number.isFinite(component) || component < 0 || component > 1,
      )
    ) {
      throw new RangeError(
        "Tile layers require RGB and alpha values from zero to one.",
      );
    }
  }

  private isTileInBounds(x: number, z: number): boolean {
    return (
      Number.isInteger(x) &&
      Number.isInteger(z) &&
      x >= 0 &&
      x < this.width &&
      z >= 0 &&
      z < this.height
    );
  }

  private singleTile(x: number, z: number): TerrainBounds {
    return { minX: x, minZ: z, maxX: x, maxZ: z };
  }

  private tilesAroundCorner(x: number, z: number): TerrainBounds {
    return {
      minX: Math.max(0, x - 1),
      minZ: Math.max(0, z - 1),
      maxX: Math.min(this.width - 1, x),
      maxZ: Math.min(this.height - 1, z),
    };
  }

  private copyLayer({ texture, tint, alpha }: TileLayer): TileLayer {
    return { texture, tint: [...tint] as RGB, alpha };
  }

  private recordChange(
    bounds: TerrainBounds,
    heightsChanged: boolean,
    layersChanged: boolean,
  ): void {
    if (this.pendingChange) {
      this.pendingChange.bounds = {
        minX: Math.min(this.pendingChange.bounds.minX, bounds.minX),
        minZ: Math.min(this.pendingChange.bounds.minZ, bounds.minZ),
        maxX: Math.max(this.pendingChange.bounds.maxX, bounds.maxX),
        maxZ: Math.max(this.pendingChange.bounds.maxZ, bounds.maxZ),
      };
      this.pendingChange.heightsChanged ||= heightsChanged;
      this.pendingChange.layersChanged ||= layersChanged;
    } else {
      this.pendingChange = { bounds, heightsChanged, layersChanged };
    }

    this.flushChanges();
  }

  private flushChanges(): void {
    if (this.editDepth > 0 || !this.pendingChange) {
      return;
    }

    const change = this.pendingChange;
    this.pendingChange = undefined;
    for (const listener of this.changeListeners) {
      listener(change);
    }
  }
}
