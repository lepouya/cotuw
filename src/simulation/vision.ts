import { occupiedTilesFor } from "./placement";
import { disconnectedBuildings } from "./support";
import { terrainSightlineClear } from "./terrain-sightline";
import { hasOwn, isPositive, isRecord } from "./validation";

import type { Actor, ActorDefinition, ActorRenderState } from "./actor";
import type { Detectable } from "./ownership";
import type { TileCoord } from "./grid";
import type { SupportView } from "./support";
import type { TerrainGrid } from "./terrain";
import { distance } from "./world";
import type { WorldPosition } from "./world";

/** Sightline heights above the ground, in world units. */
const EYE_HEIGHT = 1.5;
const TARGET_HEIGHT = 0.5;
/** Bounds memory as units visit new tiles; results never depend on it. */
const MAX_CACHED_VIEWPOINTS = 4096;

/** Serializable fog memory; current vision is derived from actors. */
export type FogState = {
  /**
   * Each owner's explored terrain: one `0` or `1` per tile, row by row from
   * the south-west corner. Owners without an entry have explored nothing.
   */
  explored: Record<string, string>;
};

/** Tiles a faction currently sees, without memory. */
export type VisionView = {
  /** Changes whenever visible tiles change. */
  readonly version: number;
  isVisible: (x: number, z: number) => boolean;
};

export type Vision = VisionView & {
  /** Replaces current vision; returns one `0` or `1` per tile. */
  update: (sources: readonly VisionSource[]) => Readonly<Uint8Array>;
  dispose: () => void;
};

export type FogView = VisionView & {
  /** Count of explored tiles, for exploration progress. */
  readonly exploredCount: number;
  isExplored: (x: number, z: number) => boolean;
};

export type Fog = FogView & {
  /** Replaces current vision and adds it to explored terrain. */
  update: (sources: readonly VisionSource[]) => void;
  /** The explored tiles in `FogState` form. */
  explored: () => string;
  dispose: () => void;
};

export type VisionSource = { origin: WorldPosition; radius: number };

export function validateVisionDefinition(definition: ActorDefinition) {
  const vision = definition.vision;
  if (vision && !isPositive(vision.radius))
    throw new RangeError(`Invalid vision definition: ${definition.id}.`);
}

export const createFogState = (): FogState => ({ explored: {} });

export function isValidFogState(
  state: unknown,
  map: TerrainGrid,
  ownerIds: ReadonlySet<string>,
): state is FogState {
  return (
    isRecord(state) &&
    isRecord(state.explored) &&
    Object.entries(state.explored).every(
      ([owner, tiles]) =>
        ownerIds.has(owner) &&
        typeof tiles === "string" &&
        tiles.length === map.width * map.height &&
        /^[01]*$/.test(tiles),
    )
  );
}

/**
 * Operational actors see from their position; mobile units from their tile
 * center so their vision only changes when they enter another tile.
 * Blueprints and disconnected buildings provide no vision.
 */
export function visionSources(
  actors: readonly ActorRenderState[],
  definitions: ReadonlyMap<string, ActorDefinition>,
  support: SupportView | undefined,
  map: TerrainGrid,
): VisionSource[] {
  const disconnected = disconnectedBuildings(support);
  return actors.flatMap((actor) => {
    const vision = definitions.get(actor.definitionId)?.vision;
    if (!vision || actor.construction || disconnected.has(actor.id)) return [];
    return [{ origin: visionOrigin(actor, map), radius: vision.radius }];
  });
}

function visionOrigin(
  actor: Pick<ActorRenderState, "worldPosition" | "tilePlacement">,
  map: TerrainGrid,
): WorldPosition {
  const { x, z } = actor.worldPosition;
  if (actor.tilePlacement) return { x, z };
  const tile = map.tileAtWorldPosition(x, z);
  return map.tileCenter(tile.x, tile.z);
}

