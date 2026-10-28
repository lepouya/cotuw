import { describe, expect, test } from "vitest";
import { advanceSeconds } from "./helpers/scenario";
import { at, contentMap, fixture, rivals, unit } from "./helpers/rivals";
import { createActor } from "../src/simulation/actor";
import { createCultivationSite } from "../src/simulation/cultivation";
import { parseMission, serializeMission } from "../src/simulation/mission-file";
import { knownEconomy } from "../src/simulation/observations";
import { createPlayerView } from "../src/simulation/player-view";
import { createScenarioState } from "../src/simulation/scenario";
import { ARC_ACTOR_DEFINITIONS } from "./helpers/content";

import type { MissionSimulation } from "../src/simulation/mission";
import type { ResourceLoot } from "../src/simulation/economy";

const rival = { owner: "rival" };
const memoryOf = (simulation: MissionSimulation, owner = "player") =>
  simulation.knowledgeOf(owner).observations;
const sighting = (simulation: MissionSimulation, id: string, owner?: string) =>
  memoryOf(simulation, owner).actors.find(({ actorId }) => actorId === id);
const moveRival = (simulation: MissionSimulation, actorId: string, x: number) =>
  simulation.submitCommand(
    { kind: "move", actorId, target: contentMap.tileCenter(x, 10) },
    rival,
  );
const gift = (x: number): ResourceLoot => ({
  id: "gift",
  name: "Gift",
  tile: { x, z: 10 },
  materials: 25,
  collected: false,
});

