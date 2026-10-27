import { describe, expect, test } from "vitest";
import { ARC_ACTOR_DEFINITIONS } from "./helpers/content";
import {
  advanceSeconds,
  balance,
  stockpiles,
  untilSeconds,
} from "./helpers/scenario";
import { createMissionSimulation } from "../src/simulation/mission";
import { secondsToTicks } from "../src/simulation/clock";
import { parseMission, serializeMission } from "../src/simulation/mission-file";
import { OccupancyGrid } from "../src/simulation/occupancy";
import {
  createScenarioState,
  defineScenario,
} from "../src/simulation/scenario";
import { disconnectedBuildings } from "../src/simulation/support";
import { TerrainGrid } from "../src/simulation/terrain";
import { createTerrainMoveBehavior } from "../src/simulation/terrain-movement";

import type { MissionEventDefinition } from "../src/simulation/events";
import { regroupStockpiles } from "../src/simulation/stockpiles";
import type {
  EconomyState,
  EconomyView,
  MaterialsSite,
} from "../src/simulation/economy";
import type { MissionState } from "../src/simulation/mission";
import type { ObjectiveDefinition } from "../src/simulation/objectives";
import type { OwnerRelationship } from "../src/simulation/ownership";
import type { ActorPlacement } from "../src/simulation/placement";
import type { ScenarioUnit } from "../src/simulation/scenario";

const TICK_SECONDS = 0.1;
const mapOptions = {
  width: 60,
  height: 20,
  tileSize: 1,
  terrainTypeIds: ["plain", "path", "rough", "water"],
};
const contentMap = new TerrainGrid(mapOptions);

type Setup = {
  units?: ScenarioUnit[];
  buildings?: (ActorPlacement & { owner?: string })[];
  relationships?: OwnerRelationship[];
  events?: MissionEventDefinition[];
  objectives?: ObjectiveDefinition[];
  sites?: MaterialsSite[];
  /** Starts with every tile explored, so placement ignores fog. */
  explored?: boolean;
  edit?: (state: MissionState) => void;
};

function scenario({
  units = [],
  buildings = [],
  relationships = [],
  events,
  objectives,
  sites = [],
}: Setup) {
  return defineScenario({
    id: "relationships",
    tileSize: 1,
    terrainTypeIds: mapOptions.terrainTypeIds,
    terrain: contentMap.terrainState(),
    owners: [
      { id: "player", faction: "arc" },
      { id: "rival", faction: "arc" },
    ],
    playerOwner: "player",
    relationships,
    events,
    objectives,
    buildings,
    units,
    stockpiles: [
      ...stockpiles(1000),
      ...stockpiles(1000, "materials", "rival"),
    ],
    sites,
    loot: [],
  });
}

function fixture(setup: Setup = {}, state?: MissionState) {
  const content = scenario(setup);
  const initial = state ?? createScenarioState(content, ARC_ACTOR_DEFINITIONS);
  if (!state && setup.explored)
    initial.fog = { explored: "1".repeat(initial.fog!.explored.length) };
  setup.edit?.(initial);
  const map = new TerrainGrid(mapOptions);
  const occupancy = new OccupancyGrid(map);
  const simulation = createMissionSimulation({
    state: initial,
    objectives: content.objectives,
    events: content.events,
    definitions: ARC_ACTOR_DEFINITIONS,
    map,
    occupancy,
    tickSeconds: TICK_SECONDS,
    bounds: map.worldBounds,
    behaviorRegistry: new Map([
      [
        "terrain-move",
        createTerrainMoveBehavior(map, occupancy, [
          {
            id: "surface-ground",
            maxSlope: 0.75,
            slopeCostAtLimit: 2,
            terrainCosts: { plain: 1, path: 1, rough: 2, water: null },
          },
        ]),
      ],
      ["idle", { handleCommand: () => false, update: () => {} }],
    ]),
  });
  return { simulation, content };
}

const unit = (
  actorId: string,
  x: number,
  owner = "player",
  definitionId = "arc-trooper",
): ScenarioUnit => ({ actorId, definitionId, owner, tile: { x, z: 10 } });