function eye(map: TerrainGrid, origin: WorldPosition) {
  return {
    ...origin,
    height: map.heightAtWorldPosition(origin.x, origin.z) + EYE_HEIGHT,
  };
}

/** Whether the tile's center is within `radius` and its sightline is clear. */
function seesTile(
  map: TerrainGrid,
  observer: ReturnType<typeof eye>,
  radius: number,
  x: number,
  z: number,
): boolean {
  const target = map.tileCenter(x, z);
  return (
    distance(target, observer) <= radius &&
    terrainSightlineClear(map, observer, {
      ...target,
      height: map.heightAtWorldPosition(target.x, target.z) + TARGET_HEIGHT,
    })
  );
}

export function createVision(map: TerrainGrid): Vision {
  let visible = new Uint8Array(map.width * map.height);
  let version = 0;
  const viewpoints = new Map<string, readonly number[]>();
  const releaseTerrain = map.onChanged(() => viewpoints.clear());
  const tilesSeenFrom = ({ origin, radius }: VisionSource) => {
    const key = `${origin.x},${origin.z},${radius}`;
    let tiles = viewpoints.get(key);
    if (!tiles) {
      if (viewpoints.size >= MAX_CACHED_VIEWPOINTS) viewpoints.clear();
      tiles = visibleTiles(map, origin, radius);
      viewpoints.set(key, tiles);
    }
    return tiles;
  };
  return {
    get version() {
      return version;
    },
    isVisible: (x, z) =>
      map.containsTile(x, z) && visible[z * map.width + x] === 1,
    update: (sources) => {
      const next = new Uint8Array(visible.length);
      for (const source of sources)
        for (const tile of tilesSeenFrom(source)) next[tile] = 1;
      if (next.some((bit, tile) => bit !== visible[tile])) version += 1;
      visible = next;
      return visible;
    },
    dispose: releaseTerrain,
  };
}

/** Current vision plus the terrain it has ever revealed. */
export function createFog(map: TerrainGrid, tiles: string): Fog {
  const explored = Uint8Array.from(tiles, (bit) => Number(bit));
  let exploredCount = explored.reduce((sum, bit) => sum + bit, 0);
  const vision = createVision(map);
  return {
    // New explored tiles are always newly visible, so vision's version covers
    // both.
    get version() {
      return vision.version;
    },
    get exploredCount() {
      return exploredCount;
    },
    isExplored: (x, z) =>
      map.containsTile(x, z) && explored[z * map.width + x] === 1,
    isVisible: vision.isVisible,
    update: (sources) => {
      const visible = vision.update(sources);
      for (let tile = 0; tile < visible.length; tile += 1) {
        if (visible[tile] && !explored[tile]) {
          explored[tile] = 1;
          exploredCount += 1;
        }
      }
    },
    explored: () => explored.join(""),
    dispose: vision.dispose,
  };
}

/**
 * Each owner's current vision under fog of war, shared between allies, and
 * the terrain it has explored. Without fog, every owner sees everything.
 */
