import { distance, isFinitePosition, withinBounds } from "./world";
import { secondsToTicks } from "./clock";

import type { Actor, ActorDefinition, RouteBounds } from "./actor";
import type { CombatContext } from "./combat";
import type { WorldBounds, WorldPosition } from "./world";

type Territory = NonNullable<ActorDefinition["territory"]>;

export function validateTerritoryDefinition(definition: ActorDefinition): void {
  const territory = definition.territory;
  if (
    territory &&
    (!definition.weapon ||
      !definition.movement ||
      !(territory.aggressionRadius > 0) ||
      !(territory.leashRadius >= territory.aggressionRadius) ||
      !Number.isFinite(territory.leashRadius) ||
      !(territory.regenerationDelaySeconds >= 0) ||
      !(territory.regenerationPerSecond >= 0) ||
      !Number.isFinite(territory.regenerationDelaySeconds) ||
      !Number.isFinite(territory.regenerationPerSecond))
  )
    throw new RangeError(`Invalid territory definition: ${definition.id}.`);
}

export function validateTerritoryActor(
  actor: Actor,
  definition: ActorDefinition,
  bounds: WorldBounds,
): void {
  const state = actor.territory;
  if (
    (definition.territory !== undefined) !== (state !== undefined) ||
    (state !== undefined &&
      (!state ||
        typeof state !== "object" ||
        !state.home ||
        !isFinitePosition(state.home) ||
        !withinBounds(state.home, bounds)))
  )
    throw new RangeError(`Actor ${actor.id} has invalid territory state.`);
}

/** The leash a territorial actor's pursuit must stay inside. */
export function leashBounds(
  actor: Actor,
  definition: ActorDefinition,
): RouteBounds | undefined {
  return definition.territory && actor.territory
    ? {
        center: actor.territory.home,
        radius: definition.territory.leashRadius,
      }
    : undefined;
}

/** Contact correction cannot push a fighting territorial actor off its leash. */
export function leashAllows(
  actor: Actor,
  definition: ActorDefinition,
  point: WorldPosition,
): boolean {
  const bounds = leashBounds(actor, definition);
  return (
    !actor.combat?.attack ||
    !bounds ||
    distance(bounds.center, point) <= bounds.radius
  );
}

/**
 * Keeps a valid target inside the leash or engages the nearest provoking
 * hostile; otherwise heads home, ignoring hostiles while its route proceeds.
 * Returns whether the actor may attack this tick; a stranded actor may still
 * answer an attacker in range.
 */
export function planTerritory(
  actor: Actor,
  territory: Territory,
  context: CombatContext,
): boolean {
  const { home } = actor.territory!;
  if (context.continueReturn(actor)) return false;
  const leashed = (target: Actor) =>
    distance(home, target.worldPosition) <= territory.leashRadius;
  if (!leashed(actor)) {
    if (actor.combat?.attack) context.endAttack(actor);
    return !context.startReturn(actor, home);
  }
  const current = context.currentTarget(actor);
  if (current && leashed(current)) return true;
  if (actor.combat?.attack) context.endAttack(actor);
  const attacker = context.recentAttacker(actor);
  const provoked =
    context.nearestTarget(actor, territory.aggressionRadius, leashed) ??
    (attacker && leashed(attacker) ? attacker : undefined);
  if (provoked) {
    context.engage(actor, provoked);
    return true;
  }
  return !context.startReturn(actor, home);
}

/** Recovers health at home after the out-of-combat delay. */
export function regenerate(
  actor: Actor,
  territory: Territory,
  maxHealth: number,
  context: CombatContext,
): void {
  const state = actor.territory!;
  if (
    actor.health === undefined ||
    actor.combat?.attack ||
    actor.combat?.returning ||
    !context.arrived(actor, state.home) ||
    context.tick - (actor.combat?.activeTick ?? -Infinity) <
      secondsToTicks(territory.regenerationDelaySeconds, context.tickSeconds)
  )
    return;
  actor.health += territory.regenerationPerSecond * context.tickSeconds;
  if (actor.health >= maxHealth) delete actor.health;
}
