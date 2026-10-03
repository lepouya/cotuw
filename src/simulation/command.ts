import type { TerrainEdit } from "./terrain";
import type { ActorPlacement, PlacementReason } from "./placement";
import type { TrainingReason } from "./production";
import type { WorldPosition } from "./world";
import type { RouteBounds } from "./actor";
import type { EconomyReason } from "./economy";
import type { AttackReason } from "./combat";
import { isFinitePosition } from "./world";
import { isTileCoord } from "./grid";

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

export type AttackMoveCommand = Omit<MoveCommand, "kind"> & {
  kind: "attack-move";
};

export type GroupAttackMoveCommand = Omit<GroupMoveCommand, "kind"> & {
  kind: "group-attack-move";
};

/** Orders an armed actor to pursue and attack a detected hostile. */
export type AttackCommand = {
  kind: "attack";
  actorId: string;
  targetId: string;
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
 * `requestedTarget`, when a group member can only approach the group's click,
 * and `bounds`, for automatic routes that must stay inside an area.
 */
export type AppliedActorCommand =
  | (MoveCommand & { requestedTarget?: WorldPosition; bounds?: RouteBounds })
  | StopCommand;

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

export type SetRallyPointCommand = {
  kind: "set-rally-point";
  actorId: string;
  /** Omitted to restore exit-and-idle behavior. */
  target?: WorldPosition;
};

export type ActorLifecycleCommand =
  PlaceActorCommand | RemoveActorCommand | TrainUnitCommand;

export type EconomyCommand =
  | { kind: "gather"; actorId: string; siteId: string }
  | { kind: "assign-refinery"; actorId: string; refineryId: string }
  | { kind: "return-cargo"; actorId: string }
  | { kind: "cancel-production"; actorId: string };

export type CancelConstructionCommand = {
  kind: "cancel-construction";
  actorId: string;
};

export type SellActorCommand = { kind: "sell-actor"; actorId: string };

export const ECONOMY_COMMAND_KINDS = [
  "gather",
  "assign-refinery",
  "return-cargo",
  "cancel-production",
] as const satisfies readonly EconomyCommand["kind"][];

/** Commands that take a committed actor out of the mission. */
export const ACTOR_REMOVAL_KINDS = [
  "remove-actor",
  "sell-actor",
  "cancel-construction",
] as const;
export type ActorRemovalCommand = Extract<
  MissionCommand,
  { kind: (typeof ACTOR_REMOVAL_KINDS)[number] }
>;

export type MissionCommand =
  | ActorCommand
  | AttackCommand
  | AttackMoveCommand
  | GroupAttackMoveCommand
  | SetRallyPointCommand
  | GroupMoveCommand
  | TerrainCommand
  | ActorLifecycleCommand
  | EconomyCommand
  | SellActorCommand
  | CancelConstructionCommand;

/** A command waiting for the start of the tick numbered `tick`. */
export type ScheduledCommand = {
  tick: number;
  command: MissionCommand;
};

/** Checks saved command structure; gameplay legality is checked at its tick. */
export function isMissionCommand(value: unknown): value is MissionCommand {
  if (!value || typeof value !== "object") return false;
  const command = value as Partial<MissionCommand>;
  const id = (value: unknown) => typeof value === "string" && value.length > 0;
  switch (command.kind) {
    case "move":
    case "attack-move":
      return id(command.actorId) && isFinitePosition(command.target);
    case "group-move":
    case "group-attack-move":
      return (
        Array.isArray(command.actorIds) &&
        command.actorIds.length > 0 &&
        command.actorIds.every(id) &&
        isFinitePosition(command.target)
      );
    case "attack":
      return id(command.actorId) && id(command.targetId);
    case "set-rally-point":
      return (
        id(command.actorId) &&
        (command.target === undefined || isFinitePosition(command.target))
      );
    case "place-actor":
      return (
        id(command.actorId) &&
        id(command.definitionId) &&
        isTileCoord(command.origin) &&
        (command.quarterTurns === undefined ||
          Number.isInteger(command.quarterTurns))
      );
    case "train-unit":
      return (
        id(command.actorId) &&
        id(command.producerId) &&
        id(command.definitionId)
      );
    case "gather":
      return id(command.actorId) && id(command.siteId);
    case "assign-refinery":
      return id(command.actorId) && id(command.refineryId);
    case "stop":
    case "remove-actor":
    case "sell-actor":
    case "cancel-construction":
    case "return-cargo":
    case "cancel-production":
      return id(command.actorId);
    case "terrain":
      return (
        (command.heights === undefined ||
          (Array.isArray(command.heights) &&
            command.heights.every(
              (change) =>
                Number.isFinite(change?.height) && isTileCoord(change),
            ))) &&
        (command.tiles === undefined ||
          (Array.isArray(command.tiles) &&
            command.tiles.every((change) => {
              const tile = change?.terrain;
              return (
                isTileCoord(change) &&
                !!tile &&
                id(tile.typeId) &&
                [
                  tile.surfacePassable,
                  tile.surfaceBuildable,
                  tile.outOfBounds,
                ].every(
                  (flag) => flag === undefined || typeof flag === "boolean",
                )
              );
            })))
      );
    default:
      return false;
  }
}

type RejectionReason<C extends MissionCommand> = C extends PlaceActorCommand
  ? PlacementReason
  : C extends TrainUnitCommand
    ? TrainingReason
    : C extends EconomyCommand
      ? EconomyReason
      : C extends AttackCommand
        ? AttackReason
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
        reachedTarget?: C extends MoveCommand | AttackMoveCommand
          ? boolean
          : never;
      }
    : never;

export function isCommandOf<K extends MissionCommand["kind"]>(
  command: MissionCommand,
  kinds: readonly K[],
): command is Extract<MissionCommand, { kind: K }> {
  return (kinds as readonly string[]).includes(command.kind);
}

/** Narrows an outcome, and its rejection reason, to the given command kinds. */
export function isOutcomeOf<K extends MissionCommand["kind"]>(
  outcome: CommandOutcome,
  ...kinds: K[]
): outcome is Extract<CommandOutcome, { command: { kind: K } }> {
  return isCommandOf(outcome.command, kinds);
}
