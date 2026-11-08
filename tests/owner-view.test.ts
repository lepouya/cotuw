import { expect, test } from "vitest";

import { createActor } from "../src/simulation/actor";
import { createOwnerView } from "../src/simulation/owner-view";
import { createRelations } from "../src/simulation/ownership";
import { createHarvesterState } from "../src/simulation/economy";
import { createCultivatorState } from "../src/simulation/cultivation";
import { createObservations } from "../src/simulation/observations";

import type {
  ActorDefinition,
  ActorRenderState,
} from "../src/simulation/actor";
import type { Wreck } from "../src/simulation/combat";
import type { EconomyState } from "../src/simulation/economy";
import type { OwnerKnowledge } from "../src/simulation/observations";
import type { SupportView } from "../src/simulation/support";
import type { Detectable } from "../src/simulation/vision";

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
const knowledge: OwnerKnowledge = {
  owner: "player",
  fog: undefined,
  knowsTile: () => true,
  seesTile: () => true,
  sites: [],
  observations: createObservations(),
};

function fixture() {
  const simulation = {
    actors: [
      actor("trooper", "trooper", "player"),
      barracks,
      actor("wolf", "wolf", "wildlife"),
    ],
    relations: createRelations([
      { owners: ["player", "wildlife"], relationship: "hostile" },
    ]),
    seen: new Set<string>(),
    detects: (_owner: string, target: Detectable) =>
      simulation.seen.has(target.id!),
    economy: undefined as EconomyState | undefined,
    support: undefined as SupportView | undefined,
    wrecks: [] as Wreck[],
  };
  const view = () =>
    createOwnerView({ simulation, knowledge, faction: "arc", definitions });
  return { simulation, view, player: view() };
}

test("hidden hostiles stay out of the owner's lookups and groups", () => {
  const { simulation, player } = fixture();

  expect(player.shownActor("wolf")).toBeUndefined();
  expect(player.shownActor("trooper")?.id).toBe("trooper");
  expect(player.actors().shownMobile.map(({ id }) => id)).toEqual(["trooper"]);

  simulation.seen.add("wolf");
  simulation.actors = [...simulation.actors];
  expect(player.shownActor("wolf")?.id).toBe("wolf");
  expect(player.actors().shown.map(({ id }) => id)).toEqual([
    "trooper",
    "barracks",
    "wolf",
  ]);
});

test("hidden foreign remains stay out of the owner's wrecks", () => {
  const { simulation, player } = fixture();
  const remains = (id: string, owner: string) => ({
    id,
    actorId: id,
    definitionId: "trooper",
    owner,
    worldPosition: { x: 0, z: 0 },
    facing: 0,
    tick: 1,
  });
  simulation.wrecks = [
    remains("mine", "player"),
    remains("theirs", "wildlife"),
  ];
  const shownIds = () => player.wrecks().map(({ actorId }) => actorId);
  expect(shownIds()).toEqual(["mine"]);

  simulation.seen.add("theirs");
  simulation.actors = [...simulation.actors];
  expect(shownIds()).toEqual(["mine", "theirs"]);
});

test("own lookups exclude hostiles, and mobile ones exclude buildings", () => {
  const { player } = fixture();

  expect(player.faction).toBe("arc");
  expect(player.ownActor("barracks")?.id).toBe("barracks");
  expect(player.ownActor("wolf")).toBeUndefined();
  expect(player.ownActor(undefined)).toBeUndefined();
  expect(player.ownMobileActor("trooper")?.id).toBe("trooper");
  expect(player.ownMobileActor("barracks")).toBeUndefined();
  expect([...player.actors().ownIds]).toEqual(["trooper", "barracks"]);
  expect(player.actors().ownMobile.map(({ id }) => id)).toEqual(["trooper"]);
  expect(player.actors().placed.map(({ id }) => id)).toEqual(["barracks"]);
});

