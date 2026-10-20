import { containsGridPoint, isTileCoord, tileBounds, tileKey } from "./grid";
import { isId, isOneOf } from "./validation";
import type { TerrainBounds, TileCoord } from "./grid";
import type { TerrainEdit, TerrainGrid } from "./terrain";

export const OCCUPANCY_LAYERS = ["surface", "air", "subterranean"] as const;

export type OccupancyLayer = (typeof OCCUPANCY_LAYERS)[number];

/** Data-driven tiles occupied relative to a placement origin. */
export type Footprint = {
  layer: OccupancyLayer;
  occupiedTiles: TileCoord[];
  blocksMovement: boolean;
};

/** Runtime placement of one tile-placed actor's footprint. */
export type FootprintPlacement = {
  ownerId: string;
  origin: TileCoord;
  footprint: Footprint;
};

/** Queries for occupancy consumers, which never place or remove. */
export type OccupancyView = Pick<
  OccupancyGrid,
  | "ownerAt"
  | "occupiedWithin"
  | "blocksMovementAt"
  | "placementByOwnerId"
  | "canPlace"
>;

type PreparedPlacement = {
  placement: FootprintPlacement;
  tiles: TileCoord[];
  bounds: TerrainBounds;
};

export function isOccupancyLayer(value: unknown): value is OccupancyLayer {
  return isOneOf(OCCUPANCY_LAYERS, value);
}

export function isValidFootprint(value: unknown): value is Footprint {
  if (typeof value !== "object" || value === null) return false;
  const footprint = value as Partial<Footprint>;
  return (
    isOccupancyLayer(footprint.layer) &&
    typeof footprint.blocksMovement === "boolean" &&
    Array.isArray(footprint.occupiedTiles) &&
    footprint.occupiedTiles.length > 0 &&
    Array.from(footprint.occupiedTiles).every(isTileCoord) &&
    new Set(footprint.occupiedTiles.map(tileKey)).size ===
      footprint.occupiedTiles.length
  );
}

/**
 * Deterministic actor occupancy, separate from terrain and movement
 * profiles. Each tile can have one owner per occupancy layer. Missions own
 * terrain-edit protection; constructing an index installs no terrain rules.
 */
export class OccupancyGrid {
  private readonly cells = new Map<OccupancyLayer, (string | undefined)[]>();
  private readonly placements = new Map<string, PreparedPlacement>();

  constructor(private readonly terrain: TerrainGrid) {
    for (const layer of OCCUPANCY_LAYERS) {
      this.cells.set(
        layer,
        Array.from({ length: terrain.width * terrain.height }),
      );
    }
  }

  isForTerrain(terrain: TerrainGrid): boolean {
    return this.terrain === terrain;
  }

  ownerAt(x: number, z: number, layer: OccupancyLayer): string | undefined {
    if (!this.containsTile(x, z)) {
      return undefined;
    }
    return this.cells.get(layer)![this.index(x, z)];
  }

  /** Whether any layer has an owner on a tile within `bounds`. */
  occupiedWithin(bounds: Readonly<TerrainBounds>): boolean {
    for (let z = bounds.minZ; z <= bounds.maxZ; z += 1) {
      for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
        if (
          OCCUPANCY_LAYERS.some(
            (layer) => this.ownerAt(x, z, layer) !== undefined,
          )
        ) {
          return true;
        }
      }
    }
    return false;
  }

  blocksMovementAt(x: number, z: number, layer: OccupancyLayer): boolean {
    const ownerId = this.ownerAt(x, z, layer);
    return (
      ownerId !== undefined &&
      this.placements.get(ownerId)!.placement.footprint.blocksMovement
    );
  }

  placementByOwnerId(ownerId: string): FootprintPlacement | undefined {
    const placement = this.placements.get(ownerId)?.placement;
    return placement && structuredClone(placement);
  }

  canPlace(placement: Readonly<FootprintPlacement>): boolean {
    return this.prepare(placement) !== undefined;
  }

  /** Returns false without changing any tile when the placement is invalid. */
  place(placement: Readonly<FootprintPlacement>): boolean {
    const prepared = this.prepare(placement);
    if (!prepared) {
      return false;
    }
    const { ownerId, footprint } = prepared.placement;
    const cells = this.cells.get(footprint.layer)!;
    for (const { x, z } of prepared.tiles) {
      cells[this.index(x, z)] = ownerId;
    }
    this.placements.set(ownerId, prepared);
    this.terrain.navigationChanges.record(prepared.bounds, {
      layers: [footprint.layer],
      effect: footprint.blocksMovement ? "increase" : "none",
    });
    return true;
  }

  remove(ownerId: string): boolean {
    const prepared = this.placements.get(ownerId);
    if (!prepared) {
      return false;
    }
    const { footprint } = prepared.placement;
    const cells = this.cells.get(footprint.layer)!;
    for (const { x, z } of prepared.tiles) {
      cells[this.index(x, z)] = undefined;
    }
    this.placements.delete(ownerId);
    this.terrain.navigationChanges.record(prepared.bounds, {
      layers: [footprint.layer],
      effect: footprint.blocksMovement ? "decrease" : "none",
    });
    return true;
  }

  clear(): void {
    for (const ownerId of this.placements.keys()) this.remove(ownerId);
  }

  private prepare(
    placement: Readonly<FootprintPlacement>,
  ): PreparedPlacement | undefined {
    if (typeof placement !== "object" || placement === null) return undefined;
    const { ownerId, origin, footprint } = placement;
    if (
      !isId(ownerId) ||
      !isTileCoord(origin) ||
      !isValidFootprint(footprint) ||
      this.placements.has(ownerId)
    ) {
      return undefined;
    }
    const tiles = footprint.occupiedTiles.map(({ x, z }) => ({
      x: origin.x + x,
      z: origin.z + z,
    }));
    const cells = this.cells.get(footprint.layer)!;
    if (
      tiles.some(
        ({ x, z }) =>
          !this.containsTile(x, z) || cells[this.index(x, z)] !== undefined,
      )
    ) {
      return undefined;
    }
    return {
      placement: structuredClone({ ownerId, origin, footprint }),
      tiles,
      bounds: tileBounds(tiles),
    };
  }

  /** Terrain constraint a mission registers for the index's lifetime. */
  allowsTerrainEdit({ heights = [], tiles = [] }: TerrainEdit): boolean {
    return !(
      heights.some(({ x, z }) =>
        this.occupiedWithin(this.terrain.tilesAroundCorner(x, z)),
      ) ||
      tiles.some(({ x, z }) =>
        this.occupiedWithin({ minX: x, minZ: z, maxX: x, maxZ: z }),
      )
    );
  }

  private containsTile(x: number, z: number): boolean {
    return containsGridPoint(x, z, this.terrain.width, this.terrain.height);
  }

  private index(x: number, z: number): number {
    return z * this.terrain.width + x;
  }
}
