import { isIdList, isRecord } from "./validation";
import type { CommandIssuer, SingleCommand } from "./command";

/**
 * Lets scripts command an owner's actors, or only the listed ones. Player
 * actors need an explicit entry.
 */
export type ScriptControl = {
  readonly owner: string;
  readonly actorIds?: readonly string[];
};

/** The staged world state authorization reads. */
export type AuthorityView = {
  ownerOf: (actorId: string) => string | undefined;
  /** The producer of a paid training order's unit. */
  producerOf: (unitId: string) => string | undefined;
};

/** Decides which actors an issuer may command or create. */
export type CommandAuthority = {
  /** Absent actors are left for the command's own rejection. */
  commands: (
    issuer: CommandIssuer,
    actorId: string,
    view: AuthorityView,
  ) => boolean;
  authorizes: (
    command: SingleCommand,
    issuer: CommandIssuer,
    view: AuthorityView,
  ) => boolean;
};

/** Each owner appears once; an `actorIds` list is nonempty. */
function validateScriptControl(
  control: readonly ScriptControl[],
  owners: ReadonlySet<string>,
) {
  const listed = new Set<string>();
  const valid =
    Array.isArray(control) &&
    Array.from(control).every((entry: unknown) => {
      if (
        !isRecord(entry) ||
        typeof entry.owner !== "string" ||
        !owners.has(entry.owner) ||
        listed.has(entry.owner) ||
        Object.keys(entry).some(
          (key) => key !== "owner" && key !== "actorIds",
        ) ||
        (entry.actorIds !== undefined &&
          (!isIdList(entry.actorIds) || !entry.actorIds.length))
      )
        return false;
      listed.add(entry.owner);
      return true;
    });
  if (!valid) throw new RangeError("Scenario has invalid script control.");
}

/**
 * Owners command their own actors. Scripts act for an owner the scenario
 * permits, and alone may edit terrain.
 */
export function createCommandAuthority(
  scriptControl: readonly ScriptControl[],
  owners: ReadonlySet<string>,
): CommandAuthority {
  const control = structuredClone(scriptControl);
  validateScriptControl(control, owners);
  const scripted = new Map(
    control.map(({ owner, actorIds }) => [
      owner,
      actorIds === undefined ? undefined : new Set(actorIds),
    ]),
  );
  /** Whether the issuer may command `actorId` for `owner`, or create it. */
  const permits = (issuer: CommandIssuer, owner: string, actorId: string) =>
    issuer.owner === owner &&
    (issuer.script !== true ||
      (scripted.has(owner) && (scripted.get(owner)?.has(actorId) ?? true)));
  const commands: CommandAuthority["commands"] = (issuer, actorId, view) => {
    const owner = view.ownerOf(actorId);
    return owner === undefined || permits(issuer, owner, actorId);
  };
  return {
    commands,
    authorizes: (command, issuer, view): boolean => {
      switch (command.kind) {
        case "terrain":
          return issuer.script === true;
        case "place-actor":
          return (
            issuer.owner !== undefined &&
            permits(issuer, issuer.owner, command.actorId) &&
            (command.workerIds ?? []).every((id) => commands(issuer, id, view))
          );
        case "train-unit":
          return commands(issuer, command.producerId, view);
        case "cancel-production": {
          const producerId = view.producerOf(command.actorId);
          return !producerId || commands(issuer, producerId, view);
        }
        case "move":
        case "attack-move":
        case "attack":
        case "stop":
        case "set-rally-point":
        case "tend":
        case "gather":
        case "assign-refinery":
        case "return-cargo":
        case "remove-actor":
        case "sell-actor":
        case "cancel-construction":
          return commands(issuer, command.actorId, view);
      }
    },
  };
}