const at = (seconds: number, actions: MissionEventDefinition["actions"]) => ({
  id: `at-${seconds}`,
  trigger: { kind: "time" as const, seconds },
  actions,
});

const rivals = (relationship: "allied" | "neutral" | "hostile") => ({
  kind: "set-relationship" as const,
  owners: ["player", "rival"] as [string, string],
  relationship,
});

describe("owner relationships", () => {
  test("neutral owners neither engage nor accept Attack orders", () => {
    const { simulation } = fixture({
      units: [unit("trooper", 10), unit("visitor", 14, "rival")],
    });
    expect(simulation.relations.relationship("player", "rival")).toBe(
      "neutral",
    );
    advanceSeconds(simulation, 10);
    simulation.submitCommand({
      kind: "attack",
      actorId: "trooper",
      targetId: "visitor",
    });
    expect(simulation.tick()[0]).toMatchObject({
      accepted: false,
      reason: "invalid-target",
    });
    expect(simulation.actorById("visitor")!.health).toBeUndefined();
    expect(simulation.actorById("trooper")!.health).toBeUndefined();
  });

  test("timed events start a fight, and making peace ends it", () => {
    const { simulation } = fixture({
      units: [unit("trooper", 10), unit("visitor", 14, "rival")],
      events: [at(1, [rivals("hostile")]), at(3, [rivals("neutral")])],
    });
    advanceSeconds(simulation, 0.9);
    expect(simulation.relations.relationship("rival", "player")).toBe(
      "neutral",
    );
    advanceSeconds(simulation, 0.1);
    expect(simulation.relations.relationship("rival", "player")).toBe(
      "hostile",
    );
    untilSeconds(simulation, () => simulation.attacks.length > 0, 2);
    untilSeconds(
      simulation,
      () => simulation.relations.relationship("player", "rival") === "neutral",
    );
    const health = simulation.actorById("visitor")!.health;
    advanceSeconds(simulation, 5);
    expect(simulation.actorById("visitor")!.health).toBe(health);
    expect(simulation.actorById("trooper")!.combat?.attack).toBeUndefined();
    expect(simulation.snapshot().firedEvents).toEqual(["at-1", "at-3"]);
  });

  test("allies share vision until the alliance ends, keeping explored land", () => {
    const { simulation } = fixture({
      buildings: [
        {
          actorId: "cc",
          definitionId: "arc-command-center-prototype",
          origin: { x: 2, z: 2 },
        },
      ],
      units: [unit("scout", 50, "rival", "arc-scout")],
      relationships: [{ owners: ["rival", "player"], relationship: "allied" }],
      events: [at(1, [rivals("neutral")])],
    });
    const scout = () => simulation.actorById("scout")!;
    expect(simulation.fog!.isExplored(50, 10)).toBe(true);
    expect(simulation.detects("player", scout())).toBe(true);
    expect(simulation.detects("rival", simulation.actorById("cc")!)).toBe(true);
    advanceSeconds(simulation, 1);
    expect(simulation.detects("player", scout())).toBe(false);
    expect(simulation.detects("rival", simulation.actorById("cc")!)).toBe(
      false,
    );
    expect(simulation.fog!.isExplored(50, 10)).toBe(true);
  });

  test("support-sharing allies power and authorize construction until revoked", () => {
    const placement = {
      actorId: "new",
      definitionId: "arc-field-barracks",
      origin: { x: 8, z: 4 },
    };
    const { simulation } = fixture({
      explored: true,
      buildings: [
        {
          actorId: "ally-cc",
          definitionId: "arc-command-center-prototype",
          origin: { x: 2, z: 10 },
          owner: "rival",
        },
        {
          actorId: "barracks",
          definitionId: "arc-field-barracks",
          origin: { x: 8, z: 10 },
        },
      ],
      relationships: [
        {
          owners: ["player", "rival"],
          relationship: "allied",
          sharesSupport: true,
        },
      ],
      events: [at(1, [rivals("allied")])],
    });
    expect(disconnectedBuildings(simulation.support).has("barracks")).toBe(
      false,
    );
    expect(simulation.evaluatePlacement(placement).accepted).toBe(true);
    advanceSeconds(simulation, 1);
    expect(simulation.relations.relationship("player", "rival")).toBe("allied");
    expect(disconnectedBuildings(simulation.support).has("barracks")).toBe(
      true,
    );
    expect(simulation.evaluatePlacement(placement)).toMatchObject({
      accepted: false,
      reason: "outside-support",
    });
  });

  test("support sharing does not pass through a shared intermediary", () => {
    const barracks = (actorId: string, x: number, owner: string) => ({
      actorId,
      definitionId: "arc-field-barracks",
      origin: { x, z: 10 },
      owner,
    });
    const { simulation } = fixture({
      explored: true,
      buildings: [
        {
          actorId: "rival-cc",
          definitionId: "arc-command-center-prototype",
          origin: { x: 2, z: 10 },
          owner: "rival",
        },
        barracks("relay", 8, "middle"),
        barracks("barracks", 13, "player"),
      ],
      edit: (state) => {
        state.owners.push({ id: "middle", faction: "arc" });
        for (const other of ["rival", "player"])
          state.relationships.push({
            owners: ["middle", other],
            relationship: "allied",
            sharesSupport: true,
          });
      },
    });
    const disconnected = disconnectedBuildings(simulation.support);
    expect(disconnected.has("relay")).toBe(false);
    expect(disconnected.has("barracks")).toBe(true);
  });

  test("each owner's construction uses its own Command Center queue", () => {
    const site = (actorId: string, x: number, owner: string) => [
      {
        actorId: `${actorId}-cc`,
        definitionId: "arc-command-center-prototype",
        origin: { x, z: 10 },
        owner,
      },
      {
        actorId,
        definitionId: "arc-field-barracks",
        origin: { x: x + 6, z: 10 },
        owner,
      },
    ];
    const { simulation } = fixture({
      explored: true,
      buildings: [...site("mine", 2, "player"), ...site("theirs", 40, "rival")],
      edit: (state) => {
        for (const actor of state.actors)
          if (actor.definitionId === "arc-field-barracks")
            actor.construction = {
              paidCost: 100,
              completedTicks: 0,
              totalTicks: secondsToTicks(8, TICK_SECONDS),
            };
      },
    });
    simulation.tick();
    for (const id of ["mine", "theirs"])
      expect(simulation.actorById(id)!).toMatchObject({
        headquartersId: `${id}-cc`,
        construction: { active: true, completedTicks: 1 },
      });
  });

  test("rival Harvesters use their owner's resource knowledge under fog", () => {
    const site = (id: string, x: number): MaterialsSite => ({
      id,
      name: id,
      tile: { x, z: 12 },
      initialMaterials: 100,
      remainingMaterials: 100,
    });
    const { simulation } = fixture({
      units: [
        unit("trooper", 4),
        unit("harvester", 50, "rival", "arc-harvester"),
      ],
      buildings: [
        {
          actorId: "cc",
          definitionId: "arc-command-center-prototype",
          origin: { x: 40, z: 2 },
          owner: "rival",
        },
        {
          actorId: "refinery",
          definitionId: "arc-materials-refinery",
          origin: { x: 46, z: 10 },
          owner: "rival",
        },
      ],
      sites: [site("home", 50), site("hidden", 8)],
    });
    expect(simulation.fog!.isExplored(50, 12)).toBe(false);
    expect(simulation.sees("rival", contentMap.tileCenter(50, 12))).toBe(true);
    simulation.submitCommand({
      kind: "assign-refinery",
      actorId: "harvester",
      refineryId: "refinery",
    });
    simulation.submitCommand({
      kind: "gather",
      actorId: "harvester",
      siteId: "home",
    });
    expect(simulation.tick().map(({ accepted }) => accepted)).toEqual([
      true,
      true,
    ]);
    expect(simulation.economy!.harvesters[0]).toMatchObject({
      activeSiteId: "home",
    });
    untilSeconds(
      simulation,
      () => simulation.economy!.harvesters[0]!.cargo > 0,
      5,
    );
    expect(
      simulation.economy!.sites.find(({ id }) => id === "home")!
        .remainingMaterials,
    ).toBeLessThan(100);
    simulation.submitCommand({
      kind: "gather",
      actorId: "harvester",
      siteId: "hidden",
    });
    expect(simulation.tick()[0]).toMatchObject({
      accepted: false,
      reason: "missing-site",
    });
    expect(simulation.economy!.harvesters[0]!.activeSiteId).toBe("home");
  });

  test("an objective trigger fires when the objective completes", () => {
    const { simulation } = fixture({
      units: [unit("trooper", 10), unit("visitor", 14, "rival")],
      relationships: [{ owners: ["player", "rival"], relationship: "hostile" }],
      objectives: [
        {
          id: "defeat-visitor",
          kind: "destroy",
          label: "Defeat the visitor",
          directive: "Destroy the rival trooper.",
          actorIds: ["visitor"],
        },
      ],
      events: [
        {
          id: "truce",
          trigger: {
            kind: "objective-complete",
            objectiveId: "defeat-visitor",
          },
          actions: [rivals("allied")],
        },
      ],
      edit: (state) => {
        state.actors.find(({ id }) => id === "visitor")!.health = 1;
      },
    });
    untilSeconds(simulation, () => !simulation.actorById("visitor"), 10);
    expect(simulation.relations.relationship("player", "rival")).toBe("allied");
    expect(simulation.snapshot().firedEvents).toEqual(["truce"]);
  });

  test("relationships and fired events continue identically after loading", () => {
    const setup: Setup = {
      units: [unit("trooper", 10), unit("visitor", 14, "rival")],
      events: [at(1, [rivals("allied")]), at(2, [rivals("hostile")])],
    };
    const { simulation, content } = fixture(setup);
    advanceSeconds(simulation, 2.5);
    const saved = parseMission(
      serializeMission(content, simulation.snapshot(), TICK_SECONDS),
      TICK_SECONDS,
    ).state;
    expect(saved.relationships).toEqual([
      { owners: ["player", "rival"], relationship: "hostile" },
    ]);
    const restored = fixture(setup, saved).simulation;
    advanceSeconds(simulation, 5);
    advanceSeconds(restored, 5);
    expect(restored.relations.relationship("player", "rival")).toBe("hostile");
    expect(restored.snapshot()).toEqual(simulation.snapshot());
  });

  test.each<[string, (state: MissionState) => void, string]>([
    [
      "an unknown owner",
      (state) =>
        state.relationships.push({
          owners: ["player", "nobody"],
          relationship: "hostile",
        }),
      "invalid owner relationships",
    ],
    [
      "a repeated pair",
      (state) =>
        state.relationships.push(
          { owners: ["player", "rival"], relationship: "hostile" },
          { owners: ["rival", "player"], relationship: "allied" },
        ),
      "invalid owner relationships",
    ],
    [
      "hostile support sharing",
      (state) =>
        state.relationships.push({
          owners: ["player", "rival"],
          relationship: "hostile",
          sharesSupport: true,
        }),
      "invalid owner relationships",
    ],
    [
      "hostile headquarters sharing",
      (state) =>
        state.relationships.push({
          owners: ["player", "rival"],
          relationship: "hostile",
          sharesHeadquarters: true,
        }),
      "invalid owner relationships",
    ],
    [
      "an unknown fired event",
      (state) => state.firedEvents.push("missing"),
      "invalid fired events",
    ],
  ])("loading rejects %s", (_, edit, message) => {
    expect(() => fixture({ edit })).toThrow(message);
  });

  test("events must name known owners and objectives", () => {
    expect(() =>
      fixture({
        events: [
          {
            id: "lost",
            trigger: { kind: "objective-complete", objectiveId: "missing" },
            actions: [rivals("allied")],
          },
        ],
      }),
    ).toThrow("invalid event definition");
    expect(() =>
      fixture({
        events: [
          at(1, [{ ...rivals("allied"), owners: ["player", "nobody"] }]),
        ],
      }),
    ).toThrow("invalid event definition");
  });
});

