import {
  findNavigationPath,
  forEachTileOnSegment,
  NavigationGrid,
  occupiedTile,
  segmentCost,
  traversalCostAt,
} from "./navigation";
import { isOccupancyLayer } from "./occupancy";
import { distance, isFinitePosition, withinBounds } from "./world";

import type { TerrainBounds, TerrainView } from "./terrain";
import type { OccupancyLayer, OccupancyView } from "./occupancy";
import type {
  Actor,
  ActorBehavior,
  ActorDefinition,
  MovementOrder,
  RouteBounds,
} from "./actor";
import type { MovementProfile, NavigationPath } from "./navigation";
import type { WorldPosition } from "./world";

const POSITION_EPSILON = 1e-9;

/** Creates deterministic continuous movement over weighted terrain routes. */
export function createTerrainMoveBehavior(
  map: TerrainView,
  occupancy: OccupancyView,
  profiles: readonly MovementProfile[],
): ActorBehavior {
  // Grids by profile ID, then by occupancy layer.
  const grids = new Map<string, Map<OccupancyLayer, NavigationGrid>>();
  for (const profile of profiles) {
    if (grids.has(profile.id)) {
      throw new RangeError(`Duplicate movement profile: ${profile.id}.`);
    }
    const stored = Object.freeze({
      ...profile,
      terrainCosts: Object.freeze({ ...profile.terrainCosts }),
    });
    // Constructing the surface grid validates the profile against the map.
    grids.set(
      profile.id,
      new Map([["surface", new NavigationGrid(map, occupancy, stored)]]),
    );
  }
  // Definitions are validated before any command or update reaches them.
  const gridFor = (
    actor: Readonly<Actor>,
    definition: ActorDefinition,
  ): NavigationGrid => {
    const byLayer = grids.get(definition.movement!.profileId!)!;
    const layer = actor.occupancyLayer;
    let grid = byLayer.get(layer);
    if (!grid) {
      const { profile } = byLayer.get("surface")!;
      grid = new NavigationGrid(map, occupancy, profile, layer);
      byLayer.set(layer, grid);
    }
    return grid;
  };
  const changes = map.navigationChanges;

  const replan = (actor: Actor, order: MovementOrder, grid: NavigationGrid) => {
    order.occupancyLayer = grid.occupancyLayer;
    const path = findNavigationPath(grid, actor.worldPosition, order.target);
    // An order may end on the actor's own tile only if that was already its
    // destination.
    const keepsDestination =
      !order.blocked &&
      order.destination !== undefined &&
      path !== undefined &&
      sameTile(map, order.destination, path.destination);
    if (
      !path ||
      !withinRouteBounds(order.bounds, [
        actor.worldPosition,
        ...path.waypoints,
      ]) ||
      (!keepsDestination && !getsCloser(grid, actor.worldPosition, path))
    ) {
      markBlocked(order, actor.worldPosition, changes.version);
      return;
    }
    Object.assign(order, path, {
      waypointIndex: 0,
      navigationVersion: changes.version,
    });
    delete order.blocked;
  };

  return {
    navigationGrid: gridFor,
    canStandAt: (definition, { x, z }) => {
      const { profile } = grids
        .get(definition.movement!.profileId!)!
        .get("surface")!;
      return traversalCostAt(map, profile, x, z) !== undefined;
    },
    validateDefinition: (definition) => {
      const movement = definition.movement;
      if (!movement || !(movement.speed > 0)) {
        throw new RangeError(
          `Actor definition ${definition.id} needs a positive movement speed.`,
        );
      }
      if (!movement.profileId || !grids.has(movement.profileId)) {
        throw new RangeError(
          `Actor definition ${definition.id} uses unknown movement profile ` +
            `${movement.profileId}.`,
        );
      }
    },
    validateActor: (actor) => {
      const order = actor.movement;
      if (!order) {
        return;
      }
      const onMap = (point: WorldPosition) =>
        isFinitePosition(point) && withinBounds(point, map.worldBounds);
      const waypoints = order.waypoints ?? [];
      if (
        !waypoints.every(onMap) ||
        (order.destination !== undefined && !onMap(order.destination)) ||
        (order.requestedTarget !== undefined && !onMap(order.requestedTarget))
      ) {
        throw new RangeError(`Actor ${actor.id} has an invalid route.`);
      }
      if (
        [order.reachedTarget, order.blocked].some(
          (flag) => flag !== undefined && typeof flag !== "boolean",
        )
      ) {
        throw new TypeError(`Actor ${actor.id} has an invalid route state.`);
      }
      if (
        !isOptionalCount(order.waypointIndex, waypoints.length) ||
        !isOptionalCount(order.navigationVersion, Number.POSITIVE_INFINITY)
      ) {
        throw new RangeError(
          `Actor ${actor.id} has an invalid route position.`,
        );
      }
      if (
        order.occupancyLayer !== undefined &&
        !isOccupancyLayer(order.occupancyLayer)
      ) {
        throw new RangeError(`Actor ${actor.id} has an invalid route layer.`);
      }
      const bounds = order.bounds;
      if (
        bounds !== undefined &&
        (!bounds ||
          !bounds.center ||
          !onMap(bounds.center) ||
          !(bounds.radius > 0) ||
          !Number.isFinite(bounds.radius) ||
          !withinRouteBounds(bounds, [actor.worldPosition, ...waypoints]))
      ) {
        throw new RangeError(`Actor ${actor.id} has invalid route bounds.`);
      }
    },
    handleCommand: (actor, definition, command) => {
      switch (command.kind) {
        case "stop":
          delete actor.movement;
          return true;
        case "move": {
          const grid = gridFor(actor, definition);
          const path = findNavigationPath(
            grid,
            actor.worldPosition,
            command.target,
          );
          // A rejected order leaves the current one running.
          if (
            !path ||
            !withinRouteBounds(command.bounds, [
              actor.worldPosition,
              ...path.waypoints,
            ]) ||
            !getsCloser(grid, actor.worldPosition, path)
          ) {
            return false;
          }
          actor.movement = {
            target: { ...command.target },
            ...(command.requestedTarget && {
              requestedTarget: { ...command.requestedTarget },
            }),
            ...(command.bounds && {
              bounds: {
                center: { ...command.bounds.center },
                radius: command.bounds.radius,
              },
            }),
            ...path,
            waypointIndex: 0,
            navigationVersion: changes.version,
            occupancyLayer: grid.occupancyLayer,
          };
          return true;
        }
        default: {
          const unknown: never = command;
          throw new TypeError(`Unknown command: ${JSON.stringify(unknown)}.`);
        }
      }
    },
    update: (actor, definition, seconds) => {
      const order = actor.movement;
      if (!order) {
        return;
      }
      const grid = gridFor(actor, definition);
      const routeMissing =
        !order.waypoints ||
        order.waypointIndex === undefined ||
        order.destination === undefined ||
        order.reachedTarget === undefined ||
        order.occupancyLayer !== actor.occupancyLayer;
      let replanned = false;
      if (routeMissing || order.navigationVersion !== changes.version) {
        if (routeMissing || needsReplan(grid, actor, order)) {
          replan(actor, order, grid);
          replanned = true;
        } else {
          order.navigationVersion = changes.version;
        }
      }

      let remainingSeconds = seconds;
      while (
        !order.blocked &&
        remainingSeconds > 0 &&
        order.waypointIndex! < order.waypoints!.length
      ) {
        const from = actor.worldPosition;
        const waypoint = order.waypoints![order.waypointIndex!]!;
        const step = advanceAlongSegment(
          grid,
          from,
          waypoint,
          definition.movement!.speed,
          remainingSeconds,
          escapeCostFor(grid, order, from, waypoint),
        );
        actor.worldPosition = step.position;
        actor.facing = step.facing ?? actor.facing;
        remainingSeconds = step.secondsLeft;
        if (step.blocked) {
          // The route crossed a blocker its checks missed; retry once per tick.
          if (replanned) {
            markBlocked(order, actor.worldPosition, changes.version);
          } else {
            replan(actor, order, grid);
            replanned = true;
          }
        } else if (step.arrived) {
          order.waypointIndex! += 1;
        }
      }
      if (!order.blocked && order.waypointIndex! >= order.waypoints!.length) {
        delete actor.movement;
      }
    },
  };
}