test("groups follow each committed actor list", () => {
  const { simulation, player } = fixture();
  const before = player.actors();
  expect(player.actors()).toBe(before);

  simulation.actors = simulation.actors.filter(({ id }) => id !== "trooper");

  expect(player.ownActor("trooper")).toBeUndefined();
  expect(player.actors().ownIds.has("trooper")).toBe(false);
});

test("detected foreign actors show posture without orders, routes, or payment", () => {
  const { simulation, player } = fixture();
  const point = { x: 4, z: 4 };
  const wolf: ActorRenderState = {
    ...actor("wolf", "wolf", "wildlife"),
    health: 5,
    movement: { target: point, waypoints: [point] },
    attackMove: { target: point },
    orders: [{ kind: "move", target: point }],
    rallyPoint: point,
    headquartersId: "den",
    construction: {
      paidCost: 10,
      active: true,
      completedTicks: 1,
      totalTicks: 4,
    },
    combat: {
      attack: { targetId: "trooper", lastKnown: point, post: point },
      weaponReadyTick: 9,
      activeTick: 3,
      lastHit: { attackerId: "trooper", tick: 3 },
    },
    territory: { home: point, mode: "pursuing", seenTargets: ["trooper"] },
  };
  simulation.actors = [actor("trooper", "trooper", "player"), wolf];
  simulation.seen.add("wolf");

  expect(player.shownActor("wolf")).toEqual({
    id: "wolf",
    definitionId: "wolf",
    owner: "wildlife",
    worldPosition: { x: 0, z: 0 },
    facing: 0,
    occupancyLayer: "surface",
    health: 5,
    construction: { active: true, completedTicks: 1, totalTicks: 4 },
    combat: { activeTick: 3, attack: { targetId: "trooper" } },
    territory: { mode: "pursuing" },
  });

  // An attack on an actor the viewer cannot see names no target.
  simulation.actors = [
    actor("hidden", "trooper", "rival"),
    {
      ...wolf,
      combat: { attack: { targetId: "hidden", lastKnown: point } },
    },
  ];
  expect(player.shownActor("wolf")?.combat).toEqual({});
});

test("own units name their latest attacker only while it is detected", () => {
  const { simulation, player } = fixture();
  const hit = { attackerId: "wolf", tick: 2 };
  const trooper: ActorRenderState = {
    ...actor("trooper", "trooper", "player"),
    combat: { activeTick: 2, lastHit: hit },
  };
  simulation.actors = [trooper, actor("wolf", "wolf", "wildlife")];

  expect(player.ownActor("trooper")?.combat).toEqual({ activeTick: 2 });

  simulation.seen.add("wolf");
  simulation.actors = [...simulation.actors];
  expect(player.ownActor("trooper")).toBe(trooper);

  // Remains do not reveal who fired.
  simulation.actors = [trooper];
  expect(player.ownActor("trooper")?.combat).toEqual({ activeTick: 2 });
});

test("the owner economy keeps private work and income scoped to ownership", () => {
  const { simulation, view } = fixture();
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
  simulation.actors = [
    ...simulation.actors,
    actor("ally", "trooper", "ally"),
    actor("rival", "trooper", "rival"),
  ];
  simulation.economy = economy;
  const known = view().economy()!;
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
  const { simulation, view } = fixture();
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
  simulation.actors = actors;
  simulation.support = support;
  simulation.relations = createRelations([
    {
      owners: ["player", "ally"],
      relationship: "allied",
      sharesSupport: true,
    },
  ]);
  simulation.seen.add("ally");
  simulation.seen.add("enemy");
  const player = view();
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
  simulation.actors = [...actors];
  expect(player.support()?.nodes.map(({ actorId }) => actorId)).toEqual([
    "barracks",
  ]);
  expect(player.support()?.links).toEqual([]);
  simulation.seen.add("ally");
  simulation.actors = [...actors];
  expect(player.support()?.nodes).toHaveLength(2);
  simulation.relations = createRelations([]);
  expect(player.support()?.nodes.map(({ actorId }) => actorId)).toEqual([
    "barracks",
  ]);
});
