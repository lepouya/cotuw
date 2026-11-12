import { distance } from "./world";

import type { AppliedActorCommand } from "./command";
import type { Footprint, OccupancyLayer } from "./occupancy";
import type { TileCoord } from "./grid";
import type { NavigationGrid } from "./navigation";
import type { WorldPosition } from "./world";

/** Immutable, data-driven capabilities shared by a type of actor. */
export type ActorDefinition = {
  id: string;
  behaviorId: string;
  /** Faction type for roster and construction rules, not control. */
  faction?: string;
  /** Maximum health. Only actors with health can be damaged or destroyed. */
  health?: number;
  /** Armed actors attack hostile actors that have health. */
  weapon?: Weapon;
  /** An idle unit engages detected hostiles near it, then returns to post. */
  guard?: {
    /** World-space radius around the unit for automatic engagement. */
    acquisitionRadius: number;
    /** How far from its post an automatic engagement may chase. */
    chaseRadius: number;
  };
  /** An NPC that defends a home area and recovers there. */
  territory?: {
    /** Alert lifetime and route recovery tuning, in simulation seconds. */
    alertLifetimeSeconds: number;
    investigationSeconds: number;
    blockedRetrySeconds: number;
    stalledSeconds: number;
    /** Distance within which it has reached home or an alert origin. */
    arrivalTolerance: number;
    /** Default hard leash radius around the encounter center. */
    leashRadius: number;
    /** Out-of-combat time at home before health recovers. */
    regenerationDelaySeconds: number;
    regenerationPerSecond: number;
  };
  movement?: {
    speed: number;
    /** Resolves terrain rules outside actor state. */
    profileId?: string;
    /** World-space radius for friendly separation and destination spacing. */
    radius?: number;
  };
  /** Mobile actor definitions this building can train. */
  production?: { unitDefinitionIds: string[] };
  /** World-space coverage radius; completed roots start support networks. */
  support?: { radius: number; root?: boolean };
  /** World-space sight radius; terrain can still block the sightline. */
  vision?: { radius: number };
  materialsCost?: number;
  lifebloomCost?: number;
  /** Infrastructure capacity owned by this headquarters. */
  infrastructure?: { slots: number };
  /** Worker-led growth uses infrastructure without a support network. */
  growth?: { workerDefinitionId: string; headquartersDefinitionId: string };
  cultivation?: { capacity: number; rate: number };
  /** Completed buildings that receive cultivated Lifebloom. */
  cultivationDropoff?: boolean;
  trainingSeconds?: number;
  constructionSeconds?: number;
  refinery?: { harvesterDefinitionId: string };
  harvesting?: {
    capacity: number;
    loadSeconds: number;
    patchRadius: number;
  };
  /** Present when this actor type can occupy a tile-aligned footprint. */
  footprint?: Footprint;
  /** Terrain constraints used when placing its footprint. */
  placement?: {
    /** Terrain types omitted here are invalid placement surfaces. */
    terrainTypeIds: string[];
    /** Maximum grade under any occupied surface tile. */
    maxSlope: number;
  };
};

/** Fixed damage dealt at a fixed cadence, without accuracy rolls. */
export type Weapon = {
  damage: number;
  /**
   * Reserved for future armor matchups such as kinetic versus energy. Every
   * type currently deals its full damage.
   */
  damageType: string;
  /** World-space reach from the attacker's center to the target's edge. */
  range: number;
  cooldownSeconds: number;
};

/** Mutable, serializable runtime state for one actor. */
export type Actor = {
  id: string;
  definitionId: string;
  /** The controlling owner's ID; neutral actors belong to their own owner. */
  owner: string;
  worldPosition: WorldPosition;
  /** Radians clockwise from the world's positive Z axis. */
  facing: number;
  /** The actor's current tactical layer; defaults to surface in authored data. */
  occupancyLayer: OccupancyLayer;
  /** Present while the actor is deployed at a tile-aligned footprint. */
  tilePlacement?: {
    origin: TileCoord;
    /** Clockwise quarter turns around the placement origin. */
    quarterTurns: number;
  };
  /** Persistent base affiliation; headquarters affiliate with themselves. */
  headquartersId?: string;
  /** Paid blueprint progress; absent once the building is operational. */
  construction?: {
    paidCost: number;
    active?: boolean;
    completedTicks: number;
    totalTicks: number;
  };
  /** Ground destination used by newly produced units. */
  rallyPoint?: WorldPosition;
  /** Present only while a movement-capable actor has an active move order. */
  movement?: MovementOrder;
  /** Original destination retained while an aggressive move engages targets. */
  attackMove?: RouteRetryState & {
    target: WorldPosition;
    requestedTarget?: WorldPosition;
  };
  /** Current health; absent while undamaged. */
  health?: number;
  /** Present once the actor has fought, been hit, or received an attack. */
  combat?: CombatState;
  /** Present for actors whose definition has a territory. */
  territory?: TerritoryState;
  /** Orders that start in sequence once the current one ends. */
  orders?: QueuedOrder[];
};

