import type { WorldPosition } from "./world";

/** Orders an actor straight to a target. */
export type MoveCommand = {
  kind: "move";
  actorId: string;
  target: WorldPosition;
};

/** Cancels an actor's current order. */
export type StopCommand = {
  kind: "stop";
  actorId: string;
};

/**
 * Serializable orders shared by players, NPC AI, and mission scripts. Every
 * change they make to actors happens at the start of a tick.
 */
export type ActorCommand = MoveCommand | StopCommand;

/** A command waiting for the start of the tick numbered `tick`. */
export type ScheduledCommand = {
  tick: number;
  command: ActorCommand;
};

/** Whether an actor accepted a command at the start of `tick`. */
export type CommandOutcome = {
  tick: number;
  command: ActorCommand;
  accepted: boolean;
};
