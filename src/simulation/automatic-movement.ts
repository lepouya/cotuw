import { distance, POSITION_EPSILON, samePosition } from "./world";

import type { Actor, RouteProgress, RouteRetryState } from "./actor";
import type { WorldPosition } from "./world";

/** A route keeps its plan until its point moves this far from the route's end. */
const REPLAN_DISTANCE = 1;

/**
 * Keeps an automatic route towards a point, replanning only once the point
 * moves away. A point no route approaches waits until it moves away or
 * navigation changes. Returns whether a route is under way.
 */
export function followRoute(
  actor: Actor,
  point: WorldPosition,
  retry: RouteRetryState,
  context: {
    navigationVersion: number;
    move: (actor: Actor, point: WorldPosition) => boolean;
  },
): boolean {
  const block = (at: WorldPosition, version = context.navigationVersion) => {
    retry.blocked = { at: { ...at }, navigationVersion: version };
    delete actor.movement;
  };
  if (actor.movement?.blocked)
    block(actor.movement.target, actor.movement.navigationVersion);
  const blocked = retry.blocked;
  if (
    blocked &&
    blocked.navigationVersion === context.navigationVersion &&
    distance(blocked.at, point) <= REPLAN_DISTANCE
  )
    return false;
  if (
    actor.movement &&
    distance(actor.movement.target, point) <= REPLAN_DISTANCE
  )
    return true;
  if (context.move(actor, point)) {
    delete retry.blocked;
    return true;
  }
  block(point);
  return false;
}

/** Remaining route length includes any gap beyond a partial destination. */
function remainingRouteDistance(actor: Actor, goal: WorldPosition): number {
  let from = actor.worldPosition;
  let remaining = 0;
  const order = actor.movement;
  for (const point of order?.waypoints?.slice(order.waypointIndex ?? 0) ?? []) {
    remaining += distance(from, point);
    from = point;
  }
  return remaining + distance(from, goal);
}

/** Advances the watchdog only for route progress, not repeated contact nudges. */
export function trackRouteProgress(
  actor: Actor,
  goal: WorldPosition,
  tick: number,
  progress?: RouteProgress,
): RouteProgress {
  const routeGoal = actor.movement?.target ?? goal;
  const remainingDistance = remainingRouteDistance(actor, routeGoal);
  const version =
    actor.movement?.navigationVersion ?? progress?.navigationVersion;
  if (!progress)
    progress = { position: { ...actor.worldPosition }, tick, retryTick: tick };
  // Contact jitter must account for meaningful forward movement.
  const stepProgress = Math.max(
    POSITION_EPSILON,
    distance(progress.position, actor.worldPosition) / 3,
  );
  const changed =
    !progress.goal ||
    !samePosition(progress.goal, routeGoal) ||
    progress.navigationVersion !== version ||
    progress.remainingDistance === undefined;
  if (changed) {
    if (!samePosition(progress.position, actor.worldPosition))
      progress.tick = tick;
    progress.goal = { ...routeGoal };
    progress.navigationVersion = version;
    progress.remainingDistance = remainingDistance;
  } else if (remainingDistance + stepProgress < progress.remainingDistance!) {
    progress.tick = tick;
    progress.remainingDistance = remainingDistance;
  }
  progress.position = { ...actor.worldPosition };
  return progress;
}
