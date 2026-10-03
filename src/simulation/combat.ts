import { personallyDetects } from "./vision";
import { forEachTileOnSegment } from "./navigation";
import { isTilePlacedActor, occupiedTilesFor } from "./placement";
import {
  distance,
  distanceToBounds,
  isFinitePosition,
  withinBounds,
} from "./world";
import { isTick, secondsToTicks } from "./clock";
import { followRoute } from "./automatic-movement";
import { terrainSightlineClear } from "./terrain-sightline";
import { tileAreaBounds } from "./terrain";
import { areHostile } from "./faction";
import { clearCombatOrders, compareIds, healthOf } from "./actor";
import {
  validateTerritoryActor,
  validateTerritoryDefinition,
} from "./territory";

import type {
  Actor,
  ActorDefinition,
  MovementOrder,
  RouteBounds,
  RouteRetryState,
} from "./actor";
import type { TileCoord } from "./grid";
import type { OccupancyView } from "./occupancy";
import type { TerrainGrid } from "./terrain";
import type { WorldBounds, WorldPosition } from "./world";

export type AttackReason = "unarmed" | "invalid-target" | "undetected";

/** One resolved hit, for presentation; it is not saved. */
export type AttackEvent = {
  attackerId: string;
  attackerDefinitionId: string;
  targetId: string;
  from: WorldPosition;
  to: WorldPosition;
  damage: number;
  damageType: string;
};

/** Non-interactive remains of a destroyed actor. */
export type Wreck = {
  actorId: string;
  definitionId: string;
  worldPosition: WorldPosition;
  facing: number;
  /** Building debris keeps its footprint unbuildable until it clears. */
  tilePlacement?: Actor["tilePlacement"];
  /** The tick it was destroyed on. */
  tick: number;
};

/** How long remains stay before clearing. */
export const WRECK_SECONDS = 60;
/** Firing heights above the ground, in world units. */
const MUZZLE_HEIGHT = 1.2;
const TARGET_HEIGHT = 0.5;
/** An actor has reached a point within this distance of it. */
const ARRIVAL_RADIUS = 1;

/**
 * Automatic targeting for armed actors whose definitions opt in, such as
 * guards and territories. Hooks run for each actor in stable ID order.
 */
export type CombatController = {
  applies: (definition: ActorDefinition) => boolean;
  /** Personal sight replaces faction detection. */
  personalSight?: boolean;
  /** Keeps automatic routes inside a circle. */
  bounds?: (actor: Actor, definition: ActorDefinition) => RouteBounds;
  /** Distance within which the actor has reached a point. */
  arrivalRadius?: (definition: ActorDefinition) => number;
  /** Receives its assigned actors in stable ID order, before any actor plans. */
  prepare?: (actors: readonly Actor[], context: CombatContext) => void;
  /** Chooses or ends orders; returns whether the actor may fight this tick. */
  plan: (actor: Actor, context: CombatContext) => boolean;
  /** Runs after a pursuit route is attempted, including blocked attempts. */
  chased?: (actor: Actor, context: CombatContext) => void;
  /** The actor is in range and aiming at its target this tick. */
  firing?: (actor: Actor, context: CombatContext) => void;
  /** Runs for each surviving actor after the tick's damage lands. */
  settle?: (actor: Actor, context: CombatContext) => void;
};

