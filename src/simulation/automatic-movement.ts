import { distance } from "./world";

import type { Actor, RouteRetryState } from "./actor";
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