export type SegmentStep = {
  position: WorldPosition;
  /** Heading towards the segment's end; absent when already there. */
  facing?: number;
  secondsLeft: number;
  arrived: boolean;
  blocked: boolean;
};

/**
 * Moves along a straight segment for up to `seconds`, at `speed` divided by
 * each tile's cost. `firstTileCost` prices a blocked starting tile.
 */
export function advanceAlongSegment(
  grid: NavigationGrid,
  from: WorldPosition,
  to: WorldPosition,
  speed: number,
  seconds: number,
  firstTileCost?: number,
): SegmentStep {
  const xDistance = to.x - from.x;
  const zDistance = to.z - from.z;
  const distance = Math.hypot(xDistance, zDistance);
  if (distance <= POSITION_EPSILON) {
    return {
      position: { ...to },
      secondsLeft: seconds,
      arrived: true,
      blocked: false,
    };
  }

  let travelled = 0;
  let secondsLeft = seconds;
  let arrived = true;
  let blocked = false;
  let tilesVisited = 0;
  forEachTileOnSegment(grid.map, from, to, (x, z, length) => {
    const cost =
      grid.costAt(x, z) ?? (tilesVisited === 0 ? firstTileCost : undefined);
    tilesVisited += 1;
    if (cost === undefined) {
      blocked = true;
      arrived = false;
      return false;
    }
    const tileSpeed = speed / cost;
    const tileSeconds = length / tileSpeed;
    if (tileSeconds > secondsLeft) {
      travelled += secondsLeft * tileSpeed;
      secondsLeft = 0;
      arrived = false;
      return false;
    }
    travelled += length;
    secondsLeft -= tileSeconds;
  });

  return {
    position: arrived
      ? { ...to }
      : {
          x: from.x + (xDistance / distance) * travelled,
          z: from.z + (zDistance / distance) * travelled,
        },
    facing: Math.atan2(xDistance, zDistance),
    secondsLeft,
    arrived,
    blocked,
  };
}