/** An order waiting behind a mobile actor's current one. */
export type QueuedOrder =
  | {
      kind: "move" | "attack-move";
      target: WorldPosition;
      /** The group's click, when this actor's slot only approaches it. */
      requestedTarget?: WorldPosition;
    }
  | { kind: "attack"; targetId: string }
  | { kind: "gather"; siteId: string };

export type CombatState = {
  /** Present while an armed actor pursues or attacks a target. */
  attack?: AttackOrder;
  /**
   * Present while an automatic engagement or territory heads back. A blocked
   * route keeps its goal for retries.
   */
  returning?: ReturnRoute;
  /** A building's weapon aim, independent of its placement facing. */
  aimFacing?: number;
  /** The tick from which its weapon may fire again. */
  weaponReadyTick?: number;
  /** The latest tick it dealt or took damage. */
  activeTick?: number;
  /** The latest hit it took. */
  lastHit?: { attackerId: string; tick: number };
};

export type AttackOrder = RouteRetryState & {
  targetId: string;
  /** Where the target was last detected. */
  lastKnown: WorldPosition;
  /** Present for automatic engagements; the actor returns here afterward. */
  post?: WorldPosition;
};

export type ReturnRoute = RouteRetryState & { point: WorldPosition };

export const WOLF_MODES = [
  "idle-at-home",
  "alerted",
  "pursuing",
  "attacking",
  "investigating",
  "returning-home",
  "regenerating",
] as const;
export type WolfMode = (typeof WOLF_MODES)[number];

export type TerritoryState = {
  home: WorldPosition;
  /** Shared encounter center; absent uses home for a lone wolf. */
  center?: WorldPosition;
  /** Hard leash radius; absent uses the definition's. */
  radius?: number;
  /** Actors in one encounter must share its center and radius. */
  encounterId?: string;
  mode?: WolfMode;
  /** The latest tick it pursued or fought, which delays regeneration. */
  lastCombatTick?: number;
  /** Hostiles it saw last tick; any newcomer raises an alert. */
  seenTargets?: string[];
  investigation?: {
    alertId: number;
    origin: WorldPosition;
    arrivedTick?: number;
  };
  /** Where and when an approach last moved, and when it may replan. */
  progress?: RouteProgress;
  /** Stalled targets, skipped until they move or navigation changes. */
  failedTargets?: {
    targetId: string;
    position: WorldPosition;
    navigationVersion: number;
  }[];
};

/** Serializable progress and retry timing for a route watchdog. */
export type RouteProgress = {
  position: WorldPosition;
  tick: number;
  retryTick: number;
  goal?: WorldPosition;
  navigationVersion?: number;
  remainingDistance?: number;
};

/** An automatic route that retries a blocked point only after changes. */
export type RouteRetryState = {
  /**
   * A point no route could approach. It retries once its point moves away or
   * navigation changes.
   */
  blocked?: { at: WorldPosition; navigationVersion: number };
};

/** Cancels combat and aggressive movement without changing a new route. */
export function clearCombatOrders(actor: Actor): void {
  delete actor.attackMove;
  delete actor.combat?.attack;
  delete actor.combat?.returning;
}

/** Keeps routes, and contact correction, inside a circle. */
export type RouteBounds = { center: WorldPosition; radius: number };

export function insideRouteBounds(
  bounds: RouteBounds,
  point: WorldPosition,
): boolean {
  return distance(bounds.center, point) <= bounds.radius;
}

/** Straight segments between points inside a circle stay inside it. */
export function withinRouteBounds(
  bounds: RouteBounds | undefined,
  points: readonly WorldPosition[],
): boolean {
  return !bounds || points.every((point) => insideRouteBounds(bounds, point));
}

/** A move order and the route its behavior is following. */
export type MovementOrder = {
  target: WorldPosition;
  /** Group click that could only be approached, for blocked-target feedback. */
  requestedTarget?: WorldPosition;
  /** The target or closest reachable point this route will actually reach. */
  destination?: WorldPosition;
  /** False when `destination` is only an approach to the requested target. */
  reachedTarget?: boolean;
  /** Stops retries until navigation changes after a route becomes blocked. */
  blocked?: boolean;
  /** Route points; absent until the behavior plans a route. */
  waypoints?: WorldPosition[];
  /** The first tick its route waited for a search, which orders the queue. */
  queuedTick?: number;
  waypointIndex?: number;
  navigationVersion?: number;
  /** The occupancy layer the route was planned on. */
  occupancyLayer?: OccupancyLayer;
  /** Plans leaving this circle are blocked rather than followed. */
  bounds?: RouteBounds;
};

