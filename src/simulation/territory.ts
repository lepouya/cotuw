import { trackRouteProgress } from "./automatic-movement";
import {
  distance,
  isFinitePosition,
  samePosition,
  withinBounds,
} from "./world";
import { isTick, secondsToTicks } from "./clock";
import { insideRouteBounds, withinRouteBounds, WOLF_MODES } from "./actor";
import {
  isId,
  isIdList,
  isNonnegative,
  isOneOf,
  isPositive,
} from "./validation";

import type {
  Actor,
  ActorDefinition,
  RouteBounds,
  TerritoryState,
} from "./actor";
import type { CombatContext, CombatController } from "./combat";
import type { WorldBounds, WorldPosition } from "./world";

type Territory = NonNullable<ActorDefinition["territory"]>;

export type WolfAlert = {
  id: number;
  origin: WorldPosition;
  createdTick: number;
  expiresTick: number;
  /** Wolves that originated or responded to it; none responds twice. */
  propagators: string[];
};

export type WildlifeState = { nextAlertId: number; alerts: WolfAlert[] };

export const createWildlifeState = (): WildlifeState => ({
  nextAlertId: 1,
  alerts: [],
});

/** Authored placement; home defaults to the starting position. */
export type TerritoryAssignment = Partial<
  Pick<TerritoryState, "home" | "center" | "radius" | "encounterId">
>;

export function createTerritoryState(
  position: WorldPosition,
  { home = position, ...assignment }: TerritoryAssignment = {},
): TerritoryState {
  return {
    ...structuredClone(assignment),
    home: { ...home },
    mode: samePosition(position, home) ? "idle-at-home" : "returning-home",
  };
}

export function validateTerritoryDefinition(definition: ActorDefinition): void {
  const t = definition.territory;
  if (
    t &&
    (!definition.weapon ||
      !definition.movement ||
      !definition.vision ||
      ![t.leashRadius, t.arrivalTolerance].every(isPositive) ||
      ![
        t.alertLifetimeSeconds,
        t.investigationSeconds,
        t.blockedRetrySeconds,
        t.stalledSeconds,
        t.regenerationDelaySeconds,
        t.regenerationPerSecond,
      ].every(isNonnegative))
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
    (state !== undefined && !isValidTerritoryState(state, definition, bounds))
  )
    throw new RangeError(`Actor ${actor.id} has invalid territory state.`);
}

/** Checks authoritative routes after command arbitration has settled. */
function validateTerritoryRoute(actor: Actor, territory: Territory): void {
  const state = actor.territory;
  const route = actor.movement;
  if (!state || !route) return;
  const leash = leashBounds(state, territory);
  const routeBounds = route.bounds;
  if (
    (route.waypoints !== undefined && !Array.isArray(route.waypoints)) ||
    !withinRouteBounds(leash, [
      actor.worldPosition,
      route.target,
      ...(route.destination ? [route.destination] : []),
      ...(route.waypoints ?? []),
    ]) ||
    (routeBounds !== undefined &&
      (!routeBounds ||
        !isFinitePosition(routeBounds.center) ||
        !isPositive(routeBounds.radius) ||
        distance(leash.center, routeBounds.center) + routeBounds.radius >
          leash.radius))
  )
    throw new RangeError(
      `Actor ${actor.id} has invalid route bounds for its territory.`,
    );
}

function isValidTerritoryState(
  state: TerritoryState,
  definition: ActorDefinition,
  bounds: WorldBounds,
): boolean {
  const point = (value: unknown): value is WorldPosition =>
    isFinitePosition(value) && withinBounds(value, bounds);
  if (
    !state ||
    !point(state.home) ||
    (state.center !== undefined && !point(state.center)) ||
    (state.radius !== undefined && !isPositive(state.radius))
  )
    return false;
  const leash = leashBounds(state, definition.territory!);
  const { investigation, progress, failedTargets } = state;
  return (
    insideRouteBounds(leash, state.home) &&
    (state.encounterId === undefined ||
      (typeof state.encounterId === "string" && !!state.encounterId)) &&
    (state.mode === undefined || isOneOf(WOLF_MODES, state.mode)) &&
    (state.lastCombatTick === undefined || isTick(state.lastCombatTick)) &&
    (state.seenTargets === undefined || isIdList(state.seenTargets)) &&
    (investigation === undefined ||
      (!!investigation &&
        isTick(investigation.alertId) &&
        investigation.alertId > 0 &&
        point(investigation.origin) &&
        insideRouteBounds(leash, investigation.origin) &&
        (investigation.arrivedTick === undefined ||
          isTick(investigation.arrivedTick)))) &&
    (progress === undefined ||
      (!!progress &&
        point(progress.position) &&
        isTick(progress.tick) &&
        isTick(progress.retryTick) &&
        (progress.goal === undefined || point(progress.goal)) &&
        (progress.navigationVersion === undefined ||
          isTick(progress.navigationVersion)) &&
        (progress.remainingDistance === undefined ||
          isNonnegative(progress.remainingDistance)))) &&
    (failedTargets === undefined ||
      (Array.isArray(failedTargets) &&
        failedTargets.every(
          (failure) =>
            !!failure &&
            isId(failure.targetId) &&
            point(failure.position) &&
            isTick(failure.navigationVersion),
        )))
  );
}