describe("owner observations", () => {
  test.each(["constructor", "toString", "__proto__"])(
    "owner %s starts with empty memory and full-sized fog",
    (owner) => {
      const { simulation } = fixture({
        edit: (state) => state.owners.push({ id: owner }),
      });
      expect(memoryOf(simulation, owner)).toEqual({
        actors: [],
        sites: [],
        loot: [],
      });
      expect(simulation.snapshot().fog!.explored[owner]).toBe(
        "0".repeat(contentMap.width * contentMap.height),
      );
      simulation.tick();
      expect(memoryOf(simulation, owner).actors).toEqual([]);
    },
  );

  test.each([
    { actorId: "never-existed" },
    { worldPosition: { x: 1000, z: 0 } },
    { health: 1000000 },
    { tilePlacement: { origin: { x: 1, z: 1 }, quarterTurns: 0 } },
    { construction: { completedTicks: 2, totalTicks: 1 } },
  ])("rejects impossible saved actor sightings: %j", (changes) => {
    const setup = { units: [unit("visitor", 50, "rival")] };
    const { simulation } = fixture(setup);
    const state = simulation.snapshot();
    state.observations.player!.actors = [
      {
        actorId: "visitor",
        definitionId: "arc-trooper",
        owner: "rival",
        worldPosition: contentMap.tileCenter(40, 10),
        tick: 0,
        ...changes,
      },
    ];
    expect(() => fixture(setup, state)).toThrow("invalid observations");
  });

  test.each([{ amount: 101 }, { amount: 50, dormant: true as const }])(
    "rejects impossible saved Materials sightings: %j",
    (changes) => {
      const setup = {
        sites: [
          {
            id: "far",
            name: "Far",
            tile: { x: 50, z: 10 },
            initialMaterials: 100,
            remainingMaterials: 100,
          },
        ],
      };
      const { simulation } = fixture(setup);
      const state = simulation.snapshot();
      state.observations.player!.sites = [
        { siteId: "far", tick: 0, ...changes },
      ];
      expect(() => fixture(setup, state)).toThrow("invalid observations");
    },
  );

  test.each([
    { tilePlacement: null },
    { tilePlacement: undefined },
    { tilePlacement: { origin: { x: 100, z: 100 }, quarterTurns: 0 } },
    { worldPosition: { x: 0, z: 0 } },
    { construction: { completedTicks: 1, totalTicks: 0 } },
  ])("rejects impossible saved building sightings: %j", (changes) => {
    const setup = {
      units: [unit("spotter", 40, "player", "arc-scout")],
      buildings: [
        {
          actorId: "barracks",
          definitionId: "arc-field-barracks",
          origin: { x: 44, z: 9 },
          owner: "rival",
        },
      ],
    };
    const { simulation } = fixture(setup);
    simulation.removeActor("spotter");
    const state = simulation.snapshot();
    Object.assign(state.observations.player!.actors[0]!, changes);
    expect(() => fixture(setup, state)).toThrow("invalid observations");
  });

  test("unseen buildings stay remembered through removal and loading", () => {
    const setup = {
      units: [unit("spotter", 40, "player", "arc-scout")],
      buildings: [
        {
          actorId: "barracks",
          definitionId: "arc-field-barracks",
          origin: { x: 44, z: 9 },
          owner: "rival",
        },
      ],
    };
    const { simulation } = fixture(setup);
    simulation.removeActor("spotter");
    simulation.removeActor("barracks");
    const { simulation: loaded } = fixture(setup, simulation.snapshot());
    expect(sighting(loaded, "barracks")).toEqual(
      sighting(simulation, "barracks"),
    );
    loaded.spawnActor(
      createActor({
        id: "returning",
        owner: "player",
        definitionId: "arc-scout",
        worldPosition: contentMap.tileCenter(40, 10),
      }),
    );
    expect(sighting(loaded, "barracks")).toBeUndefined();
  });

  test("renewable yields stay stale and player projections follow refreshed memory", () => {
    const setup = {
      units: [unit("spotter", 4)],
      edit: (state: ReturnType<typeof createScenarioState>) => {
        state.economy!.cultivation = {
          sites: [createCultivationSite("grove", "Grove", { x: 8, z: 10 })],
          workers: [],
        };
      },
    };
    const { simulation } = fixture(setup);
    const player = createPlayerView(
      simulation,
      new Map(
        ARC_ACTOR_DEFINITIONS.map((definition) => [definition.id, definition]),
      ),
    );
    const initial = player.economy();
    expect(player.economy()).toBe(initial);
    expect(initial!.cultivation!.sites[0]!.reserve).toBe(100000);
    simulation.removeActor("spotter");
    const state = simulation.snapshot();
    state.economy!.cultivation!.sites[0]!.reserve = 10000;
    state.economy!.cultivation!.sites[0]!.dormant = true;
    // The loaded mission keeps the old report despite current dormancy.
    const { simulation: loaded } = fixture({}, state);
    const known = () => knownEconomy(loaded.economy!, memoryOf(loaded));
    loaded.tick();
    expect(known().cultivation!.sites[0]).toMatchObject({
      reserve: 100000,
      dormant: false,
    });
    loaded.spawnActor(
      createActor({
        id: "returning",
        owner: "player",
        definitionId: "arc-scout",
        worldPosition: contentMap.tileCenter(4, 10),
      }),
    );
    expect(known().cultivation!.sites[0]).toMatchObject({
      reserve: 10100,
      dormant: true,
    });
    expect(initial!.cultivation!.sites[0]!.reserve).toBe(100000);
  });

  test("enemies keep their last-seen state after leaving vision", () => {
    const { simulation } = fixture({
      units: [unit("trooper", 4), unit("scout", 9, "rival", "arc-scout")],
    });
    simulation.tick();
    expect(sighting(simulation, "scout")).toMatchObject({
      owner: "rival",
      definitionId: "arc-scout",
      tick: 1,
    });
    // Each owner remembers the other.
    expect(sighting(simulation, "trooper", "rival")?.owner).toBe("player");
    moveRival(simulation, "scout", 50);
    advanceSeconds(simulation, 6);
    const remembered = sighting(simulation, "scout")!;
    expect(remembered.tick).toBeLessThan(simulation.completedTicks);
    expect(simulation.detects("player", simulation.actorById("scout")!)).toBe(
      false,
    );
    expect(remembered.worldPosition).not.toEqual(
      simulation.actorById("scout")!.worldPosition,
    );
  });

  test("units out of sight stay remembered until their remains are seen", () => {
    const { simulation } = fixture({
      units: [
        unit("trooper", 4),
        unit("scout", 30, "player", "arc-scout"),
        unit("visitor", 40, "rival"),
        unit("doomed", 9, "rival"),
      ],
      relationships: [{ owners: ["player", "rival"], relationship: "hostile" }],
      edit: (state) => {
        state.actors.find(({ id }) => id === "doomed")!.health = 1;
      },
    });
    expect(sighting(simulation, "doomed")).toBeDefined();
    simulation.removeActor("scout");
    simulation.removeActor("visitor");
    advanceSeconds(simulation, 2);
    expect(simulation.actorById("doomed")).toBeUndefined();
    expect(sighting(simulation, "doomed")).toBeUndefined();
    simulation.spawnActor(
      createActor({
        id: "spotter",
        definitionId: "arc-scout",
        owner: "player",
        worldPosition: contentMap.tileCenter(38, 10),
      }),
    );
    // Removal leaves no remains, so the report only grows stale.
    expect(sighting(simulation, "visitor")?.tick).toBe(0);
  });

  test("buildings keep last-seen health and leave memory when seen gone", () => {
    const { simulation } = fixture({
      units: [unit("trooper", 4)],
      buildings: [
        {
          actorId: "barracks",
          definitionId: "arc-field-barracks",
          origin: { x: 9, z: 9 },
          owner: "rival",
        },
      ],
      edit: (state) => {
        state.actors.find(({ id }) => id === "barracks")!.health = 500;
      },
    });
    expect(sighting(simulation, "barracks")).toMatchObject({
      health: 500,
      tilePlacement: { origin: { x: 9, z: 9 } },
      tick: 0,
    });
    simulation.removeActor("barracks");
    expect(sighting(simulation, "barracks")).toBeUndefined();
  });

  test("allies are not remembered and an alliance clears old sightings", () => {
    const { simulation } = fixture({
      units: [unit("trooper", 4), unit("visitor", 9, "rival")],
      events: [at(1, [rivals("allied")])],
    });
    simulation.tick();
    expect(sighting(simulation, "visitor")).toBeDefined();
    advanceSeconds(simulation, 1);
    expect(memoryOf(simulation).actors).toEqual([]);
    expect(memoryOf(simulation, "rival").actors).toEqual([]);
  });

  test("every owner keeps the terrain it explored", () => {
    const { simulation } = fixture({
      units: [unit("trooper", 4), unit("scout", 30, "rival", "arc-scout")],
    });
    const knowledge = simulation.knowledgeOf("rival");
    expect(knowledge.fog!.isExplored(30, 10)).toBe(true);
    expect(knowledge.fog!.isExplored(4, 10)).toBe(false);
    moveRival(simulation, "scout", 55);
    advanceSeconds(simulation, 6);
    expect(knowledge.seesTile({ x: 30, z: 10 })).toBe(false);
    expect(knowledge.knowsTile({ x: 30, z: 10 })).toBe(true);
    expect(simulation.fog!.isExplored(30, 10)).toBe(false);
    expect(() => simulation.knowledgeOf("nobody")).toThrow("Unknown owner");
  });

  test("sites keep last-seen yields and authored locations stay known", () => {
    const { simulation } = fixture({
      units: [unit("trooper", 4)],
      sites: [
        {
          id: "near",
          name: "Near",
          tile: { x: 8, z: 10 },
          initialMaterials: 100,
          remainingMaterials: 60,
        },
        {
          id: "far",
          name: "Far",
          tile: { x: 50, z: 10 },
          initialMaterials: 100,
          remainingMaterials: 100,
        },
      ],
    });
    const knowledge = simulation.knowledgeOf("player");
    expect(knowledge.sites.map(({ id }) => id)).toEqual(["near", "far"]);
    expect(knowledge.observations.sites).toEqual([
      { siteId: "near", amount: 60, tick: 0 },
    ]);
    const known = knownEconomy(simulation.economy!, knowledge.observations);
    expect(known.sites).toMatchObject([{ id: "near", remainingMaterials: 60 }]);
  });

  test("Harvesters learn about depletion only when the site is seen again", () => {
    const setup = {
      buildings: [
        {
          actorId: "cc",
          definitionId: "arc-command-center-prototype",
          origin: { x: 1, z: 6 },
        },
        {
          actorId: "refinery",
          definitionId: "arc-materials-refinery",
          origin: { x: 7, z: 6 },
        },
      ],
      units: [
        unit("worker", 14, "player", "arc-harvester"),
        unit("spotter", 40, "player", "arc-scout"),
      ],
      sites: [
        {
          id: "far",
          name: "Far",
          tile: { x: 44, z: 10 },
          initialMaterials: 100,
          remainingMaterials: 100,
        },
      ],
    };
    const { simulation } = fixture(setup);
    simulation.removeActor("spotter");
    simulation.submitCommand({
      kind: "assign-refinery",
      actorId: "worker",
      refineryId: "refinery",
    });
    simulation.submitCommand({
      kind: "gather",
      actorId: "worker",
      siteId: "far",
    });
    simulation.tick();
    expect(simulation.economy!.harvesters[0]!.phase).toBe("travelling");
    const saved = simulation.snapshot();
    // Another worker depleted this site while our Harvester was away.
    saved.economy!.sites[0]!.remainingMaterials = 0;
    const { simulation: loaded } = fixture(setup, saved);
    loaded.tick();
    expect(loaded.economy!.harvesters[0]!.phase).toBe("travelling");
    expect(memoryOf(loaded).sites[0]!.amount).toBe(100);
    advanceSeconds(loaded, 30);
    expect(loaded.economy!.harvesters[0]!.phase).toBe("depleted");
    expect(memoryOf(loaded).sites[0]!.amount).toBe(0);
  });

  test("loot collected out of sight stays known until its tile is seen", () => {
    const { simulation } = fixture({
      units: [unit("trooper", 4), unit("spotter", 30, "player", "arc-scout")],
      loot: [gift(36)],
    });
    expect(memoryOf(simulation).loot).toEqual([{ lootId: "gift", tick: 0 }]);
    simulation.removeActor("spotter");
    simulation.spawnActor(
      createActor({
        id: "collector",
        definitionId: "arc-scout",
        owner: "rival",
        worldPosition: contentMap.tileCenter(36, 10),
      }),
    );
    simulation.tick();
    expect(simulation.economy!.loot[0]!.collected).toBe(true);
    const known = knownEconomy(simulation.economy!, memoryOf(simulation));
    expect(known.loot).toMatchObject([{ id: "gift", collected: false }]);
    expect(memoryOf(simulation, "rival").loot).toEqual([]);
    simulation.spawnActor(
      createActor({
        id: "returning",
        definitionId: "arc-scout",
        owner: "player",
        worldPosition: contentMap.tileCenter(30, 10),
      }),
    );
    expect(memoryOf(simulation).loot).toEqual([]);
  });

  test("saved memory continues exactly as uninterrupted play", () => {
    const setup = {
      units: [unit("trooper", 4), unit("scout", 9, "rival", "arc-scout")],
    };
    const { simulation, content } = fixture(setup);
    moveRival(simulation, "scout", 50);
    advanceSeconds(simulation, 2);
    const saved = parseMission(
      serializeMission(content, simulation.snapshot(), 0.1),
      0.1,
    ).state;
    const { simulation: loaded } = fixture(setup, saved);
    expect(loaded.snapshot()).toEqual(simulation.snapshot());
    advanceSeconds(simulation, 3);
    advanceSeconds(loaded, 3);
    expect(loaded.snapshot()).toEqual(simulation.snapshot());
    expect(sighting(loaded, "scout")).toBeDefined();
  });

  test("malformed memory is rejected", () => {
    const { content } = fixture();
    const state = createScenarioState(content, ARC_ACTOR_DEFINITIONS);
    for (const observations of [
      { nobody: { actors: [], sites: [], loot: [] } },
      { player: { actors: [], sites: [] } },
      { player: { actors: [], sites: [], loot: [{ lootId: "gift" }] } },
      { player: { actors: [], sites: [{ siteId: "missing" }], loot: [] } },
      {
        player: {
          actors: [
            {
              actorId: "b",
              definitionId: "arc-scout",
              owner: "rival",
              worldPosition: { x: 0, z: 0 },
              tick: 0,
            },
            {
              actorId: "a",
              definitionId: "arc-scout",
              owner: "rival",
              worldPosition: { x: 0, z: 0 },
              tick: 0,
            },
          ],
          sites: [],
          loot: [],
        },
      },
    ])
      expect(() => fixture({}, { ...state, observations } as never)).toThrow(
        "invalid observations",
      );
  });
});
