import { isValidFootprint } from "./occupancy";
import { isTileCoord, tileBounds, tileKey } from "./grid";
import { withinBounds } from "./world";

import type { TerrainView, TileCoord } from "./terrain";
import type { Actor, ActorDefinition } from "./actor";
import type {
  FootprintPlacement,
  OccupancyLayer,
  OccupancyView,
} from "./occupancy";
import type { WorldPosition } from "./world";

export const PLACEMENT_REASONS = [
  "invalid-actor",
  "used-id",
  "unknown-definition",
  "not-placeable",
  "out-of-bounds",
  "unbuildable-terrain",
  "disallowed-terrain",
  "excessive-slope",
  "actor-conflict",
  "occupancy-conflict",
  "insufficient-materials",
  "resource-site",
] as const;

export type PlacementReason = (typeof PLACEMENT_REASONS)[number];

export type PlacementEvaluation =
  | {
      accepted: true;
      tiles: TileCoord[];
      footprint: FootprintPlacement;
      /** The actor state the placement implies. */
      actor: Actor;
    }
  | { accepted: false; reason: PlacementReason; tiles: TileCoord[] };

/** What deploys a tile-placed actor; its pose and layer follow from this. */
export type ActorPlacement = {
  actorId: string;
  definitionId: string;
  origin: TileCoord;
  /** Clockwise quarter turns around the origin; defaults to 0. */
  quarterTurns?: number;
};

type TilePlacement = NonNullable<Actor["tilePlacement"]>;

export type TilePlacedActor = Actor & { tilePlacement: TilePlacement };

export type TilePlacedActorState = Readonly<
  Pick<Actor, "id" | "definitionId"> & {
    construction?: Readonly<NonNullable<Actor["construction"]>>;
    tilePlacement: Readonly<TilePlacement>;
  }
>;

/** Creates serializable actor state for one definition-backed footprint. */
export function createTilePlacedActor(
  map: TerrainView,
  definition: Readonly<ActorDefinition>,
  { actorId, origin, quarterTurns = 0 }: Omit<ActorPlacement, "definitionId">,
): TilePlacedActor {
  const actor: TilePlacedActor = {
    id: actorId,
    definitionId: definition.id,
    worldPosition: { x: 0, z: 0 },
    facing: 0,
    occupancyLayer: definition.footprint!.layer,
    tilePlacement: { origin: { ...origin }, quarterTurns },
  };
  return Object.assign(actor, tilePlacedPose(map, actor, definition));
}

export function isTilePlacedActor<
  T extends { readonly tilePlacement?: unknown },
>(actor: T): actor is T & { readonly tilePlacement: Readonly<TilePlacement> } {
  return actor.tilePlacement !== undefined;
}

/** Whether an actor follows move orders rather than holding a footprint. */
export function isMobileActor(
  actor: { readonly tilePlacement?: unknown },
  definition: Readonly<ActorDefinition> | undefined,
): boolean {
  return !!definition?.movement && !isTilePlacedActor(actor);
}

export function validatePlacementDefinition(
  definition: Readonly<ActorDefinition>,
  map: TerrainView,
): void {
  if (
    (definition.footprint === undefined) !==
    (definition.placement === undefined)
  ) {
    throw new RangeError(
      `Actor definition ${definition.id} must define both footprint and placement.`,
    );
  }
  if (!definition.footprint || !definition.placement) {
    return;
  }
  // Tile-placed actors must not move off the footprint they occupy.
  if (definition.movement !== undefined) {
    throw new RangeError(
      `Actor definition ${definition.id} cannot both move and use a footprint.`,
    );
  }
  if (
    !isValidFootprint(definition.footprint) ||
    !Number.isFinite(definition.placement.maxSlope) ||
    definition.placement.maxSlope < 0 ||
    definition.placement.terrainTypeIds.length === 0 ||
    definition.placement.terrainTypeIds.some(
      (typeId) => !map.terrainTypeIds.has(typeId),
    )
  ) {
    throw new RangeError(
      `Invalid actor placement definition: ${definition.id}.`,
    );
  }
}

/** Whether untrusted placement data has an integer origin and rotation. */
export function isValidTilePlacement(placement: unknown): boolean {
  if (typeof placement !== "object" || placement === null) return false;
  const { origin, quarterTurns } = placement as Partial<TilePlacement>;
  return (
    isTileCoord(origin) &&
    Number.isInteger(quarterTurns) &&
    quarterTurns! >= 0 &&
    quarterTurns! < 4
  );
}