/** What combat controllers may do each tick. */
export type CombatContext = {
  readonly tick: number;
  readonly tickSeconds: number;
  readonly navigationVersion: number;
  definition: (actor: Actor) => ActorDefinition;
  actorById: (id: string) => Actor | undefined;
  /** Whether navigation changed since `version` within the actor's bounds. */
  navigationChanged: (actor: Actor, version: number) => boolean;
  bounds: (actor: Actor) => RouteBounds | undefined;
  move: CombatWorld["move"];
  /** Personal sight, sharing fog's tile centers and terrain rays. */
  sees: (actor: Actor, target: Actor) => boolean;
  /** Detected valid targets in stable ID order. */
  visibleTargets: (actor: Actor) => Actor[];
  /** Whether a bounded route gets within weapon range of the target. */
  reachableTarget: (actor: Actor, target: Actor) => boolean;
  /** Whether a bounded route arrives at the point. */
  reachablePoint: (actor: Actor, point: WorldPosition) => boolean;
  /** The actor's order target, while it remains a detected valid target. */
  currentTarget: (actor: Actor) => Actor | undefined;
  /** The nearest detected valid target within `radius`, by stable ID on ties. */
  nearestTarget: (
    actor: Actor,
    radius: number,
    accept?: (target: Actor) => boolean,
  ) => Actor | undefined;
  /** Whoever hit the actor in the previous tick, if it is still a target. */
  recentAttacker: (actor: Actor) => Actor | undefined;
  /** Starts an attack; automatic engagements return to `post` afterward. */
  engage: (actor: Actor, target: Actor, post?: WorldPosition) => void;
  /** Ends the attack, returning to its post if it has one. */
  endAttack: (actor: Actor) => void;
  /**
   * Heads back to a point, keeping a blocked return's retry state when the
   * point is unchanged. Returns whether a route is under way.
   */
  startReturn: (actor: Actor, point: WorldPosition) => boolean;
  /**
   * Continues any return and clears it on arrival. Returns whether a route is
   * under way; while it is, the actor ignores hostiles.
   */
  continueReturn: (actor: Actor) => boolean;
  arrived: (actor: Actor, point: WorldPosition) => boolean;
};

export type CombatWorld = {
  tick: number;
  tickSeconds: number;
  navigationVersion: number;
  actors: Actor[];
  /** The first controller that applies to an actor's definition drives it. */
  controllers: readonly CombatController[];
  /** Closest reachable destination inside the actor's route bounds. */
  destination: (
    actor: Actor,
    point: WorldPosition,
    bounds?: RouteBounds,
  ) => WorldPosition | undefined;
  wrecks: readonly Wreck[];
  definitions: ReadonlyMap<string, ActorDefinition>;
  map?: TerrainGrid;
  occupancy?: OccupancyView;
  /** Whether a faction currently detects the actor. */
  detects: (
    faction: string | undefined,
    target: Pick<Actor, "definitionId" | "worldPosition" | "tilePlacement">,
  ) => boolean;
  /** Starts a route; returns whether the actor accepted it. */
  move: (actor: Actor, target: WorldPosition, bounds?: RouteBounds) => boolean;
  /** Takes a destroyed actor out of the mission. */
  destroy: (actor: Actor) => void;
};

const positive = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value > 0;
const isId = (value: unknown) => typeof value === "string" && value.length > 0;

export function validateCombatDefinition(definition: ActorDefinition): void {
  const { health, weapon, guard, faction } = definition;
  if (
    (faction !== undefined && !isId(faction)) ||
    (health !== undefined && !positive(health)) ||
    (weapon &&
      (!positive(weapon.damage) ||
        !isId(weapon.damageType) ||
        !positive(weapon.range) ||
        !positive(weapon.cooldownSeconds))) ||
    (guard &&
      (!weapon ||
        !definition.movement ||
        !positive(guard.acquisitionRadius) ||
        !positive(guard.chaseRadius)))
  )
    throw new RangeError(`Invalid combat definition: ${definition.id}.`);
  validateTerritoryDefinition(definition);
}

export function validateCombatActor(
  actor: Actor,
  definition: ActorDefinition,
  bounds: WorldBounds,
): void {
  const { health, combat, attackMove } = actor;
  const point = (value: unknown) =>
    !!value &&
    isFinitePosition(value as WorldPosition) &&
    withinBounds(value as WorldPosition, bounds);
  const retry = ({ blocked }: RouteRetryState) =>
    blocked === undefined ||
    (!!blocked && point(blocked.at) && isTick(blocked.navigationVersion));
  const { attack, returning, aimFacing } = combat ?? {};
  if (
    (attackMove !== undefined &&
      (!attackMove ||
        !definition.movement ||
        definition.footprint ||
        !point(attackMove.target) ||
        !retry(attackMove) ||
        (attackMove.requestedTarget !== undefined &&
          !point(attackMove.requestedTarget)) ||
        returning !== undefined ||
        attack?.post !== undefined)) ||
    (health !== undefined &&
      !(
        definition.health !== undefined &&
        Number.isFinite(health) &&
        health > 0 &&
        health <= definition.health
      )) ||
    (combat !== undefined &&
      (!combat ||
        typeof combat !== "object" ||
        (attack !== undefined &&
          (!definition.weapon ||
            !attack ||
            !isId(attack.targetId) ||
            !point(attack.lastKnown) ||
            (attack.post !== undefined && !point(attack.post)) ||
            !retry(attack))) ||
        (returning !== undefined &&
          ((!definition.guard && !definition.territory) ||
            !returning ||
            attack !== undefined ||
            !point(returning.point) ||
            !retry(returning))) ||
        (aimFacing !== undefined &&
          (!definition.weapon ||
            !definition.footprint ||
            !Number.isFinite(aimFacing))) ||
        (combat.weaponReadyTick !== undefined &&
          (!definition.weapon || !isTick(combat.weaponReadyTick))) ||
        (combat.activeTick !== undefined && !isTick(combat.activeTick)) ||
        (combat.lastHit !== undefined &&
          (!combat.lastHit ||
            !isId(combat.lastHit.attackerId) ||
            !isTick(combat.lastHit.tick)))))
  )
    throw new RangeError(`Actor ${actor.id} has invalid combat state.`);
  validateTerritoryActor(actor, definition, bounds);
}