export function createOwnerVision({
  map,
  fog,
  ownerIds,
  definitions,
}: {
  map: TerrainGrid | undefined;
  fog: FogState | undefined;
  ownerIds: ReadonlySet<string>;
  definitions: ReadonlyMap<string, ActorDefinition>;
}) {
  // Saved fog requires a map, which mission loading checks.
  const visions = new Map(
    fog
      ? [...ownerIds].map((owner) => [
          owner,
          createFog(
            map!,
            hasOwn(fog.explored, owner)
              ? fog.explored[owner]!
              : "0".repeat(map!.width * map!.height),
          ),
        ])
      : [],
  );
  const seesTile = (owner: string, { x, z }: TileCoord) =>
    !fog || !!visions.get(owner)?.isVisible(x, z);
  const sees = (owner: string, point: WorldPosition) =>
    !fog || seesTile(owner, map!.tileAtWorldPosition(point.x, point.z));
  return {
    sees,
    seesTile,
    /** An owner's explored terrain; absent without fog. */
    fogOf: (owner: string): FogView | undefined => visions.get(owner),
    /** Explored terrain retained after its vision, or an alliance, ends. */
    knowsTile: (owner: string, { x, z }: TileCoord) =>
      !fog || !!visions.get(owner)?.isExplored(x, z),
    state: (): FogState | undefined =>
      fog && {
        explored: Object.fromEntries(
          [...visions].map(([owner, vision]) => [owner, vision.explored()]),
        ),
      },
    /** Whether an owner sees the unit's tile or any of a building's tiles. */
    detects: (owner: string, actor: Detectable) => {
      if (!fog) return true;
      const vision = visions.get(owner);
      const definition = definitions.get(actor.definitionId);
      if (!vision || !actor.tilePlacement || !definition?.footprint)
        return !!vision && sees(owner, actor.worldPosition);
      return occupiedTilesFor(
        {
          id: actor.id ?? "",
          definitionId: actor.definitionId,
          tilePlacement: actor.tilePlacement,
        },
        definition,
      ).some(({ x, z }) => vision.isVisible(x, z));
    },
    /** Replaces current vision from each owner's and its allies' actors. */
    update: (
      actors: readonly ActorRenderState[],
      support: SupportView | undefined,
      sharesVision: (left: string, right: string) => boolean,
    ) => {
      if (!fog) return;
      const byOwner = new Map<string, ActorRenderState[]>();
      for (const actor of actors) {
        const owned = byOwner.get(actor.owner);
        if (owned) owned.push(actor);
        else byOwner.set(actor.owner, [actor]);
      }
      const sources = new Map(
        [...byOwner].map(([owner, owned]) => [
          owner,
          visionSources(owned, definitions, support, map!),
        ]),
      );
      for (const [viewer, vision] of visions)
        vision.update(
          [...sources].flatMap(([owner, list]) =>
            sharesVision(owner, viewer) ? list : [],
          ),
        );
    },
    dispose: () => {
      for (const vision of visions.values()) vision.dispose();
    },
  };
}

/**
 * Tiles whose centers lie within `radius` and whose sightline from the
 * observer's eye stays above the terrain heightfield.
 */
export function visibleTiles(
  map: TerrainGrid,
  origin: WorldPosition,
  radius: number,
): number[] {
  const observer = eye(map, origin);
  const center = map.tileAtWorldPosition(origin.x, origin.z);
  const reach = Math.ceil(radius / map.tileSize);
  const minX = Math.max(0, center.x - reach);
  const maxX = Math.min(map.width - 1, center.x + reach);
  const minZ = Math.max(0, center.z - reach);
  const maxZ = Math.min(map.height - 1, center.z + reach);
  const tiles: number[] = [];
  for (let z = minZ; z <= maxZ; z += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      if (seesTile(map, observer, radius, x, z)) tiles.push(z * map.width + x);
    }
  }
  return tiles;
}

/** Personal perception uses the same viewpoints and terrain rays as fog. */
export function personallyDetects(
  actor: Actor,
  target: Actor,
  definitions: ReadonlyMap<string, ActorDefinition>,
  map?: TerrainGrid,
): boolean {
  const radius = definitions.get(actor.definitionId)?.vision?.radius ?? 0;
  if (!map)
    return distance(actor.worldPosition, target.worldPosition) <= radius;
  const observer = eye(map, visionOrigin(actor, map));
  const definition = definitions.get(target.definitionId)!;
  const tiles =
    target.tilePlacement && definition.footprint
      ? occupiedTilesFor(
          { ...target, tilePlacement: target.tilePlacement },
          definition,
        )
      : [
          map.tileAtWorldPosition(
            target.worldPosition.x,
            target.worldPosition.z,
          ),
        ];
  return tiles.some(({ x, z }) => seesTile(map, observer, radius, x, z));
}