/**
 * Checks terrain, units, and occupancy under a tile-placed actor. Pass
 * `actors` to reject mobile actors standing on the footprint's layer.
 */
export function evaluateFootprint(
  map: TerrainView,
  occupancy: OccupancyView,
  actor: TilePlacedActor,
  definition: Readonly<ActorDefinition>,
  actors?: Iterable<Readonly<Actor>>,
): PlacementEvaluation {
  const { footprint: layout, placement: rules } = definition;
  const tiles = occupiedTilesFor(actor, definition);
  const reject = (reason: PlacementReason): PlacementEvaluation => ({
    accepted: false,
    reason,
    tiles,
  });
  const surface = layout!.layer === "surface";
  for (const { x, z } of tiles) {
    if (!map.containsTile(x, z) || map.terrainAt(x, z).outOfBounds === true) {
      return reject("out-of-bounds");
    }
    const terrain = map.terrainAt(x, z);
    if (surface && terrain.surfaceBuildable === false) {
      return reject("unbuildable-terrain");
    }
    if (!rules!.terrainTypeIds.includes(terrain.typeId)) {
      return reject("disallowed-terrain");
    }
    if (surface && map.slopeAt(x, z) > rules!.maxSlope) {
      return reject("excessive-slope");
    }
  }
  const unitTiles = mobileActorTiles(map, actors ?? [], layout!.layer);
  if (tiles.some((tile) => unitTiles.has(tileKey(tile)))) {
    return reject("actor-conflict");
  }
  const footprint = footprintPlacementFor(actor, definition);
  if (!occupancy.canPlace(footprint)) {
    return reject("occupancy-conflict");
  }
  return { accepted: true, tiles, footprint, actor };
}

/** Keys of tiles under mobile actors on a layer, ignoring actors off the map. */
export function mobileActorTiles(
  map: TerrainView,
  actors: Iterable<Readonly<Actor>>,
  layer: OccupancyLayer,
): Set<string> {
  const tiles = new Set<string>();
  for (const actor of actors) {
    const { worldPosition } = actor;
    if (
      !isTilePlacedActor(actor) &&
      actor.occupancyLayer === layer &&
      withinBounds(worldPosition, map.worldBounds)
    ) {
      tiles.add(
        tileKey(map.tileAtWorldPosition(worldPosition.x, worldPosition.z)),
      );
    }
  }
  return tiles;
}

export function footprintPlacementFor(
  { id, tilePlacement }: TilePlacedActorState,
  definition: Readonly<ActorDefinition>,
): FootprintPlacement {
  const footprint = definition.footprint!;
  return {
    ownerId: id,
    origin: { ...tilePlacement.origin },
    footprint: {
      ...footprint,
      occupiedTiles: footprint.occupiedTiles.map((offset) =>
        rotateOffset(offset, tilePlacement.quarterTurns),
      ),
    },
  };
}

export function occupiedTilesFor(
  actor: TilePlacedActorState,
  definition: Readonly<ActorDefinition>,
): TileCoord[] {
  const { origin, footprint } = footprintPlacementFor(actor, definition);
  return footprint.occupiedTiles.map(({ x, z }) => ({
    x: origin.x + x,
    z: origin.z + z,
  }));
}

/** The position and facing a tile placement implies. */
export function tilePlacedPose(
  map: TerrainView,
  actor: TilePlacedActorState,
  definition: Readonly<ActorDefinition>,
): { worldPosition: WorldPosition; facing: number } {
  const { minX, minZ, maxX, maxZ } = tileBounds(
    occupiedTilesFor(actor, definition),
  );
  return {
    worldPosition: {
      x: map.worldBounds.minX + ((minX + maxX) / 2 + 0.5) * map.tileSize,
      z: map.worldBounds.minZ + ((minZ + maxZ) / 2 + 0.5) * map.tileSize,
    },
    facing: actor.tilePlacement.quarterTurns * (Math.PI / 2),
  };
}

/** Turns clockwise like `facing`, so +Z becomes +X after one quarter turn. */
function rotateOffset({ x, z }: TileCoord, quarterTurns: number): TileCoord {
  switch (quarterTurns) {
    case 0:
      return { x, z };
    case 1:
      return { x: z, z: -x };
    case 2:
      return { x: -x, z: -z };
    case 3:
      return { x: -z, z: x };
    default:
      throw new RangeError(`Invalid footprint rotation: ${quarterTurns}.`);
  }
}
