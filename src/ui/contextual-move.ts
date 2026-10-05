import type {
  EconomyCommand,
  GroupMoveCommand,
  MoveCommand,
} from "../simulation/command";

type GatherCommand = Extract<EconomyCommand, { kind: "gather" }>;

/** Harvesters gather at a resource target; other units retain group movement. */
export function contextualMoveCommands(
  command: MoveCommand | GroupMoveCommand,
  harvesterIds: ReadonlySet<string>,
  siteId?: string,
): (GatherCommand | MoveCommand | GroupMoveCommand)[] {
  if (!siteId) return [command];
  const ids = command.kind === "move" ? [command.actorId] : command.actorIds;
  const workers = ids.filter((id) => harvesterIds.has(id));
  if (!workers.length) return [command];
  const commands: (GatherCommand | MoveCommand | GroupMoveCommand)[] =
    workers.map((actorId) => ({ kind: "gather", actorId, siteId }));
  const movers = ids.filter((id) => !harvesterIds.has(id));
  if (movers.length === 1)
    commands.push({
      kind: "move",
      actorId: movers[0]!,
      target: command.target,
    });
  else if (movers.length > 1)
    commands.push({ ...command, kind: "group-move", actorIds: movers });
  return commands;
}