/**
 * Alerts must be well formed, and wolves' histories and shared encounters must
 * agree with them and each other.
 */
export function validateWildlife(
  state: WildlifeState,
  actors: readonly Actor[],
  definitions: ReadonlyMap<string, ActorDefinition>,
  retiredIds: readonly string[],
  bounds: WorldBounds,
  tick: number,
): void {
  const byId = new Map(actors.map((actor) => [actor.id, actor]));
  const ids = new Set([...byId.keys(), ...retiredIds]);
  if (
    !state ||
    !isTick(state.nextAlertId) ||
    state.nextAlertId < 1 ||
    !Array.isArray(state.alerts) ||
    new Set(state.alerts.map((alert) => alert?.id)).size !==
      state.alerts.length ||
    state.alerts.some(
      (alert) =>
        !alert ||
        !isTick(alert.id) ||
        alert.id < 1 ||
        alert.id >= state.nextAlertId ||
        !isFinitePosition(alert.origin) ||
        !withinBounds(alert.origin, bounds) ||
        !isTick(alert.createdTick) ||
        alert.createdTick > tick ||
        !isTick(alert.expiresTick) ||
        alert.expiresTick < alert.createdTick ||
        !isIdList(alert.propagators) ||
        alert.propagators.length === 0 ||
        alert.propagators.some(
          (id) => !ids.has(id) || (byId.has(id) && !byId.get(id)!.territory),
        ),
    )
  )
    throw new RangeError("Mission has invalid wildlife alerts.");
  const encounters = new Map<string, RouteBounds>();
  for (const actor of actors) {
    const t = actor.territory;
    if (!t) continue;
    validateTerritoryRoute(
      actor,
      definitions.get(actor.definitionId)!.territory!,
    );
    const investigated =
      t.investigation &&
      state.alerts.find((alert) => alert.id === t.investigation!.alertId);
    if (
      (t.investigation &&
        (t.investigation.alertId >= state.nextAlertId ||
          (investigated &&
            (!investigated.propagators.includes(actor.id) ||
              !samePosition(t.investigation.origin, investigated.origin))) ||
          (t.investigation.arrivedTick ?? 0) > tick)) ||
      t.seenTargets?.some((id) => !ids.has(id)) ||
      t.failedTargets?.some((failure) => !ids.has(failure.targetId)) ||
      (t.progress && t.progress.tick > tick) ||
      (t.lastCombatTick ?? 0) > tick
    )
      throw new RangeError(`Actor ${actor.id} has invalid wolf history.`);
    if (!t.encounterId) continue;
    const leash = leashBounds(
      t,
      definitions.get(actor.definitionId)!.territory!,
    );
    const prior = encounters.get(t.encounterId);
    if (
      prior &&
      (distance(prior.center, leash.center) !== 0 ||
        prior.radius !== leash.radius)
    )
      throw new RangeError(
        `Wolf encounter ${t.encounterId} has inconsistent bounds.`,
      );
    encounters.set(t.encounterId, leash);
  }
}

function leashBounds(state: TerritoryState, territory: Territory): RouteBounds {
  return {
    center: state.center ?? state.home,
    radius: state.radius ?? territory.leashRadius,
  };
}

/** Contact correction respects the territory in every wolf state. */
export function leashAllows(
  actor: Actor,
  definition: ActorDefinition,
  point: WorldPosition,
): boolean {
  return (
    !actor.territory ||
    !definition.territory ||
    insideRouteBounds(leashBounds(actor.territory, definition.territory), point)
  );
}

