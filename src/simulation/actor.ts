import type { ActorCommand } from "./command";
import type { WorldPosition } from "./world";

/** Immutable, data-driven capabilities shared by a type of actor. */
export type ActorDefinition = {
  id: string;
  behaviorId: string;
  movement?: {
    speed: number;
    /** Resolves terrain rules outside actor state. */
    profileId?: string;
  };
  /** Render-only; the simulation never reads it. */
  graphics?: ActorGraphics;
};

/** How a type of actor is drawn. */
export type ActorGraphics = {
  /** A glTF binary (`.glb`) holding the model, skin, and clips. */
  url: string;
  /** Minimap marker color, in 0-1 channels. */
  minimapColor?: [number, number, number];
  /** A cylinder on the ground point that picking and selection use. */
  bounds: { radius: number; height: number };
  clips: ActorClips;
  /** Ground units traveled during one locomotion clip cycle. */
  cycleDistance: number;
};

/** Animation clip names within an actor's model. */
export type ActorClips = {
  idle: string;
  locomotion: string;
  /**
   * Leans layered over idle and locomotion while turning. Each starts at the
   * neutral pose and ends at the full lean.
   */
  turn?: { left: string; right: string };
};

/** Mutable, serializable runtime state for one actor. */
export type Actor = {
  id: string;
  definitionId: string;
  worldPosition: WorldPosition;
  /** Radians clockwise from the world's positive Z axis. */
  facing: number;
  /** Present only while a movement-capable actor has an active move order. */
  movement?: MovementOrder;
};

/** A move order and the route its behavior is following. */
export type MovementOrder = {
  target: WorldPosition;
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
};

type DeepReadonly<T> = T extends readonly (infer Item)[]
  ? readonly DeepReadonly<Item>[]
  : T extends object
    ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
    : T;

/** The immutable subset of actor state a renderer needs to present an actor. */
export type ActorRenderState = DeepReadonly<
  Pick<Actor, "id" | "definitionId" | "worldPosition" | "facing" | "movement">
>;

export type ActorOptions = {
  id: string;
  definitionId: string;
  worldPosition: WorldPosition;
  facing?: number;
};

/** Creates mutable state without choosing a renderer or executable behavior. */
export function createActor({
  id,
  definitionId,
  worldPosition,
  facing = 0,
}: ActorOptions): Actor {
  return {
    id,
    definitionId,
    worldPosition: { ...worldPosition },
    facing,
  };
}

/** Trusted code for one serializable behavior ID. It is never actor state. */
export type ActorBehavior = {
  /**
   * Applies a validated command addressed to this actor. Move targets are
   * already inside the world bounds. Returns whether the actor accepted it.
   */
  handleCommand: (
    actor: Actor,
    definition: ActorDefinition,
    command: ActorCommand,
  ) => boolean;
  update: (actor: Actor, definition: ActorDefinition, seconds: number) => void;
  /** Throws when a definition cannot run this behavior. */
  validateDefinition?: (definition: ActorDefinition) => void;
  /** Throws when behavior-owned actor state is invalid. */
  validateActor?: (actor: Actor, definition: ActorDefinition) => void;
};
