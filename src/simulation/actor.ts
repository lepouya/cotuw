import type { AppliedActorCommand } from "./command";
import type { Footprint, OccupancyLayer } from "./occupancy";
import type { TileCoord } from "./grid";
import type { NavigationGrid } from "./navigation";
import type { WorldPosition } from "./world";

/** Immutable, data-driven capabilities shared by a type of actor. */
export type ActorDefinition = {
  id: string;
  behaviorId: string;
  movement?: {
    speed: number;
    /** Resolves terrain rules outside actor state. */
    profileId?: string;
    /** World-space radius for friendly separation and destination spacing. */
    radius?: number;
  };
  /** Mobile actor definitions this building can train. */
  production?: { unitDefinitionIds: string[] };
  materialsCost?: number;
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

/** Mutable, serializable runtime state for one actor. */
export type Actor = {
  id: string;
  definitionId: string;
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
  /** Paid blueprint progress; absent once the building is operational. */
  construction?: {
    paidMaterials: number;
    completedTicks: number;
    totalTicks: number;
  };
  /** Present only while a movement-capable actor has an active move order. */
  movement?: MovementOrder;
};

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
  /** Route points; absent on legacy or behavior-specific orders. */
  waypoints?: WorldPosition[];
  waypointIndex?: number;
  navigationVersion?: number;
  /** The occupancy layer the route was planned on. */
  occupancyLayer?: OccupancyLayer;
};

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

/** The immutable subset of actor state a renderer needs to present an actor. */
export type ActorRenderState = DeepReadonly<
  Pick<
    Actor,
    | "id"
    | "definitionId"
    | "worldPosition"
    | "facing"
    | "occupancyLayer"
    | "tilePlacement"
    | "movement"
    | "construction"
  >
>;

export type ActorOptions = {
  id: string;
  definitionId: string;
  worldPosition: WorldPosition;
  facing?: number;
  occupancyLayer?: OccupancyLayer;
};

/** Creates mutable state without choosing a renderer or executable behavior. */
export function createActor({
  id,
  definitionId,
  worldPosition,
  facing = 0,
  occupancyLayer = "surface",
}: ActorOptions): Actor {
  return {
    id,
    definitionId,
    worldPosition: { ...worldPosition },
    facing,
    occupancyLayer,
  };
}

/** Trusted code for one serializable behavior ID. It is never actor state. */
export type ActorBehavior = {
  /** Read-only navigation queries for group orders and local separation. */
  navigationGrid?: (
    actor: Readonly<Actor>,
    definition: ActorDefinition,
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