/** The footprint tiles building debris covers; none for fallen units. */
export function wreckTiles(
  wreck: Wreck,
  definition: ActorDefinition,
): TileCoord[] {
  return wreck.tilePlacement
    ? occupiedTilesFor(
        {
          id: wreck.actorId,
          definitionId: wreck.definitionId,
          tilePlacement: wreck.tilePlacement,
        },
        definition,
      )
    : [];
}

/** Why an armed actor cannot attack a target right now, if it cannot. */
export function attackRejection(
  attacker: Actor | undefined,
  target: Actor | undefined,
  world: Pick<CombatWorld, "definitions" | "detects">,
): AttackReason | undefined {
  const definition = attacker && world.definitions.get(attacker.definitionId);
  if (!attacker || !definition?.weapon) return "unarmed";
  if (!target || !canTarget(attacker, target, world.definitions))
    return "invalid-target";
  if (!world.detects(definition.faction, target)) return "undetected";
  return undefined;
}

/** Gives an actor an attack order, replacing its route. */
export function startAttack(
  actor: Actor,
  target: Actor,
  post?: WorldPosition,
  preserveAttackMove = false,
): void {
  if (!preserveAttackMove) clearCombatOrders(actor);
  delete actor.combat?.returning;
  (actor.combat ??= {}).attack = {
    targetId: target.id,
    lastKnown: { ...target.worldPosition },
    ...(post && { post: { ...post } }),
  };
  delete actor.movement;
}

/**
 * Marks an Attack Move whose route ended short of its destination as blocked,
 * so it retries only after navigation changes. `route` is the movement order
 * from before this tick's motion.
 */
export function noteAttackMoveRoute(
  actor: Actor,
  route: MovementOrder | undefined,
  navigationVersion: number,
): void {
  const order = actor.attackMove;
  if (
    order &&
    !actor.combat?.attack &&
    route?.reachedTarget === false &&
    !actor.movement
  )
    order.blocked = { at: { ...order.target }, navigationVersion };
}

/**
 * Updates orders, chases, and fires for armed actors in stable ID order, then
 * applies the tick's damage together and destroys actors left without health.
 * Territories and guards choose automatic targets; any armed actor without an
 * order answers an attacker already in range.
 */