/** Current health; absent health means undamaged. */
export function healthOf(actor: Pick<Actor, "health">, max: number): number {
  return actor.health ?? max;
}

/** Whether a definition's units gather a resource for their owner. */
export const isWorkerDefinition = (
  definition: Pick<ActorDefinition, "harvesting" | "cultivation">,
) => !!definition.harvesting || !!definition.cultivation;

/** Workers, scouts, and support are unarmed or carry out economy work. */
export const isArmyUnit = (definition: ActorDefinition) =>
  !!definition.movement &&
  !!definition.weapon &&
  !definition.footprint &&
  !isWorkerDefinition(definition);

/** Buildings that turn gathered resources into income. */
export const isIncomeBuilding = (
  definition: Pick<ActorDefinition, "refinery" | "cultivationDropoff">,
) => !!definition.refinery || !!definition.cultivationDropoff;

/** Unarmed mobile units that neither gather nor build, such as scouts. */
export const isScoutUnit = (definition: ActorDefinition) =>
  !!definition.movement &&
  !!definition.vision &&
  !definition.weapon &&
  !definition.footprint &&
  !isWorkerDefinition(definition);

/** Scenario rosters may omit some of a producer's units. */
export const trainsArmy = (
  definition: ActorDefinition,
  definitions: ReadonlyMap<string, ActorDefinition>,
) =>
  !!definition.production?.unitDefinitionIds.some((id) => {
    const unit = definitions.get(id);
    return !!unit && isArmyUnit(unit);
  });

/** Orders actor IDs for deterministic iteration and tie-breaking. */
export function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Orders actors nearest-first from a point, breaking ties by ID. */
export const nearestTo =
  (point: WorldPosition) =>
  (
    a: Pick<Actor, "id" | "worldPosition">,
    b: Pick<Actor, "id" | "worldPosition">,
  ) =>
    distance(point, a.worldPosition) - distance(point, b.worldPosition) ||
    compareIds(a.id, b.id);

export type DeepReadonly<T> = T extends readonly (infer Item)[]
  ? readonly DeepReadonly<Item>[]
  : T extends object
    ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
    : T;

/** Prevents callers from mutating published state. */
export function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Copies JSON-shaped state; per-tick copies make `structuredClone` too slow. */
export function cloneData<T>(value: T): T {
  if (typeof value !== "object" || value === null) return value;
  if (Array.isArray(value)) return value.map(cloneData) as T;
  const copy: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    const child = cloneData((value as Record<string, unknown>)[key]);
    // JSON keys must remain data, including this inherited setter's name.
    if (key === "__proto__")
      Object.defineProperty(copy, key, {
        value: child,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    else copy[key] = child;
  }
  return copy as T;
}

/**
 * Committed actor state as the simulation publishes it. Owner views project
 * it before presentation.
 */
export type ActorRenderState = DeepReadonly<Actor>;

export type ActorOptions = {
  id: string;
  definitionId: string;
  owner: string;
  worldPosition: WorldPosition;
  facing?: number;
  occupancyLayer?: OccupancyLayer;
};

/** Creates mutable state without choosing a renderer or executable behavior. */
export function createActor({
  id,
  definitionId,
  owner,
  worldPosition,
  facing = 0,
  occupancyLayer = "surface",
}: ActorOptions): Actor {
  return {
    id,
    definitionId,
    owner,
    worldPosition: { ...worldPosition },
    facing,
    occupancyLayer,
  };
}

/**
 * Trusted code for one serializable behavior ID. Behaviors change only their
 * staged actors; mission mutation methods cannot run within a tick.
 */
export type ActorBehavior = {
  /** Read-only navigation queries for group orders and local separation. */
  navigationGrid?: (
    actor: Readonly<Actor>,
    definition: ActorDefinition,
    bounds?: RouteBounds,
  ) => NavigationGrid;
  /**
   * Applies a validated command addressed to this actor. Move targets are
   * already inside the world bounds. Returns whether the actor accepted it.
   */
  handleCommand: (
    actor: Actor,
    definition: ActorDefinition,
    command: AppliedActorCommand,
  ) => boolean;
  update: (actor: Actor, definition: ActorDefinition, seconds: number) => void;
  /**
   * Runs before the tick's updates with every actor using this behavior, so
   * it can share per-tick work, such as route searches, among them.
   */
  prepareUpdates?: (
    actors: readonly { actor: Actor; definition: ActorDefinition }[],
    tick: number,
  ) => void;
  /** Throws when a definition cannot run this behavior. */
  validateDefinition?: (definition: ActorDefinition) => void;
  /** Throws when behavior-owned actor state is invalid. */
  validateActor?: (actor: Actor, definition: ActorDefinition) => void;
  /**
   * Whether this definition's actors may stand on a tile's terrain, ignoring
   * actors and footprints. Production definitions require it of their units.
   */
  canStandAt?: (definition: ActorDefinition, tile: TileCoord) => boolean;
};
