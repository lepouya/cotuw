import type { Actor, ActorDefinition } from "./actor";
import { hasOwn, isIdList, isRecord } from "./validation";

export type SkirmishRules = {
  readonly owners: readonly [string, string];
  /** Completed buildings of these types keep either participant in play. */
  readonly qualifyingDefinitionIds: readonly string[];
  /** Each owner's home sites; income from any other site is expansion. */
  readonly startingResourceSites: Readonly<Record<string, readonly string[]>>;
};

/** A verdict from the player's perspective, committed with the final tick. */
export type SkirmishResult = {
  kind: "victory" | "defeat" | "draw";
  tick: number;
  eliminatedOwners: string[];
};

export function evaluateSkirmish(
  rules: SkirmishRules,
  actors: readonly Actor[],
  playerOwner: string,
  tick: number,
): SkirmishResult | undefined {
  const surviving = new Set<string>();
  for (const actor of actors)
    if (
      actor.tilePlacement &&
      !actor.construction &&
      rules.qualifyingDefinitionIds.includes(actor.definitionId)
    )
      surviving.add(actor.owner);
  const eliminatedOwners = rules.owners.filter(
    (owner) => !surviving.has(owner),
  );
  if (!eliminatedOwners.length) return;
  let kind: SkirmishResult["kind"] = "victory";
  if (eliminatedOwners.length === 2) kind = "draw";
  else if (eliminatedOwners.includes(playerOwner)) kind = "defeat";
  return {
    kind,
    tick,
    eliminatedOwners,
  };
}

/** Validates rules and the verdict against the saved final battlefield. */
export function validateSkirmish(
  rules: SkirmishRules | undefined,
  state: {
    actors: readonly Actor[];
    playerOwner: string;
    tick: number;
    commands: readonly unknown[];
    skirmishResult?: SkirmishResult;
  },
  scope: {
    owners: ReadonlySet<string>;
    definitions: ReadonlyMap<string, ActorDefinition>;
    objectives: readonly unknown[];
    siteIds: ReadonlySet<string>;
  },
): void {
  const result = state.skirmishResult;
  if (rules === undefined) {
    if (result !== undefined)
      throw new RangeError("Mission has a skirmish result without rules.");
    return;
  }
  if (
    !isRecord(rules) ||
    !isIdList(rules.owners) ||
    rules.owners.length !== 2 ||
    rules.owners.some((owner) => !scope.owners.has(owner)) ||
    !rules.owners.includes(state.playerOwner) ||
    !isIdList(rules.qualifyingDefinitionIds) ||
    !rules.qualifyingDefinitionIds.length ||
    rules.qualifyingDefinitionIds.some(
      (id) => !scope.definitions.get(id)?.footprint,
    ) ||
    !isRecord(rules.startingResourceSites) ||
    Object.keys(rules.startingResourceSites).length !== rules.owners.length ||
    rules.owners.some(
      (owner) =>
        !hasOwn(rules.startingResourceSites, owner) ||
        !isIdList(rules.startingResourceSites[owner]) ||
        rules.startingResourceSites[owner]!.some(
          (id) => !scope.siteIds.has(id),
        ),
    ) ||
    scope.objectives.length
  )
    throw new RangeError("Mission has invalid skirmish rules.");
  // Evaluation ran at the end of the last completed tick.
  const expected =
    state.tick > 0
      ? evaluateSkirmish(rules, state.actors, state.playerOwner, state.tick - 1)
      : undefined;
  if (result === undefined) {
    if (expected)
      throw new RangeError("Mission is missing its skirmish result.");
    return;
  }
  if (
    !expected ||
    !isRecord(result) ||
    result.tick !== expected.tick ||
    result.kind !== expected.kind ||
    !isIdList(result.eliminatedOwners) ||
    result.eliminatedOwners.length !== expected.eliminatedOwners.length ||
    result.eliminatedOwners.some(
      (owner, index) => owner !== expected.eliminatedOwners[index],
    ) ||
    state.commands.length
  )
    throw new RangeError("Mission has an invalid skirmish result.");
}
