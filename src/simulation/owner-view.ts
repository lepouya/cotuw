import { economyForOwner } from "./economy";
import { knownEconomy } from "./observations";
import { ownerRelation } from "./ownership";
import { isMobileActor, isTilePlacedActor } from "./placement";
import { supportForOwner } from "./support";

import type {
  Actor,
  ActorDefinition,
  ActorRenderState,
  AttackOrder,
  CombatState,
  DeepReadonly,
  TerritoryState,
} from "./actor";
import type { MissionSimulation } from "./mission";
import type { OwnerKnowledge } from "./observations";
import type { Detectable } from "./vision";

/**
 * What an owner sees of another owner's detected actor: its pose, condition,
 * and visible activity, without its orders, routes, base links, or payments.
 */
export type ObservedActor = DeepReadonly<
  Pick<
    Actor,
    | "id"
    | "definitionId"
    | "owner"
    | "worldPosition"
    | "facing"
    | "occupancyLayer"
    | "tilePlacement"
    | "health"
  > & {
    construction?: Omit<NonNullable<Actor["construction"]>, "paidCost">;
    combat?: Pick<CombatState, "aimFacing" | "activeTick"> & {
      /** Present while it attacks an actor the viewer also sees. */
      attack?: Pick<AttackOrder, "targetId">;
    };
    territory?: Pick<TerritoryState, "mode">;
  }
>;

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

function observedActor(
  actor: ActorRenderState,
  shownIds: ReadonlySet<string>,
): ObservedActor {
  const { construction, combat, territory } = actor;
  const targetId = combat?.attack?.targetId;
  return {
    id: actor.id,
    definitionId: actor.definitionId,
    owner: actor.owner,
    worldPosition: actor.worldPosition,
    facing: actor.facing,
    occupancyLayer: actor.occupancyLayer,
    ...(actor.tilePlacement && { tilePlacement: actor.tilePlacement }),
    ...(actor.health !== undefined && { health: actor.health }),
    ...(construction && {
      construction: {
        completedTicks: construction.completedTicks,
        totalTicks: construction.totalTicks,
        ...(construction.active !== undefined && {
          active: construction.active,
        }),
      },
    }),
    ...(combat && {
      combat: {
        ...(combat.aimFacing !== undefined && { aimFacing: combat.aimFacing }),
        ...(combat.activeTick !== undefined && {
          activeTick: combat.activeTick,
        }),
        ...(targetId !== undefined &&
          shownIds.has(targetId) && { attack: { targetId } }),
      },
    }),
    ...(territory?.mode && { territory: { mode: territory.mode } }),
  };
}

/**
 * One owner's legal view of the committed mission: its own actors and private
 * economy, what it currently detects of others, and its knowledge. Player
 * presentation and AI planning read the same view. Lookups follow the
 * simulation's latest committed state.
 */
export function createOwnerView({
  simulation,
  knowledge,
  faction,
  definitions,
}: {
  simulation: Pick<
    MissionSimulation,
    "actors" | "economy" | "support" | "wrecks" | "relations" | "detects"
  >;
  knowledge: OwnerKnowledge;
  /** The owner's faction, for its labels, prices, and music. */
  faction: string | undefined;
  definitions: ReadonlyMap<string, ActorDefinition>;
}) {
  const { owner } = knowledge;
  const owns = (actor: Pick<ActorRenderState, "owner">) =>
    actor.owner === owner;
  const shows = (actor: Detectable & Pick<ActorRenderState, "owner">) =>
    owns(actor) || simulation.detects(owner, actor);
  const isMobile = (
    actor: Pick<ActorRenderState, "definitionId" | "tilePlacement">,
  ) => isMobileActor(actor, definitions.get(actor.definitionId));
  /** Committed actors this owner may see, grouped for views and controls. */
  const actors = cached(
    // Actors and vision change only on commit, which replaces the actor list.
    () => [simulation.actors] as const,
    ([committed]) => {
      const byId = new Map(committed.map((actor) => [actor.id, actor]));
      const shownIds = new Set(
        committed.filter(shows).map((actor) => actor.id),
      );
      /** Own actors name an attacker only while this owner detects it. */
      const withPerceivedHit = (actor: ActorRenderState): ActorRenderState => {
        const hit = actor.combat?.lastHit;
        const attacker = hit && byId.get(hit.attackerId);
        if (!hit || (attacker && simulation.detects(owner, attacker)))
          return actor;
        const { lastHit: _lastHit, ...combat } = actor.combat!;
        return { ...actor, combat };
      };
      const own = committed.filter(owns).map(withPerceivedHit);
      const ownById = new Map(own.map((actor) => [actor.id, actor]));
      const shown = committed.flatMap((actor): ObservedActor[] => {
        const found = ownById.get(actor.id);
        if (found) return [found];
        return shownIds.has(actor.id) ? [observedActor(actor, shownIds)] : [];
      });
      return {
        own,
        ownById,
        ownIds: new Set(ownById.keys()),
        ownMobile: own.filter((actor) => !isTilePlacedActor(actor)),
        shown,
        shownById: new Map(shown.map((actor) => [actor.id, actor])),
        placed: shown.filter(isTilePlacedActor),
        shownMobile: shown.filter((actor) => !isTilePlacedActor(actor)),
      };
    },
  );
  /** Own private economy, plus sites and loot as this owner last saw them. */
  const economy = cached(
    () =>
      [
        simulation.economy,
        simulation.economy && knowledge.observations,
        simulation.actors,
      ] as const,
    ([live, observations]) => {
      if (!live || !observations) return undefined;
      const { ownIds } = actors();
      return knownEconomy(
        economyForOwner(live, owner, (id) => ownIds.has(id)),
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
      const usable = supportForOwner(live, owner, relations.sharesSupport);
      const { shownById } = actors();
      return {
        nodes: usable.nodes.filter(({ actorId }) => shownById.has(actorId)),
        links: usable.links.filter(
          ({ from, to }) => shownById.has(from) && shownById.has(to),
        ),
      };
    },
  );
  /** Remains of own actors, and others' remains while detected. */
  const wrecks = cached(
    () => [simulation.wrecks, simulation.actors] as const,
    ([committed]) => committed.filter(shows),
  );
  const ownActor = (id: string | undefined) =>
    id === undefined ? undefined : actors().ownById.get(id);
  return {
    owner,
    faction,
    knowledge,
    owns,
    shows,
    relationTo: (actor: Pick<ActorRenderState, "owner">) =>
      ownerRelation(owner, actor.owner, simulation.relations.relationship),
    isMobile,
    actors,
    economy,
    support,
    wrecks,
    shownActor: (id: string | undefined) =>
      id === undefined ? undefined : actors().shownById.get(id),
    ownActor,
    ownMobileActor: (id: string | undefined) => {
      const found = ownActor(id);
      return found && isMobile(found) ? found : undefined;
    },
  };
}

export type OwnerView = ReturnType<typeof createOwnerView>;
