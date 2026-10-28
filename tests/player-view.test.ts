import { expect, test } from "vitest";

import { createActor } from "../src/simulation/actor";
import { createPlayerView } from "../src/simulation/player-view";
import { createRelations } from "../src/simulation/ownership";
import { createHarvesterState } from "../src/simulation/economy";
import { createCultivatorState } from "../src/simulation/cultivation";
import { createObservations } from "../src/simulation/observations";

import type {
  ActorDefinition,
  ActorRenderState,
} from "../src/simulation/actor";
import type { Detectable } from "../src/simulation/ownership";
import type { EconomyState } from "../src/simulation/economy";
import type { SupportView } from "../src/simulation/support";

const movement = { speed: 1, profileId: "ground" };
const definitions = new Map<string, ActorDefinition>(
  [
    { id: "trooper", behaviorId: "move", faction: "arc", movement },
    { id: "barracks", behaviorId: "idle", faction: "arc" },
    { id: "wolf", behaviorId: "move", faction: "wildlife", movement },
  ].map((definition) => [definition.id, definition]),
);
const actor = (
  id: string,
  definitionId: string,
  owner: string,
): ActorRenderState =>
  createActor({ id, definitionId, owner, worldPosition: { x: 0, z: 0 } });
const barracks: ActorRenderState = {
  ...actor("barracks", "barracks", "player"),
  tilePlacement: { origin: { x: 0, z: 0 }, quarterTurns: 0 },
};

function fixture() {
  const simulation = {
    actors: [
      actor("trooper", "trooper", "player"),
      barracks,
      actor("wolf", "wolf", "wildlife"),
    ],
    playerOwner: "player",
    relations: createRelations([
      { owners: ["player", "wildlife"], relationship: "hostile" },
    ]),
    seen: new Set<string>(),
    detects: (_owner: string | undefined, target: Detectable) =>
      simulation.seen.has(target.id!),
    economy: undefined,
    support: undefined,
    knowledgeOf: () => {
      throw new Error("No economy to know.");
    },
  };
  return { simulation, player: createPlayerView(simulation, definitions) };
}

test("hidden hostiles stay out of the player's lookups and groups", () => {
  const { simulation, player } = fixture();

  expect(player.actor("wolf")?.id).toBe("wolf");
  expect(player.shownActor("wolf")).toBeUndefined();
  expect(player.shownActor("trooper")?.id).toBe("trooper");
  expect(player.actors().shownMobile.map(({ id }) => id)).toEqual(["trooper"]);
  expect(player.actors().mobile.map(({ id }) => id)).toEqual([
    "trooper",
    "wolf",
  ]);

  simulation.seen.add("wolf");
  expect(player.shownActor("wolf")?.id).toBe("wolf");
});

test("own lookups exclude hostiles, and mobile ones exclude buildings", () => {
  const { player } = fixture();

  expect(player.ownActor("barracks")?.id).toBe("barracks");
  expect(player.ownActor("wolf")).toBeUndefined();
  expect(player.ownActor(undefined)).toBeUndefined();
  expect(player.ownMobileActor("trooper")?.id).toBe("trooper");
  expect(player.ownMobileActor("barracks")).toBeUndefined();
  expect([...player.actors().ownIds]).toEqual(["trooper", "barracks"]);
  expect(player.actors().placed.map(({ id }) => id)).toEqual(["barracks"]);
});

test("groups follow each committed actor list", () => {
  const { simulation, player } = fixture();
  const before = player.actors();
  expect(player.actors()).toBe(before);

  simulation.actors = simulation.actors.filter(({ id }) => id !== "trooper");

  expect(player.actor("trooper")).toBeUndefined();
  expect(player.actors().ownIds.has("trooper")).toBe(false);
});

test("the player economy keeps private work and income scoped to ownership", () => {
  const { simulation } = fixture();
  const economy: EconomyState = {
    stockpiles: [
      { resource: "materials", owners: ["player", "ally"], amount: 100 },
      { resource: "materials", owners: ["rival"], amount: 900 },
    ],
    deposited: ["player", "ally", "rival"].map((owner) => ({
      owner,
      resource: "materials",
      amount: 10,
    })),
    sites: [],
    loot: [],
    harvesters: ["trooper", "ally", "rival"].map((id) =>
      createHarvesterState(id),
    ),
    cultivation: {
      sites: [],
      workers: ["trooper", "ally", "rival"].map(createCultivatorState),
    },
    production: ["barracks", "ally", "rival"].map((producerId) => ({
      actorId: `${producerId}-job`,
      producerId,
      definitionId: "trooper",
      paidCost: 10,
      completedTicks: 1,
      totalTicks: 10,
      exitBlocked: false,
    })),
  };
  const state = {
    ...simulation,
    actors: [
      ...simulation.actors,
      actor("ally", "trooper", "ally"),
      actor("rival", "trooper", "rival"),
    ],
    economy,
    knowledgeOf: () => ({
      owner: "player",
      fog: undefined,
      knowsTile: () => true,
      seesTile: () => true,
      sites: [],
      observations: createObservations(),
    }),
  };
  const player = createPlayerView(state, definitions);
  const known = player.economy()!;
  expect(known.stockpiles).toEqual([economy.stockpiles[0]]);
  expect(known.deposited.map(({ owner }) => owner)).toEqual(["player"]);
  expect(known.harvesters.map(({ actorId }) => actorId)).toEqual(["trooper"]);
  expect(known.cultivation?.workers.map(({ actorId }) => actorId)).toEqual([
    "trooper",
  ]);
  expect(known.production.map(({ producerId }) => producerId)).toEqual([
    "barracks",
  ]);
  expect(economy.production).toHaveLength(3);
});

test("support shows usable detected nodes and keeps links within that view", () => {
  const { simulation } = fixture();
  const actors = [
    barracks,
    { ...barracks, id: "ally", owner: "ally" },
    { ...barracks, id: "hidden", owner: "ally" },
    { ...barracks, id: "enemy", owner: "wildlife" },
  ];
  const support: SupportView = {
    nodes: actors.map((actor) => ({
      actorId: actor.id,
      owner: actor.owner,
      center: actor.worldPosition,
      radius: 6,
      complete: true,
      root: false,
      connected: false,
      rootOwners: [],
      rootIds: [],
    })),
    links: ["ally", "hidden", "enemy"].map((to) => ({
      from: "barracks",
      to,
      active: false,
    })),
  };
  const state = {
    ...simulation,
    actors,
    support,
    relations: createRelations([
      {
        owners: ["player", "ally"],
        relationship: "allied",
        sharesSupport: true,
      },
    ]),
  };
  simulation.seen.add("ally");
  simulation.seen.add("enemy");
  const player = createPlayerView(state, definitions);
  const shown = player.support()!;
  expect(player.support()).toBe(shown);
  expect(shown.nodes.map(({ actorId }) => actorId)).toEqual([
    "barracks",
    "ally",
  ]);
  expect(shown.links).toEqual([
    { from: "barracks", to: "ally", active: false },
  ]);

  // Vision changes with a committed actor list, even if support stays fixed.
  simulation.seen.delete("ally");
  state.actors = [...actors];
  expect(player.support()?.nodes.map(({ actorId }) => actorId)).toEqual([
    "barracks",
  ]);
  expect(player.support()?.links).toEqual([]);
  simulation.seen.add("ally");
  state.actors = [...actors];
  expect(player.support()?.nodes).toHaveLength(2);
  state.relations = createRelations([]);
  expect(player.support()?.nodes.map(({ actorId }) => actorId)).toEqual([
    "barracks",
  ]);
});