/** Whether a path reaches its target or a tile other than the actor's own. */
function getsCloser(
  grid: NavigationGrid,
  position: WorldPosition,
  path: NavigationPath,
): boolean {
  if (path.reachedTarget) {
    return true;
  }
  const start = occupiedTile(grid, position);
  const end = grid.map.tileAtWorldPosition(
    path.destination.x,
    path.destination.z,
  );
  return start.x !== end.x || start.z !== end.z;
}

function sameTile(
  map: TerrainView,
  left: WorldPosition,
  right: WorldPosition,
): boolean {
  const leftTile = map.tileAtWorldPosition(left.x, left.z);
  const rightTile = map.tileAtWorldPosition(right.x, right.z);
  return leftTile.x === rightTile.x && leftTile.z === rightTile.z;
}

/**
 * Orders that are blocked, stop short of their target, or lack a route replan
 * on any navigation change; complete routes replan only when a change nears
 * them.
 */
function needsReplan(
  grid: NavigationGrid,
  actor: Actor,
  order: MovementOrder,
): boolean {
  const { map } = grid;
  const changes = map.navigationChanges.entriesSince(
    order.navigationVersion ?? -1,
    grid.occupancyLayer,
  );
  if (!changes) {
    return true;
  }
  const relevant = changes.filter(({ effect }) => effect !== "none");
  if (relevant.length === 0) {
    return false;
  }
  if (
    order.blocked ||
    order.reachedTarget !== true ||
    !order.waypoints ||
    order.waypointIndex === undefined
  ) {
    return true;
  }
  const increases = relevant
    .filter(({ effect }) => effect === "increase" || effect === "mixed")
    .map(({ bounds }) => bounds);
  if (routeIntersectsChanges(map, actor, order, increases)) {
    return true;
  }
  const decreases = relevant
    .filter(({ effect }) => effect === "decrease" || effect === "mixed")
    .map(({ bounds }) => bounds);
  return (
    decreases.length > 0 &&
    changesCouldShortenRoute(grid, actor, order, decreases)
  );
}

