import { isId, isOneOf, isRecord } from "./validation";

import type { ActorDefinition, ActorRenderState } from "./actor";

/** A participant that controls actors, independent of their faction types. */
export type Owner = {
  id: string;
  /** The faction this participant plays, for its labels, prices, and music. */
  faction?: string;
};

export const RELATIONSHIPS = ["allied", "neutral", "hostile"] as const;
export type Relationship = (typeof RELATIONSHIPS)[number];

/** A saved pair's mutual relationship; pairs without one are neutral. */
export type OwnerRelationship = {
  owners: [string, string];
  relationship: Exclude<Relationship, "neutral">;
  /** Allies cover each other's construction and power with support. */
  sharesSupport?: true;
  /** Allies' buildings may use each other's headquarters queues. */
  sharesHeadquarters?: true;
};

/** Services a scenario may let allies share, independently of each other. */
const SHARING = ["sharesSupport", "sharesHeadquarters"] as const;

/** A requested relationship; `neutral` removes the pair's saved entry. */
export type RelationshipChange = {
  readonly owners: readonly [string, string];
  readonly relationship: Relationship;
  readonly sharesSupport?: true;
  readonly sharesHeadquarters?: true;
};

type OwnerPair = { readonly owners: readonly [string, string] };

const samePair = (left: OwnerPair, right: OwnerPair) =>
  (left.owners[0] === right.owners[0] && left.owners[1] === right.owners[1]) ||
  (left.owners[0] === right.owners[1] && left.owners[1] === right.owners[0]);

/** Looks entries up by unordered owner pair in either order. */
function indexPairs<T extends OwnerPair>(entries: readonly T[]) {
  const index = new Map<string, Map<string, T>>();
  const add = (from: string, to: string, entry: T) => {
    const row = index.get(from) ?? new Map<string, T>();
    index.set(from, row.set(to, entry));
  };
  for (const entry of entries) {
    add(entry.owners[0], entry.owners[1], entry);
    add(entry.owners[1], entry.owners[0], entry);
  }
  return (left: string, right: string) => index.get(left)?.get(right);
}

/** Relationship rules between owners; an owner is allied with itself. */
export function createRelations(relationships: readonly OwnerRelationship[]) {
  const entryFor = indexPairs(relationships);
  const relationship = (left: string, right: string): Relationship =>
    left === right
      ? "allied"
      : (entryFor(left, right)?.relationship ?? "neutral");
  return {
    relationship,
    hostile: (left: string, right: string) =>
      relationship(left, right) === "hostile",
    sharesVision: (left: string, right: string) =>
      relationship(left, right) === "allied",
    sharesSupport: (left: string, right: string) =>
      left === right || !!entryFor(left, right)?.sharesSupport,
    sharesHeadquarters: (left: string, right: string) =>
      left === right || !!entryFor(left, right)?.sharesHeadquarters,
  };
}

/** The current rules; a relationship change replaces the whole view. */
export type Relations = ReturnType<typeof createRelations>;

/** Applies a change; sharing the change does not name is revoked. */
export function setRelationship(
  relationships: OwnerRelationship[],
  change: RelationshipChange,
): void {
  const index = relationships.findIndex((entry) => samePair(entry, change));
  if (index >= 0) relationships.splice(index, 1);
  if (change.relationship === "neutral") return;
  const entry: OwnerRelationship = {
    owners: [...change.owners],
    relationship: change.relationship,
  };
  for (const service of SHARING) if (change[service]) entry[service] = true;
  relationships.push(entry);
}

/** Whether a change names two distinct known owners and permitted sharing. */
export function isRelationshipChange(
  value: unknown,
  ownerIds: ReadonlySet<string>,
  allowed: readonly Relationship[] = RELATIONSHIPS,
): value is RelationshipChange {
  if (!isRecord(value)) return false;
  const { owners, relationship } = value;
  return (
    Array.isArray(owners) &&
    owners.length === 2 &&
    owners[0] !== owners[1] &&
    owners.every((id) => ownerIds.has(id)) &&
    isOneOf(allowed, relationship) &&
    SHARING.every(
      (service) =>
        value[service] === undefined ||
        (value[service] === true && relationship === "allied"),
    )
  );
}

/** Throws unless each saved pair is a valid change listed once. */
export function validateRelationships(
  relationships: readonly OwnerRelationship[],
  ownerIds: ReadonlySet<string>,
): void {
  if (
    !Array.isArray(relationships) ||
    relationships.some(
      (entry, index) =>
        !isRelationshipChange(entry, ownerIds, ["allied", "hostile"]) ||
        relationships.slice(0, index).some((other) => samePair(other, entry)),
    )
  )
    throw new RangeError("Mission state has invalid owner relationships.");
}

export type PlayerRelation = "own" | Relationship;

export function playerRelation(
  playerOwner: string,
  owner: string,
  relationship: (left: string, right: string) => Relationship,
): PlayerRelation {
  return owner === playerOwner ? "own" : relationship(playerOwner, owner);
}

/** The faction the player plays, if the mission names one. */
export function playerFactionOf(state: {
  owners: readonly Owner[];
  playerOwner: string;
}): string | undefined {
  return state.owners.find(({ id }) => id === state.playerOwner)?.faction;
}

/** Without a player faction, as in free construction, every type is listed. */
export function rosterIncludes(
  playerFaction: string | undefined,
  definition: Pick<ActorDefinition, "faction">,
): boolean {
  return playerFaction === undefined || definition.faction === playerFaction;
}

/** Returns the owner IDs; throws unless distinct and including the player. */
export function validateOwners(
  owners: readonly Owner[],
  playerOwner: string,
): Set<string> {
  if (
    !Array.isArray(owners) ||
    owners.some(
      (owner) =>
        typeof owner !== "object" ||
        !owner ||
        !isId(owner.id) ||
        (owner.faction !== undefined && !isId(owner.faction)),
    ) ||
    new Set(owners.map(({ id }) => id)).size !== owners.length
  )
    throw new RangeError("Mission owners need distinct IDs and faction IDs.");
  const ids = new Set(owners.map(({ id }) => id));
  if (!ids.has(playerOwner))
    throw new RangeError("Mission state has an unknown player owner.");
  return ids;
}

/** Anything with a definition and position, such as an actor or its remains. */
export type Detectable = Pick<
  ActorRenderState,
  "worldPosition" | "definitionId"
> &
  Partial<Pick<ActorRenderState, "id" | "tilePlacement">>;

/** Shared ownership and visibility rules for player presentation and controls. */
export function createPlayerAccess(
  playerOwner: string,
  relationship: (left: string, right: string) => Relationship,
  detects: (owner: string, actor: Detectable) => boolean = () => true,
) {
  const owns = (actor: Pick<ActorRenderState, "owner">) =>
    actor.owner === playerOwner;
  return {
    relationTo: (actor: Pick<ActorRenderState, "owner">) =>
      playerRelation(playerOwner, actor.owner, relationship),
    owns,
    shows: (actor: Detectable & Pick<ActorRenderState, "owner">) =>
      owns(actor) || detects(playerOwner, actor),
  };
}

export type PlayerAccess = ReturnType<typeof createPlayerAccess>;
