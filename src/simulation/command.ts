import type { TerrainEdit } from "./terrain";
import type { ActorPlacement, PlacementReason } from "./placement";
import type { TrainingReason } from "./production";
import type { WorldPosition } from "./world";

/** Orders an actor to approach a target using its movement rules. */
export type MoveCommand = {
  kind: "move";
  actorId: string;
  target: WorldPosition;
};

/** Assigns distinct reachable destinations at the start of the tick. */
export type GroupMoveCommand = {
  kind: "group-move";
  actorIds: string[];
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
 * An actor command as its behavior receives it. Only the mission adds
 * `requestedTarget`, when a group member can only approach the group's click.
 */
export type AppliedActorCommand =
  (MoveCommand & { requestedTarget?: WorldPosition }) | StopCommand;

/**
 * Changes a mission's simulation terrain at the start of a tick, so saves and
 * replays capture it. An invalid edit is rejected whole.
 */
export type TerrainCommand = TerrainEdit & { kind: "terrain" };

/** Places one definition-backed actor footprint at the start of a tick. */
export type PlaceActorCommand = ActorPlacement & { kind: "place-actor" };

/** Removes an actor by its stable ID. */
export type RemoveActorCommand = {
  kind: "remove-actor";
  actorId: string;
};

/** Trains one unit beside its producer at the start of a tick. */
export type TrainUnitCommand = {
  kind: "train-unit";
  producerId: string;
  actorId: string;
  definitionId: string;
};

export type ActorLifecycleCommand =
  PlaceActorCommand | RemoveActorCommand | TrainUnitCommand;

export type MissionCommand =
  ActorCommand | GroupMoveCommand | TerrainCommand | ActorLifecycleCommand;

/** A command waiting for the start of the tick numbered `tick`. */
export type ScheduledCommand = {
  tick: number;
  command: MissionCommand;
};

type RejectionReason<C extends MissionCommand> = C extends PlaceActorCommand
  ? PlacementReason
  : C extends TrainUnitCommand
    ? TrainingReason
    : never;

/** Whether the mission accepted a command at the start of `tick`. */
export type CommandOutcome<C extends MissionCommand = MissionCommand> =
  C extends MissionCommand
    ? {
        tick: number;
        command: C;
        accepted: boolean;
        /** Why the command was rejected, as evaluated at command application. */
        reason?: RejectionReason<C>;
        /** Whether the move's requested point was reachable at application. */
        reachedTarget?: C extends MoveCommand ? boolean : never;
      }
    : never;

/** Narrows an outcome, and its rejection reason, to one command kind. */
export function isOutcomeOf<K extends MissionCommand["kind"]>(
  outcome: CommandOutcome,
  kind: K,
): outcome is CommandOutcome<Extract<MissionCommand, { kind: K }>> {
  return outcome.command.kind === kind;
}