/**
 * Whether a route through any changed area could take less time than the
 * remaining route, assuming the cheapest terrain all the way.
 */
function changesCouldShortenRoute(
  grid: NavigationGrid,
  actor: Actor,
  order: MovementOrder,
  changes: readonly Readonly<TerrainBounds>[],
): boolean {
  const { map } = grid;
  const remaining = [
    actor.worldPosition,
    ...order.waypoints!.slice(order.waypointIndex),
  ];
  let routeCost = 0;
  for (let index = 1; index < remaining.length; index += 1) {
    const cost = segmentCost(grid, remaining[index - 1]!, remaining[index]!);
    if (cost === undefined) {
      return true;
    }
    routeCost += cost;
  }
  return changes.some((bounds) => {
    const low = map.worldPositionAt(bounds.minX, bounds.minZ);
    const high = map.worldPositionAt(bounds.maxX + 1, bounds.maxZ + 1);
    const distanceToBounds = (point: WorldPosition) =>
      Math.hypot(
        point.x - Math.min(Math.max(point.x, low.x), high.x),
        point.z - Math.min(Math.max(point.z, low.z), high.z),
      );
    const shortcutCost =
      (distanceToBounds(actor.worldPosition) + distanceToBounds(order.target)) *
      grid.minimumCost;
    return shortcutCost + POSITION_EPSILON < routeCost;
  });
}

function routeIntersectsChanges(
  map: TerrainView,
  actor: Actor,
  order: MovementOrder,
  changes: readonly Readonly<TerrainBounds>[],
): boolean {
  const points = [
    actor.worldPosition,
    ...order.waypoints!.slice(order.waypointIndex),
  ];
  // One tile of margin covers diagonal corner checks beside the route.
  const touchesChange = (x: number, z: number) =>
    changes.some(
      (bounds) =>
        x >= bounds.minX - 1 &&
        x <= bounds.maxX + 1 &&
        z >= bounds.minZ - 1 &&
        z <= bounds.maxZ + 1,
    );
  for (let index = 1; index < points.length; index += 1) {
    const clear = forEachTileOnSegment(
      map,
      points[index - 1]!,
      points[index]!,
      (x, z) => !touchesChange(x, z),
    );
    if (!clear) {
      return true;
    }
  }
  return false;
}

/**
 * A planned first step may leave blocked terrain for an adjacent tile, at that
 * tile's cost. Later steps get no allowance.
 */
function escapeCostFor(
  grid: NavigationGrid,
  order: MovementOrder,
  from: WorldPosition,
  waypoint: WorldPosition,
): number | undefined {
  if (order.waypointIndex !== 0) {
    return undefined;
  }
  const start = grid.map.tileAtWorldPosition(from.x, from.z);
  const next = grid.map.tileAtWorldPosition(waypoint.x, waypoint.z);
  if (Math.abs(start.x - next.x) > 1 || Math.abs(start.z - next.z) > 1) {
    return undefined;
  }
  return grid.costAt(next.x, next.z);
}

/** Straight segments between points inside a circle stay inside it. */
function withinRouteBounds(
  bounds: RouteBounds | undefined,
  waypoints: readonly WorldPosition[],
): boolean {
  return (
    !bounds ||
    waypoints.every((point) => distance(bounds.center, point) <= bounds.radius)
  );
}

function markBlocked(
  order: MovementOrder,
  position: WorldPosition,
  navigationVersion: number,
): void {
  order.destination = { ...position };
  order.reachedTarget = false;
  order.blocked = true;
  order.waypoints = [];
  order.waypointIndex = 0;
  order.navigationVersion = navigationVersion;
}

function isOptionalCount(value: number | undefined, max: number): boolean {
  return (
    value === undefined ||
    (Number.isInteger(value) && value >= 0 && value <= max)
  );
}
