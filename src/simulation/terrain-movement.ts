import {
  findNavigationPath,
  forEachTileOnSegment,
  NavigationGrid,
  occupiedTile,
} from "./navigation";
import { isFinitePosition, withinBounds } from "./world";

import type { TerrainBounds, TerrainMap } from "../map";
import type {
  Actor,
  ActorBehavior,
  ActorDefinition,
  MovementOrder,
} from "./actor";
import type { MovementProfile, NavigationPath } from "./navigation";
import type { WorldPosition } from "./world";

const POSITION_EPSILON = 1e-9;

/** Creates deterministic continuous movement over weighted terrain routes. */
export function createTerrainMoveBehavior(
  map: TerrainMap,
  profiles: readonly MovementProfile[],
): ActorBehavior {
  const grids = new Map<string, NavigationGrid>();
  for (const profile of profiles) {
    if (grids.has(profile.id)) {
      throw new RangeError(`Duplicate movement profile: ${profile.id}.`);
    }
    const stored = Object.freeze({
      ...profile,
      terrainCosts: Object.freeze({ ...profile.terrainCosts }),
    });
    grids.set(profile.id, new NavigationGrid(map, stored));
  }
  // Definitions are validated before any command or update reaches them.
  const gridFor = (definition: ActorDefinition): NavigationGrid =>
    grids.get(definition.movement!.profileId!)!;
  const changes = map.navigationChanges;

  const replan = (actor: Actor, order: MovementOrder, grid: NavigationGrid) => {
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
        (order.destination !== undefined && !onMap(order.destination))
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
    },
    handleCommand: (actor, definition, command) => {
      switch (command.kind) {
        case "stop":
          delete actor.movement;
          return true;
        case "move": {
          const grid = gridFor(definition);
          const path = findNavigationPath(
            grid,
            actor.worldPosition,
            command.target,
          );
          // A rejected order leaves the current one running.
          if (!path || !getsCloser(grid, actor.worldPosition, path)) {
            return false;
          }
          actor.movement = {
            target: { ...command.target },
            ...path,
            waypointIndex: 0,
            navigationVersion: changes.version,
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
      const grid = gridFor(definition);
      const routeMissing =
        !order.waypoints ||
        order.waypointIndex === undefined ||
        order.destination === undefined ||
        order.reachedTarget === undefined;
      let replanned = false;
      if (routeMissing || order.navigationVersion !== changes.version) {
        if (routeMissing || needsReplan(map, actor, order)) {
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
  map: TerrainMap,
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
  map: TerrainMap,
  actor: Actor,
  order: MovementOrder,
): boolean {
  if (
    order.blocked ||
    order.reachedTarget !== true ||
    !order.waypoints ||
    order.waypointIndex === undefined
  ) {
    return true;
  }
  const changes = map.navigationChanges.since(order.navigationVersion ?? -1);
  return !changes || routeIntersectsChanges(map, actor, order, changes);
}

function routeIntersectsChanges(
  map: TerrainMap,
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