/**
 * Drives territorial NPCs: personal sight, wolf alerts, pursuit and
 * investigation inside the hard leash, return home, and regeneration there.
 */
export function createTerritoryController(
  wildlife: WildlifeState,
): CombatController {
  let observed = new Map<string, WolfAlert[]>();
  const territoryOf = (actor: Actor, context: CombatContext) =>
    context.definition(actor).territory!;
  return {
    applies: (definition) => !!definition.territory,
    personalSight: true,
    bounds: (actor, definition) =>
      leashBounds(actor.territory!, definition.territory!),
    arrivalRadius: (definition) => definition.territory!.arrivalTolerance,
    prepare: (actors, context) => {
      observed = observeAlerts(actors, wildlife, context);
    },
    plan: (actor, context) =>
      planTerritory(
        actor,
        territoryOf(actor, context),
        context,
        observed.get(actor.id) ?? [],
      ),
    chased: (actor, context) => {
      const state = actor.territory!;
      state.mode = "pursuing";
      if (
        state.progress &&
        actor.combat?.attack?.blocked &&
        context.tick >= state.progress.retryTick
      )
        state.progress.retryTick =
          context.tick +
          secondsToTicks(
            territoryOf(actor, context).blockedRetrySeconds,
            context.tickSeconds,
          );
    },
    firing: (actor) => {
      actor.territory!.mode = "attacking";
      delete actor.territory!.progress;
    },
    settle: (actor, context) => {
      const territory = territoryOf(actor, context);
      // Damage alerts without revealing an unseen attacker.
      if (actor.combat?.lastHit?.tick === context.tick)
        raiseAlert(actor, territory, wildlife, context);
      regenerate(actor, context);
    },
  };
}

function raiseAlert(
  actor: Actor,
  territory: Territory,
  wildlife: WildlifeState,
  context: CombatContext,
): void {
  wildlife.alerts.push({
    id: wildlife.nextAlertId++,
    origin: { ...actor.worldPosition },
    createdTick: context.tick,
    expiresTick:
      context.tick +
      secondsToTicks(territory.alertLifetimeSeconds, context.tickSeconds),
    propagators: [actor.id],
  });
  if (
    !actor.combat?.attack &&
    !actor.combat?.returning &&
    !actor.territory!.investigation
  )
    actor.territory!.mode = "alerted";
}

/**
 * Snapshots each wolf's observed alerts before any wolf responds, so iteration
 * order is inert, then raises alerts for fresh sightings. `actors` arrive in
 * stable ID order.
 */
function observeAlerts(
  actors: readonly Actor[],
  wildlife: WildlifeState,
  context: CombatContext,
): Map<string, WolfAlert[]> {
  wildlife.alerts = wildlife.alerts.filter(
    (alert) => alert.expiresTick > context.tick,
  );
  const observed = new Map<string, WolfAlert[]>();
  for (const actor of actors)
    observed.set(
      actor.id,
      wildlife.alerts.filter(
        (alert) =>
          !alert.propagators.includes(actor.id) &&
          alert.propagators.some((id) => {
            const wolf = context.actorById(id);
            return !!wolf?.territory && context.sees(actor, wolf);
          }),
      ),
    );
  for (const actor of actors) {
    const state = actor.territory!;
    const targets = context.visibleTargets(actor).map((target) => target.id);
    if (targets.some((id) => !state.seenTargets?.includes(id)))
      raiseAlert(
        actor,
        context.definition(actor).territory!,
        wildlife,
        context,
      );
    state.seenTargets = targets;
  }
  return observed;
}

/** Progress and retries are authoritative so blocked saves continue exactly. */
function stalled(
  actor: Actor,
  territory: Territory,
  context: CombatContext,
  goal: WorldPosition,
): boolean {
  const state = actor.territory!;
  state.progress = trackRouteProgress(
    actor,
    goal,
    context.tick,
    state.progress,
  );
  if (
    context.tick >= state.progress.retryTick &&
    (actor.movement?.blocked || actor.combat?.attack?.blocked)
  ) {
    delete actor.movement;
    delete actor.combat?.attack?.blocked;
  }
  return (
    context.tick - state.progress.tick >=
    secondsToTicks(territory.stalledSeconds, context.tickSeconds)
  );
}