export function updateCombat(world: CombatWorld): AttackEvent[] {
  const { definitions, tick } = world;
  const byId = new Map(world.actors.map((actor) => [actor.id, actor]));
  const wreckById = new Map(
    world.wrecks.map((wreck) => [wreck.actorId, wreck]),
  );
  const sorted = [...world.actors].sort((a, b) => compareIds(a.id, b.id));
  const definitionOf = (actor: Actor) => definitions.get(actor.definitionId)!;
  const targetable = (actor: Actor, target: Actor | undefined) =>
    !!target && canTarget(actor, target, definitions);
  const controllers = new Map(
    [...definitions].map(([id, definition]) => [
      id,
      world.controllers.find((controller) => controller.applies(definition)),
    ]),
  );
  const controllerOf = (actor: Actor) => controllers.get(actor.definitionId);
  const boundsOf = (actor: Actor) =>
    controllerOf(actor)?.bounds?.(actor, definitionOf(actor));
  const arrivalRadius = (actor: Actor) =>
    controllerOf(actor)?.arrivalRadius?.(definitionOf(actor)) ?? ARRIVAL_RADIUS;
  const navigationChanged = (actor: Actor, version: number) => {
    const map = world.map;
    const entries = map?.navigationChanges.entriesSince(
      version,
      actor.occupancyLayer,
    );
    if (!entries) return version !== world.navigationVersion;
    const bounds = boundsOf(actor);
    return entries.some(
      (entry) =>
        entry.effect !== "none" &&
        (!bounds ||
          distanceToBounds(bounds.center, tileAreaBounds(map!, entry.bounds)) <=
            bounds.radius),
    );
  };
  const personal = new Map<string, boolean>();
  const sees = (actor: Actor, target: Actor) => {
    const key = JSON.stringify([actor.id, target.id]);
    if (!personal.has(key))
      personal.set(
        key,
        personallyDetects(actor, target, definitions, world.map),
      );
    return personal.get(key)!;
  };
  const detected = (actor: Actor, target: Actor) =>
    controllerOf(actor)?.personalSight
      ? sees(actor, target)
      : world.detects(definitionOf(actor).faction, target);
  const engageable = (actor: Actor, target: Actor | undefined) =>
    targetable(actor, target) && detected(actor, target!);
  const arrived = (actor: Actor, point: WorldPosition) =>
    distance(actor.worldPosition, point) <= arrivalRadius(actor);
  /** Where a route inside the actor's bounds towards `point` ends, if any. */
  const destination = (actor: Actor, point: WorldPosition) =>
    world.destination(actor, point, boundsOf(actor));
  const continueReturn = (actor: Actor) => {
    const returning = actor.combat?.returning;
    if (!returning) return false;
    if (arrived(actor, returning.point)) {
      delete actor.combat!.returning;
      delete actor.movement;
      return false;
    }
    const bounds = boundsOf(actor);
    // Bounded returns ignore navigation changes beyond their bounds.
    if (
      bounds &&
      returning.blocked &&
      !navigationChanged(actor, returning.blocked.navigationVersion)
    )
      returning.blocked.navigationVersion = world.navigationVersion;
    return followRoute(actor, returning.point, returning, {
      navigationVersion: world.navigationVersion,
      move: (mover, point) => world.move(mover, point, bounds),
    });
  };
  const startReturn = (actor: Actor, point: WorldPosition) => {
    // A territory heading home abandons any Attack Move.
    delete actor.attackMove;
    const combat = (actor.combat ??= {});
    if (!combat.returning || distance(combat.returning.point, point) > 0)
      combat.returning = { point: { ...point } };
    return continueReturn(actor);
  };
  /** Heads for the Attack Move destination, or ends the order there. */
  const resumeAttackMove = (actor: Actor) => {
    const order = actor.attackMove!;
    if (distance(actor.worldPosition, order.target) === 0)
      return void delete actor.attackMove;
    followRoute(actor, order.target, order, world);
    if (actor.movement && order.requestedTarget)
      actor.movement.requestedTarget = { ...order.requestedTarget };
  };
  const endAttack = (actor: Actor) => {
    const post = actor.combat?.attack?.post;
    delete actor.combat?.attack;
    delete actor.movement;
    if (post) startReturn(actor, post);
    else if (actor.attackMove) resumeAttackMove(actor);
  };
  const context: CombatContext = {
    tick,
    tickSeconds: world.tickSeconds,
    navigationVersion: world.navigationVersion,
    definition: definitionOf,
    actorById: (id) => byId.get(id),
    navigationChanged,
    bounds: boundsOf,
    move: world.move,
    sees,
    visibleTargets: (actor) =>
      sorted.filter((target) => engageable(actor, target)),
    reachableTarget: (actor, target) => {
      const end = destination(actor, target.worldPosition);
      return (
        !!end &&
        reach(
          { ...actor, worldPosition: end },
          target,
          definitions,
          world.map,
        ) <= definitionOf(actor).weapon!.range
      );
    },
    reachablePoint: (actor, point) => {
      const end = destination(actor, point);
      return !!end && distance(end, point) <= arrivalRadius(actor);
    },
    currentTarget: (actor) => {
      const order = actor.combat?.attack;
      const target = order && byId.get(order.targetId);
      return engageable(actor, target) ? target : undefined;
    },
    nearestTarget: (actor, radius, accept = () => true) => {
      let nearest: Actor | undefined;
      let nearestDistance = radius;
      // Ascending IDs keep the first of equally near targets.
      for (const target of sorted) {
        const gap = distance(actor.worldPosition, target.worldPosition);
        if (
          gap > nearestDistance ||
          (nearest && gap === nearestDistance) ||
          !engageable(actor, target) ||
          !accept(target)
        )
          continue;
        nearest = target;
        nearestDistance = gap;
      }
      return nearest;
    },
    recentAttacker: (actor) => {
      const hit = actor.combat?.lastHit;
      // Damage lands at the end of a tick, so the reaction comes a tick later.
      if (!hit || tick - hit.tick > 1) return undefined;
      const source = byId.get(hit.attackerId);
      return engageable(actor, source) ? source : undefined;
    },
    engage: startAttack,
    endAttack,
    startReturn,
    continueReturn,
    arrived,
  };

  /** Chases stay inside the actor's bounds. */
  const chase = (actor: Actor, point: WorldPosition) => {
    const bounds = boundsOf(actor);
    followRoute(actor, point, actor.combat!.attack!, {
      navigationVersion: world.navigationVersion,
      move: (mover, target) => world.move(mover, target, bounds),
    });
    controllerOf(actor)?.chased?.(actor, context);
  };
  const movable = (actor: Actor) => !!definitionOf(actor).movement;

  /** Validates the order and returns the target to fire at, if any. */
  const followOrder = (actor: Actor): Actor | undefined => {
    const order = actor.combat!.attack!;
    const target = byId.get(order.targetId);
    const wreck = wreckById.get(order.targetId);
    if (
      (target && !targetable(actor, target)) ||
      (!target && wreck && world.detects(definitionOf(actor).faction, wreck))
    )
      return void endAttack(actor);
    if (!target || !detected(actor, target)) {
      // Hidden movement and destruction are unknown; search where last seen.
      if (order.post || !movable(actor) || arrived(actor, order.lastKnown))
        return void endAttack(actor);
      chase(actor, order.lastKnown);
      if (order.blocked) endAttack(actor);
      return undefined;
    }
    order.lastKnown = { ...target.worldPosition };
    return target;
  };

  for (const controller of world.controllers)
    controller.prepare?.(
      sorted.filter((actor) => controllerOf(actor) === controller),
      context,
    );
  const hits: AttackEvent[] = [];
  for (const actor of sorted) {
    const definition = definitionOf(actor);
    const weapon = definition.weapon;
    if (actor.attackMove && !actor.combat?.attack) {
      if (actor.attackMove.blocked) resumeAttackMove(actor);
      if (!actor.movement && !actor.attackMove?.blocked)
        delete actor.attackMove;
      else if (weapon) {
        const target = context.nearestTarget(
          actor,
          definition.guard?.acquisitionRadius ?? weapon.range,
        );
        if (target) startAttack(actor, target, undefined, true);
      }
    }
    if (!weapon) continue;
    const controller = controllerOf(actor);
    if (controller && !controller.plan(actor, context)) continue;
    const ordered = !!actor.combat?.attack;
    const target = ordered ? followOrder(actor) : context.recentAttacker(actor);
    if (!target) continue;
    if (
      reach(actor, target, definitions, world.map) > weapon.range ||
      !lineOfFire(actor, target, world)
    ) {
      // Answering fire never leaves the current route; armed buildings
      // cannot close the distance, so they give up the order.
      if (ordered && movable(actor)) chase(actor, target.worldPosition);
      else if (ordered) endAttack(actor);
      continue;
    }
    if (ordered) delete actor.movement;
    controller?.firing?.(actor, context);
    const combat = (actor.combat ??= {});
    const aim = Math.atan2(
      target.worldPosition.x - actor.worldPosition.x,
      target.worldPosition.z - actor.worldPosition.z,
    );
    if (isTilePlacedActor(actor)) combat.aimFacing = aim;
    else actor.facing = aim;
    if ((combat.weaponReadyTick ?? 0) > tick) continue;
    combat.weaponReadyTick =
      tick + secondsToTicks(weapon.cooldownSeconds, world.tickSeconds);
    combat.activeTick = tick;
    hits.push({
      attackerId: actor.id,
      attackerDefinitionId: actor.definitionId,
      targetId: target.id,
      from: { ...actor.worldPosition },
      to: { ...target.worldPosition },
      damage: weapon.damage,
      damageType: weapon.damageType,
    });
  }
  for (const hit of hits) {
    const target = byId.get(hit.targetId)!;
    target.health = healthOf(target, definitionOf(target).health!) - hit.damage;
    const combat = (target.combat ??= {});
    combat.activeTick = tick;
    combat.lastHit = { attackerId: hit.attackerId, tick };
  }
  for (const actor of sorted)
    if (actor.health !== undefined && actor.health <= 0) world.destroy(actor);
    else controllerOf(actor)?.settle?.(actor, context);
  return hits;
}

