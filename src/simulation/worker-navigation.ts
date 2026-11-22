import { destinationRegion, nearestGoalTile, segmentCost } from "./navigation";
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
import type { NavigationGrid } from "./navigation";
import type { WorldPosition } from "./world";

/** The target of an unblocked route the actor is following. */
export const routeTarget = (actor: Actor) =>
  actor.movement && !actor.movement.blocked ? actor.movement.target : undefined;

type WorkerWorld = Pick<EconomyWorld, "definitions" | "behaviors" | "map">;

function workerGrid(world: WorkerWorld, actor: Actor) {
  const definition = world.definitions.get(actor.definitionId)!;
  return world.behaviors
    .get(definition.behaviorId)
    ?.navigationGrid?.(actor, definition);
}

function reaches(grid: NavigationGrid, actor: Actor, point: WorldPosition) {
  return !!destinationRegion(grid, actor.worldPosition, point)?.reachedTarget;
}

/**
 * Keeps a matching route, retries blocked routes, and stops on arrival:
 * within `arrivalDistance` with a passable straight line to the target.
 */
export function advanceWorkerRoute(
  actor: Actor,
  target: WorldPosition,
  world: WorkerWorld & Pick<EconomyWorld, "move">,
  arrivalDistance: number,
): "arrived" | "travelling" | "blocked" {
  const grid = workerGrid(world, actor);
  if (
    grid &&
    distance(actor.worldPosition, target) <= arrivalDistance &&
    segmentCost(grid, actor.worldPosition, target) !== undefined
  ) {
    delete actor.movement;
    return "arrived";
  }
  const current = routeTarget(actor);
  if (current && distance(current, target) < 1e-6) return "travelling";
  delete actor.movement;
  if (!grid || !reaches(grid, actor, target) || !world.move(actor, target))
    return "blocked";
  return "travelling";
}

/** Worker routes use the same navigation rules as explicit movement. */
export function workerNavigation(world: WorkerWorld) {
  const reachable = (actor: Actor, point: WorldPosition) => {
    const grid = workerGrid(world, actor);
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
    preview = grid.withOccupancy({
      ownerAt: (...args) => occupancy.ownerAt(...args),
      occupiedWithin: (...args) => occupancy.occupiedWithin(...args),
      placementByOwnerId: (...args) => occupancy.placementByOwnerId(...args),
      canPlace: (...args) => occupancy.canPlace(...args),
      blocksMovementAt: (x, z, layer) =>
        (layer === building.occupancyLayer && blocked.has(tileKey({ x, z }))) ||
        occupancy.blocksMovementAt(x, z, layer),
    });
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
    const base = workerGrid(world, actor);
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
  /** The building with the shortest walk to an entrance; ties go to the earlier one. */
  const nearestEntrance = (actor: Actor, buildings: readonly Actor[]) => {
    const grid = workerGrid(world, actor);
    if (!grid) return undefined;
    const goals = buildings
      .filter(isTilePlacedActor)
      .flatMap((building) =>
        adjacentTiles(
          world.map,
          occupiedTilesFor(
            building,
            world.definitions.get(building.definitionId)!,
          ),
        ).map((tile) => ({ building, tile })),
      );
    const index = nearestGoalTile(
      grid,
      actor.worldPosition,
      goals.map(({ tile }) => tile),
    );
    if (index === undefined) return undefined;
    const { building, tile } = goals[index]!;
    return { id: building.id, point: world.map.tileCenter(tile.x, tile.z) };
  };
  return { reachable, entrance, nearestEntrance };
}
