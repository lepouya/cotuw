import { knownEconomy } from "./observations";
import { createPlayerAccess } from "./ownership";
import { isMobileActor, isTilePlacedActor } from "./placement";

import type { ActorDefinition, ActorRenderState } from "./actor";
import type { EconomyView } from "./economy";
import type { MissionSimulation } from "./mission";
import type { OwnerKnowledge } from "./observations";

/**
 * The player's ownership and fog-limited view of committed actors. Lookups
 * follow the simulation's latest committed actor list.
 */
export function createPlayerView(
  simulation: Pick<
    MissionSimulation,
    | "actors"
    | "economy"
    | "playerOwner"
    | "relations"
    | "detects"
    | "knowledgeOf"
  >,
  definitions: ReadonlyMap<string, ActorDefinition>,
) {
  const access = createPlayerAccess(
    simulation.playerOwner,
    (left, right) => simulation.relations.relationship(left, right),
    simulation.detects,
  );
  const isMobile = (actor: ActorRenderState) =>
    isMobileActor(actor, definitions.get(actor.definitionId));
  /** Committed actors grouped for the player's views and controls. */
  const group = (actors: readonly ActorRenderState[]) => {
    const mobile = actors.filter((actor) => !isTilePlacedActor(actor));
    return {
      actors,
      byId: new Map(actors.map((actor) => [actor.id, actor])),
      ownIds: new Set(actors.filter(access.owns).map((actor) => actor.id)),
      mobile,
      /** Tile-placed actors the player sees. */
      placed: actors.filter(isTilePlacedActor).filter(access.shows),
      shownMobile: mobile.filter(access.shows),
    };
  };
  // Actors and fog change only on commit, which replaces the actor list.
  let grouped = group(simulation.actors);
  const actors = () => {
    if (grouped.actors !== simulation.actors)
      grouped = group(simulation.actors);
    return grouped;
  };
  let known:
    | {
        live: EconomyView;
        observations: OwnerKnowledge["observations"];
        view: EconomyView;
      }
    | undefined;
  /** The economy with sites and loot as the player last saw them. */
  const economy = () => {
    const live = simulation.economy;
    if (!live) return undefined;
    const { observations } = simulation.knowledgeOf(simulation.playerOwner);
    // Both are replaced, never mutated, when they change.
    if (known?.live !== live || known.observations !== observations)
      known = { live, observations, view: knownEconomy(live, observations) };
    return known.view;
  };
  const actor = (id: string | undefined) =>
    id === undefined ? undefined : actors().byId.get(id);
  /** The committed actor with this ID, if it passes `keep`. */
  const actorIf =
    (keep: (actor: ActorRenderState) => boolean) =>
    (id: string | undefined) => {
      const found = actor(id);
      return found && keep(found) ? found : undefined;
    };
  return {
    ...access,
    isMobile,
    actors,
    economy,
    actor,
    shownActor: actorIf(access.shows),
    ownActor: actorIf(access.owns),
    ownMobileActor: actorIf((found) => access.owns(found) && isMobile(found)),
  };
}