/** Guards defend a post unless an Attack Move drives them. */
export const guardController: CombatController = {
  applies: (definition) => !!definition.guard,
  plan: (actor, context) => {
    if (!actor.attackMove)
      planGuard(actor, context.definition(actor).guard!, context);
    return true;
  },
};

/**
 * An idle guard engages the nearest detected hostile near it that its chase
 * radius allows; an automatic engagement ends once its target was last seen
 * beyond that radius from the post.
 */
function planGuard(
  actor: Actor,
  guard: NonNullable<ActorDefinition["guard"]>,
  context: CombatContext,
): void {
  const order = actor.combat?.attack;
  if (order) {
    const known =
      context.currentTarget(actor)?.worldPosition ?? order.lastKnown;
    if (order.post && distance(order.post, known) > guard.chaseRadius)
      context.endAttack(actor);
    return;
  }
  if (context.continueReturn(actor)) return;
  // A blocked route leaves the actor as good as idle.
  if (actor.movement && !actor.movement.blocked) return;
  const post = actor.combat?.returning?.point ?? actor.worldPosition;
  const target = context.nearestTarget(
    actor,
    guard.acquisitionRadius,
    (target) => distance(post, target.worldPosition) <= guard.chaseRadius,
  );
  if (target) context.engage(actor, target, post);
}

