import type { TerrainEdit } from "../map";
import type { WorldPosition } from "./world";

/** Orders an actor to approach a target using its movement rules. */
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

/**
 * Changes a mission's simulation terrain at the start of a tick, so saves and
 * replays capture it. An invalid edit is rejected whole.
 */
export type TerrainCommand = TerrainEdit & { kind: "terrain" };

export type MissionCommand = ActorCommand | TerrainCommand;

/** A command waiting for the start of the tick numbered `tick`. */
export type ScheduledCommand = {
  tick: number;
  command: MissionCommand;
};

/** Whether the mission accepted a command at the start of `tick`. */
export type CommandOutcome = {
  tick: number;
  command: MissionCommand;
  accepted: boolean;
};