describe("shared resource pools", () => {
  const sharing = {
    ...rivals("allied"),
    sharesResources: true as const,
  };
  const lifebloom = (amount: number) => (state: MissionState) =>
    state.economy!.stockpiles.push(...stockpiles(amount, "lifebloom"));
  const totals = (simulation: { economy?: EconomyView; playerOwner: string }) =>
    ["player", "rival"].map((owner) => [
      balance(simulation, "materials", owner),
      balance(simulation, "lifebloom", owner),
    ]);

  test("sharing allies pool each resource type and divide it when sharing ends", () => {
    const { simulation } = fixture({
      explored: true,
      buildings: [
        {
          actorId: "cc",
          definitionId: "arc-command-center-prototype",
          origin: { x: 2, z: 10 },
          owner: "player",
        },
      ],
      events: [at(1, [sharing]), at(3, [rivals("allied")])],
      edit: lifebloom(31),
    });
    expect(totals(simulation)).toEqual([
      [1000, 31],
      [1000, 0],
    ]);
    advanceSeconds(simulation, 1);
    expect(simulation.economy!.stockpiles).toEqual([
      { resource: "materials", owners: ["player", "rival"], amount: 2000 },
      { resource: "lifebloom", owners: ["player", "rival"], amount: 31 },
    ]);
    simulation.submitCommand({
      kind: "place-actor",
      actorId: "barracks",
      definitionId: "arc-field-barracks",
      origin: { x: 6, z: 10 },
    });
    simulation.tick();
    expect(totals(simulation)).toEqual([
      [1900, 31],
      [1900, 31],
    ]);
    const restored = fixture(
      { events: [at(1, [sharing]), at(3, [rivals("allied")])] },
      JSON.parse(JSON.stringify(simulation.snapshot())),
    ).simulation;
    for (const current of [simulation, restored]) {
      untilSeconds(current, () => current.economy!.stockpiles.length === 4, 3);
      // Earlier owner IDs take indivisible remainders.
      expect(totals(current)).toEqual([
        [950, 16],
        [950, 15],
      ]);
      expect(current.relations.relationship("player", "rival")).toBe("allied");
    }
  });

  test("ending the alliance separates its pools", () => {
    const { simulation } = fixture({
      events: [at(1, [sharing]), at(2, [rivals("hostile")])],
    });
    advanceSeconds(simulation, 1.5);
    expect(simulation.economy!.stockpiles).toHaveLength(1);
    advanceSeconds(simulation, 1);
    expect(totals(simulation)).toEqual([
      [1000, 0],
      [1000, 0],
    ]);
  });

  test("pools join owners through shared allies and split by member shares", () => {
    const owners = ["a", "b", "c"];
    const economy = {
      stockpiles: [
        { resource: "materials" as const, owners: ["a"], amount: 10 },
        { resource: "materials" as const, owners: ["c"], amount: 5 },
        { resource: "lifebloom" as const, owners: ["b"], amount: 7 },
      ],
    } as EconomyState;
    const linked = (pairs: string[]) => (left: string, right: string) =>
      left === right ||
      pairs.includes(`${left}${right}`) ||
      pairs.includes(`${right}${left}`);
    regroupStockpiles(economy, owners, linked(["ab", "bc"]));
    expect(economy.stockpiles).toEqual([
      { resource: "materials", owners: ["a", "b", "c"], amount: 15 },
      { resource: "lifebloom", owners: ["a", "b", "c"], amount: 7 },
    ]);
    regroupStockpiles(economy, owners, linked(["ab"]));
    expect(economy.stockpiles).toEqual([
      { resource: "materials", owners: ["a", "b"], amount: 10 },
      { resource: "materials", owners: ["c"], amount: 5 },
      { resource: "lifebloom", owners: ["a", "b"], amount: 5 },
      { resource: "lifebloom", owners: ["c"], amount: 2 },
    ]);
  });

  test("owners that start sharing start pooled; saves must match sharing", () => {
    const { simulation } = fixture({
      relationships: [
        {
          owners: ["player", "rival"],
          relationship: "allied",
          sharesResources: true,
        },
      ],
    });
    expect(simulation.economy!.stockpiles).toEqual([
      { resource: "materials", owners: ["player", "rival"], amount: 2000 },
    ]);
    expect(() =>
      fixture({
        edit: (state) => {
          state.economy!.stockpiles = [
            { resource: "materials", owners: ["player", "rival"], amount: 1 },
          ];
        },
      }),
    ).toThrow("invalid economy state");
  });
});
