import { NavigationGrid, resolveNavigationDestination } from "./navigation";
import {
  adjacentTiles,
  occupiedTilesFor,
  isTilePlacedActor,
} from "./placement";
import { distance } from "./world";
import { tileKey } from "./grid";
import type { Actor } from "./actor";
import type { EconomyWorld } from "./economy";
import type { TileCoord } from "./grid";
import type { WorldPosition } from "./world";

/** The target of an unblocked route the actor is following. */
export const routeTarget = (actor: Actor) =>
  actor.movement && !actor.movement.blocked ? actor.movement.target : undefined;

/** Keeps a matching route, retries blocked routes, and stops on arrival. */
export function advanceWorkerRoute(
  actor: Actor,
  target: WorldPosition,
  world: Pick<EconomyWorld, "definitions" | "behaviors" | "map" | "move">,
  arrivalDistance: number,
): "arrived" | "travelling" | "blocked" {
  if (distance(actor.worldPosition, target) <= arrivalDistance) {
    delete actor.movement;
    return "arrived";
  }
  const current = routeTarget(actor);
  if (current && distance(current, target) < 1e-6) return "travelling";
  delete actor.movement;
  if (
    !workerNavigation(world).reachable(actor, target) ||
    !world.move(actor, target)
  )
    return "blocked";
  return "travelling";
}

/** Worker routes use the same navigation rules as explicit movement. */
export function workerNavigation(
  world: Pick<EconomyWorld, "definitions" | "behaviors" | "map">,
) {
  const gridFor = (actor: Actor) => {
    const definition = world.definitions.get(actor.definitionId)!;
    return world.behaviors
      .get(definition.behaviorId)
      ?.navigationGrid?.(actor, definition);
  };
  // Region lookups answer reachability without searching for a route.
  const reaches = (grid: NavigationGrid, actor: Actor, point: WorldPosition) =>
    !!resolveNavigationDestination(grid, actor.worldPosition, point)
      ?.reachedTarget;
  const reachable = (actor: Actor, point: WorldPosition) => {
    const grid = gridFor(actor);
    return !!grid && reaches(grid, actor, point);
  };
  const previews = new Map<string, NavigationGrid>();
  /** Blocks an unplaced building's footprint without mutating occupancy. */
  const previewGrid = (
    grid: NavigationGrid,
    building: Actor,
    footprint: readonly TileCoord[],
  ) => {
    const key = `${building.id}:${grid.occupancyLayer}:${grid.profile.id}`;
    let preview = previews.get(key);
    if (preview) return preview;
    const occupancy = grid.occupancy;
    const blocked = new Set(footprint.map(tileKey));
    preview = new NavigationGrid(
      grid.map,
      {
        ownerAt: (...args) => occupancy.ownerAt(...args),
        occupiedWithin: (...args) => occupancy.occupiedWithin(...args),
        placementByOwnerId: (...args) => occupancy.placementByOwnerId(...args),
        canPlace: (...args) => occupancy.canPlace(...args),
        blocksMovementAt: (x, z, layer) =>
          (layer === building.occupancyLayer &&
            blocked.has(tileKey({ x, z }))) ||
          occupancy.blocksMovementAt(x, z, layer),
      },
      grid.profile,
      grid.occupancyLayer,
    );
    previews.set(key, preview);
    return preview;
  };
  /** The nearest reachable tile beside a building's footprint. */
  const entrance = (actor: Actor, building: Actor) => {
    if (!isTilePlacedActor(building)) return undefined;
    const footprint = occupiedTilesFor(
      building,
      world.definitions.get(building.definitionId)!,
    );
    const base = gridFor(actor);
    if (!base) return undefined;
    const grid = base.occupancy.placementByOwnerId(building.id)
      ? base
      : previewGrid(base, building, footprint);
    return adjacentTiles(world.map, footprint)
      .map((tile) => ({ tile, point: world.map.tileCenter(tile.x, tile.z) }))
      .sort(
        (a, b) =>
          distance(actor.worldPosition, a.point) -
            distance(actor.worldPosition, b.point) ||
          a.tile.z - b.tile.z ||
          a.tile.x - b.tile.x,
      )
      .find(({ point }) => reaches(grid, actor, point))?.point;
  };
  return { reachable, entrance };
}
