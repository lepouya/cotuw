import type { ActorDefinition, ActorRenderState } from "./actor";

/** Actors of different factions are hostile; an actor without one is neutral. */
export function areHostile(
  left: string | undefined,
  right: string | undefined,
): boolean {
  return left !== undefined && right !== undefined && left !== right;
}

export type PlayerRelation = "own" | "hostile" | "neutral";

/** Without a player faction, as in the sandbox, the player owns every actor. */
export function playerRelation(
  playerFaction: string | undefined,
  faction: string | undefined,
): PlayerRelation {
  if (playerFaction === undefined || faction === playerFaction) return "own";
  return faction === undefined ? "neutral" : "hostile";
}

/** Shared ownership and visibility rules for player presentation and controls. */
export function createPlayerAccess(
  playerFaction: string | undefined,
  definitions: ReadonlyMap<string, ActorDefinition>,
  detects: (
    faction: string | undefined,
    actor: ActorRenderState,
  ) => boolean = () => true,
) {
  const relationTo = (definitionId: string) =>
    playerRelation(playerFaction, definitions.get(definitionId)?.faction);
  const owns = (actor: Pick<ActorRenderState, "definitionId">) =>
    relationTo(actor.definitionId) === "own";
  return {
    relationTo,
    owns,
    shows: (actor: ActorRenderState) =>
      owns(actor) || detects(playerFaction, actor),
  };
}
