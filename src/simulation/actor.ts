import type { ActorCommand } from "./command";
import type { WorldPosition } from "./world";

/** Immutable, data-driven capabilities shared by a type of actor. */
export type ActorDefinition = {
  id: string;
  behaviorId: string;
  movement?: {
    speed: number;
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
  /** Present only while a movement-capable actor has a direct move order. */
  movement?: {
    target: WorldPosition;
  };
};

/** The immutable subset of actor state a renderer needs to present an actor. */
export type ActorRenderState = {
  readonly id: string;
  readonly definitionId: string;
  readonly worldPosition: Readonly<WorldPosition>;
  readonly facing: number;
};

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
};
