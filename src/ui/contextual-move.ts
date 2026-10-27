import { moveCommand } from "../simulation/command";
import type {
  EconomyCommand,
  GroupMoveCommand,
  MoveCommand,
} from "../simulation/command";

type GatherCommand = Extract<EconomyCommand, { kind: "gather" }>;

/** Compatible workers gather; other units retain group movement. */
export function contextualMoveCommands(
  command: MoveCommand | GroupMoveCommand,
  workerIds: ReadonlySet<string>,
  siteId?: string,
): (GatherCommand | MoveCommand | GroupMoveCommand)[] {
  if (!siteId) return [command];
  const ids = command.kind === "move" ? [command.actorId] : command.actorIds;
  const workers = ids.filter((id) => workerIds.has(id));
  if (!workers.length) return [command];
  const queue = command.queued ? { queued: true } : {};
  const commands: (GatherCommand | MoveCommand | GroupMoveCommand)[] =
    workers.map((actorId) => ({ kind: "gather", actorId, siteId, ...queue }));
  const movers = ids.filter((id) => !workerIds.has(id));
  if (movers.length)
    commands.push(moveCommand("move", movers, command.target, command.queued));
  return commands;
}