function canTarget(
  attacker: Actor,
  target: Actor,
  definitions: ReadonlyMap<string, ActorDefinition>,
): boolean {
  const definition = definitions.get(target.definitionId);
  return (
    target.id !== attacker.id &&
    definition?.health !== undefined &&
    target.occupancyLayer === attacker.occupancyLayer &&
    areHostile(
      definitions.get(attacker.definitionId)?.faction,
      definition.faction,
    )
  );
}

/** Distance from the attacker's center to the target's footprint or body. */
function reach(
  attacker: Actor,
  target: Actor,
  definitions: ReadonlyMap<string, ActorDefinition>,
  map: TerrainGrid | undefined,
): number {
  const definition = definitions.get(target.definitionId)!;
  if (map && isTilePlacedActor(target)) {
    return Math.min(
      ...occupiedTilesFor(target, definition).map(({ x, z }) =>
        distanceToBounds(
          attacker.worldPosition,
          tileAreaBounds(map, { minX: x, minZ: z, maxX: x, maxZ: z }),
        ),
      ),
    );
  }
  return Math.max(
    0,
    distance(attacker.worldPosition, target.worldPosition) -
      (definition.movement?.radius ?? 0),
  );
}

/** Terrain and other blocking footprints stop shots; mobile actors do not. */
function lineOfFire(attacker: Actor, target: Actor, world: CombatWorld) {
  const { map, occupancy } = world;
  if (!map) return true;
  const from = attacker.worldPosition;
  const to = target.worldPosition;
  const clearOfTerrain = terrainSightlineClear(
    map,
    {
      ...from,
      height: map.heightAtWorldPosition(from.x, from.z) + MUZZLE_HEIGHT,
    },
    { ...to, height: map.heightAtWorldPosition(to.x, to.z) + TARGET_HEIGHT },
  );
  return (
    clearOfTerrain &&
    (!occupancy ||
      forEachTileOnSegment(map, from, to, (x, z) => {
        const owner = occupancy.ownerAt(x, z, attacker.occupancyLayer);
        return (
          owner === undefined ||
          owner === attacker.id ||
          owner === target.id ||
          !occupancy.blocksMovementAt(x, z, attacker.occupancyLayer)
        );
      }))
  );
}