/** Returns whether the actor fights its target this tick. */
function planTerritory(
  actor: Actor,
  territory: Territory,
  context: CombatContext,
  alerts: readonly WolfAlert[],
): boolean {
  const state = actor.territory!;
  const bounds = context.bounds(actor)!;
  const inside = (point: WorldPosition) => insideRouteBounds(bounds, point);
  const ticks = (seconds: number) =>
    secondsToTicks(seconds, context.tickSeconds);
  const visible = context.visibleTargets(actor);
  state.failedTargets = (state.failedTargets ?? []).filter((failure) => {
    if (context.navigationChanged(actor, failure.navigationVersion))
      return false;
    failure.navigationVersion = context.navigationVersion;
    // Hidden targets cannot clear a failure through unseen movement.
    const target = visible.find((target) => target.id === failure.targetId);
    return !target || samePosition(failure.position, target.worldPosition);
  });

  const current = context.currentTarget(actor);
  if (current && inside(current.worldPosition) && inside(actor.worldPosition)) {
    if (
      state.mode === "attacking" ||
      !stalled(actor, territory, context, current.worldPosition)
    ) {
      state.lastCombatTick = context.tick;
      return true;
    }
    state.failedTargets.push({
      targetId: current.id,
      position: { ...current.worldPosition },
      navigationVersion: context.navigationVersion,
    });
  }
  if (actor.combat?.attack) {
    context.endAttack(actor);
    delete state.progress;
  }

  const target =
    inside(actor.worldPosition) &&
    context.nearestTarget(
      actor,
      Infinity,
      (candidate) =>
        inside(candidate.worldPosition) &&
        !state.failedTargets!.some(
          (failure) => failure.targetId === candidate.id,
        ) &&
        context.reachableTarget(actor, candidate),
    );
  if (target) {
    delete state.investigation;
    delete state.progress;
    context.engage(actor, target);
    state.mode = "pursuing";
    state.lastCombatTick = context.tick;
    return true;
  }

  const investigation = state.investigation;
  if (investigation) {
    state.mode = "investigating";
    if (context.arrived(actor, investigation.origin)) {
      delete actor.movement;
      investigation.arrivedTick ??= context.tick;
      if (
        context.tick - investigation.arrivedTick <
        ticks(territory.investigationSeconds)
      )
        return false;
    } else if (!stalled(actor, territory, context, investigation.origin)) {
      if (!actor.movement && context.tick >= state.progress!.retryTick) {
        context.move(actor, investigation.origin, bounds);
        state.progress!.retryTick =
          context.tick + ticks(territory.blockedRetrySeconds);
      }
      return false;
    }
    delete state.investigation;
    delete state.progress;
    delete actor.movement;
  }

  const alert = alerts
    .filter(
      (alert) =>
        inside(alert.origin) && context.reachablePoint(actor, alert.origin),
    )
    .sort(
      (a, b) =>
        distance(actor.worldPosition, a.origin) -
          distance(actor.worldPosition, b.origin) || a.id - b.id,
    )[0];
  if (alert) {
    alert.propagators.push(actor.id);
    state.investigation = { alertId: alert.id, origin: { ...alert.origin } };
    state.mode = "alerted";
    delete state.progress;
    delete actor.combat?.returning;
    delete actor.movement;
    return false;
  }

  if (!context.arrived(actor, state.home)) {
    state.mode = "returning-home";
    context.startReturn(actor, state.home);
  } else {
    delete actor.combat?.returning;
    delete actor.movement;
    state.mode = "idle-at-home";
  }
  return false;
}

/** Recovers health only at home after the out-of-combat delay. */
function regenerate(actor: Actor, context: CombatContext): void {
  const state = actor.territory!;
  const definition = context.definition(actor);
  const territory = definition.territory!;
  if (
    actor.health === undefined ||
    territory.regenerationPerSecond === 0 ||
    actor.combat?.attack ||
    actor.combat?.returning ||
    state.investigation ||
    state.mode === "alerted" ||
    !context.arrived(actor, state.home) ||
    context.tick -
      Math.max(
        actor.combat?.activeTick ?? -Infinity,
        state.lastCombatTick ?? -Infinity,
      ) <
      secondsToTicks(territory.regenerationDelaySeconds, context.tickSeconds)
  )
    return;
  state.mode = "regenerating";
  actor.health += territory.regenerationPerSecond * context.tickSeconds;
  if (actor.health >= definition.health!) {
    delete actor.health;
    state.mode = "idle-at-home";
  }
}
