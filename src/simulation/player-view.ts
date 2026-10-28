import { economyForOwner } from "./economy";
import { knownEconomy } from "./observations";
import { createPlayerAccess } from "./ownership";
import { isMobileActor, isTilePlacedActor } from "./placement";
import { supportForOwner } from "./support";

import type { ActorDefinition, ActorRenderState } from "./actor";
import type { MissionSimulation } from "./mission";

/**
 * Recomputes only when an input changes identity. Committed simulation state
 * is replaced rather than mutated, so identity marks every change.
 */
function cached<Inputs extends readonly unknown[], T>(
  inputs: () => Inputs,
  compute: (inputs: NoInfer<Inputs>) => T,
): () => T {
  let last: { inputs: Inputs; value: T } | undefined;
  return () => {
    const next = inputs();
    if (!last || next.some((input, index) => input !== last!.inputs[index]))
      last = { inputs: next, value: compute(next) };
    return last.value;
  };
}

/**
 * The player's ownership and fog-limited view of committed actors. Lookups
 * follow the simulation's latest committed actor list.
 */
export function createPlayerView(
  simulation: Pick<
    MissionSimulation,
    | "actors"
    | "economy"
    | "support"
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
  const actors = cached(
    // Actors and fog change only on commit, which replaces the actor list.
    () => [simulation.actors] as const,
    ([actors]) => {
      const shown = actors.filter(access.shows);
      return {
        actors,
        shown,
        byId: new Map(actors.map((actor) => [actor.id, actor])),
        ownIds: new Set(actors.filter(access.owns).map((actor) => actor.id)),
        mobile: actors.filter((actor) => !isTilePlacedActor(actor)),
        /** Tile-placed actors the player sees. */
        placed: shown.filter(isTilePlacedActor),
        shownMobile: shown.filter((actor) => !isTilePlacedActor(actor)),
      };
    },
  );
  /** Own private economy, plus sites and loot as the player last saw them. */
  const economy = cached(
    () =>
      [
        simulation.economy,
        simulation.economy &&
          simulation.knowledgeOf(simulation.playerOwner).observations,
        simulation.actors,
      ] as const,
    ([live, observations]) => {
      if (!live || !observations) return undefined;
      const { ownIds } = actors();
      return knownEconomy(
        economyForOwner(live, simulation.playerOwner, (id) => ownIds.has(id)),
        observations,
      );
    },
  );
  /** Usable support from own or detected buildings, linked among themselves. */
  const support = cached(
    () =>
      [simulation.support, simulation.actors, simulation.relations] as const,
    ([live, , relations]) => {
      if (!live) return undefined;
      const usable = supportForOwner(
        live,
        simulation.playerOwner,
        relations.sharesSupport,
      );
      const shown = new Set(actors().shown.map(({ id }) => id));
      const nodes = usable.nodes.filter(({ actorId }) => shown.has(actorId));
      return {
        nodes,
        links: usable.links.filter(
          ({ from, to }) => shown.has(from) && shown.has(to),
        ),
      };
    },
  );
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
    support,
    actor,
    shownActor: actorIf(access.shows),
    ownActor: actorIf(access.owns),
    ownMobileActor: actorIf((found) => access.owns(found) && isMobile(found)),
  };
}
