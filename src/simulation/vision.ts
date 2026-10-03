import { occupiedTilesFor } from "./placement";
import { disconnectedBuildings } from "./support";
import { terrainSightlineClear } from "./terrain-sightline";

import type { Actor, ActorDefinition, ActorRenderState } from "./actor";
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
  /** One `0` or `1` per tile, row by row from the south-west corner. */
  explored: string;
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
  state: () => FogState;
  dispose: () => void;
};

export type VisionSource = { origin: WorldPosition; radius: number };

export function validateVisionDefinition(definition: ActorDefinition) {
  const vision = definition.vision;
  if (vision && !(Number.isFinite(vision.radius) && vision.radius > 0))
    throw new RangeError(`Invalid vision definition: ${definition.id}.`);
}

export function createFogState(width: number, height: number): FogState {
  return { explored: "0".repeat(width * height) };
}

export function isValidFogState(state: unknown, map: TerrainGrid): boolean {
  const explored = (state as Partial<FogState> | null)?.explored;
  return (
    typeof explored === "string" &&
    explored.length === map.width * map.height &&
    /^[01]*$/.test(explored)
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
export function createFog(map: TerrainGrid, state: FogState): Fog {
  const explored = Uint8Array.from(state.explored, (bit) => Number(bit));
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
    state: () => ({ explored: explored.join("") }),
    dispose: vision.dispose,
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
  const tiles: number[] = [];
  for (let z = center.z - reach; z <= center.z + reach; z += 1) {
    for (let x = center.x - reach; x <= center.x + reach; x += 1) {
      if (map.containsTile(x, z) && seesTile(map, observer, radius, x, z))
        tiles.push(z * map.width + x);
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
