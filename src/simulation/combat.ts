import { forEachTileOnSegment } from "./navigation";
import { isTilePlacedActor, occupiedTilesFor } from "./placement";
import { distance, isFinitePosition, withinBounds } from "./world";
import { secondsToTicks } from "./clock";
import { followRoute } from "./automatic-movement";
import { terrainSightlineClear } from "./terrain-sightline";
import { areHostile } from "./faction";
import { compareIds, healthOf } from "./actor";
import {
  leashBounds,
  planTerritory,
  regenerate,
  validateTerritoryActor,
  validateTerritoryDefinition,
} from "./territory";

import type {
  Actor,
  ActorDefinition,
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

/** What targeting rules such as guards and territories may do each tick. */
export type CombatContext = {
  readonly tick: number;
  readonly tickSeconds: number;
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
  definitions: ReadonlyMap<string, ActorDefinition>;
  map?: TerrainGrid;
  occupancy?: OccupancyView;
  /** Whether a faction currently detects the actor. */
  detects: (faction: string | undefined, target: Actor) => boolean;
  /** Starts a route; returns whether the actor accepted it. */
  move: (actor: Actor, target: WorldPosition, bounds?: RouteBounds) => boolean;
  /** Takes a destroyed actor out of the mission. */
  destroy: (actor: Actor) => void;
};

const positive = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value > 0;
const isTick = (value: unknown) =>
  Number.isSafeInteger(value) && (value as number) >= 0;
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
  const { health, combat } = actor;
  const point = (value: unknown) =>
    !!value &&
    isFinitePosition(value as WorldPosition) &&
    withinBounds(value as WorldPosition, bounds);
  const retry = ({ blocked }: RouteRetryState) =>
    blocked === undefined ||
    (!!blocked && point(blocked.at) && isTick(blocked.navigationVersion));
  const { attack, returning, aimFacing } = combat ?? {};
  if (
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
): void {
  delete actor.combat?.returning;
  (actor.combat ??= {}).attack = {
    targetId: target.id,
    lastKnown: { ...target.worldPosition },
    ...(post && { post: { ...post } }),
  };
  delete actor.movement;
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
  const sorted = [...world.actors].sort((a, b) => compareIds(a.id, b.id));
  const definitionOf = (actor: Actor) => definitions.get(actor.definitionId)!;
  const targetable = (actor: Actor, target: Actor | undefined) =>
    !!target && canTarget(actor, target, definitions);
  const detected = (actor: Actor, target: Actor) =>
    world.detects(definitionOf(actor).faction, target);
  const engageable = (actor: Actor, target: Actor | undefined) =>
    targetable(actor, target) && detected(actor, target!);
  const arrived = (actor: Actor, point: WorldPosition) =>
    distance(actor.worldPosition, point) <= ARRIVAL_RADIUS;
  const continueReturn = (actor: Actor) => {
    const returning = actor.combat?.returning;
    if (!returning) return false;
    if (arrived(actor, returning.point)) {
      delete actor.combat!.returning;
      delete actor.movement;
      return false;
    }
    return followRoute(actor, returning.point, returning, world);
  };
  const startReturn = (actor: Actor, point: WorldPosition) => {
    const combat = (actor.combat ??= {});
    if (!combat.returning || distance(combat.returning.point, point) > 0)
      combat.returning = { point: { ...point } };
    return continueReturn(actor);
  };
  const endAttack = (actor: Actor) => {
    const post = actor.combat?.attack?.post;
    delete actor.combat?.attack;
    delete actor.movement;
    if (post) startReturn(actor, post);
  };
  const context: CombatContext = {
    tick,
    tickSeconds: world.tickSeconds,
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

  /** Territorial chases stay inside the leash. */
  const chase = (actor: Actor, point: WorldPosition) => {
    const bounds = leashBounds(actor, definitionOf(actor));
    followRoute(actor, point, actor.combat!.attack!, {
      navigationVersion: world.navigationVersion,
      move: (mover, target) => world.move(mover, target, bounds),
    });
  };
  const movable = (actor: Actor) => !!definitionOf(actor).movement;

  /** Validates the order and returns the target to fire at, if any. */
  const followOrder = (actor: Actor): Actor | undefined => {
    const order = actor.combat!.attack!;
    const target = byId.get(order.targetId);
    if (!targetable(actor, target)) return void endAttack(actor);
    if (!detected(actor, target!)) {
      // Hidden movement is unknown; search where it was last seen.
      if (order.post || !movable(actor) || arrived(actor, order.lastKnown))
        return void endAttack(actor);
      chase(actor, order.lastKnown);
      if (order.blocked) endAttack(actor);
      return undefined;
    }
    order.lastKnown = { ...target!.worldPosition };
    return target;
  };

  const hits: AttackEvent[] = [];
  for (const actor of sorted) {
    const definition = definitionOf(actor);
    const weapon = definition.weapon;
    if (!weapon) continue;
    if (
      definition.territory &&
      !planTerritory(actor, definition.territory, context)
    )
      continue;
    if (definition.guard) planGuard(actor, definition.guard, context);
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
    else {
      const definition = definitionOf(actor);
      if (definition.territory)
        regenerate(actor, definition.territory, definition.health!, context);
    }
  return hits;
}

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
    if (order.post && distance(order.post, order.lastKnown) > guard.chaseRadius)
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
  const { x, z } = attacker.worldPosition;
  if (map && isTilePlacedActor(target)) {
    return Math.min(
      ...occupiedTilesFor(target, definition).map((tile) => {
        const low = map.worldPositionAt(tile.x, tile.z);
        const high = map.worldPositionAt(tile.x + 1, tile.z + 1);
        return distance(attacker.worldPosition, {
          x: Math.min(Math.max(x, low.x), high.x),
          z: Math.min(Math.max(z, low.z), high.z),
        });
      }),
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
