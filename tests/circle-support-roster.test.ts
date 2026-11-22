import { afterEach, expect, test } from "vitest";

import { BASE_CONTENT } from "./helpers/content";
import {
  actorIn,
  advanceCollectingHits,
  advanceSeconds,
  balance,
  command,
  exploredScenarioState,
  savedState,
  startMission,
  stockpiles,
} from "./helpers/scenario";
import { defineScenario } from "../src/simulation/scenario";
import { TerrainGrid } from "../src/simulation/terrain";
import { serviceRejection } from "../src/simulation/unit-support";

import type {
  MissionSimulation,
  MissionState,
} from "../src/simulation/mission";
import type { ScenarioDefinition } from "../src/simulation/scenario";

const HEALER = "circle-healer";
const ARTIFICER = "circle-artificer";
const RAM = "circle-briar-ram";
const SPIRE = "circle-thornspire";
const NURSERY = "circle-construct-nursery";
const SENTINEL = "circle-sentinel";
const TROOPER = "arc-trooper";
const definitions = BASE_CONTENT.actors;
const definitionsById = new Map(definitions.map((each) => [each.id, each]));
const definition = (id: string) => definitionsById.get(id)!;
const options = {
  width: 64,
  height: 32,
  tileSize: 1,
  terrainTypeIds: ["plain", "path", "rough", "water"],
};
const map = new TerrainGrid(options);
const building = (
  actorId: string,
  definitionId: string,
  x: number,
  owner = "player",
  z = 10,
) => ({ actorId, definitionId, origin: { x, z }, owner });
const unit = (
  actorId: string,
  definitionId: string,
  x: number,
  owner = "player",
  z = 12,
) => ({ actorId, definitionId, owner, tile: { x, z } });
const BASE_BUILDINGS = [
  building("heart", "circle-heartgrove", 2),
  building("muster", "circle-musterhall", 7),
  building("nursery", NURSERY, 11),
  building("enemy-heart", "circle-heartgrove", 58, "enemy"),
];
const scenario = (extra: Partial<ScenarioDefinition> = {}) =>
  defineScenario({
    id: "circle-support-roster",
    tileSize: 1,
    terrainTypeIds: options.terrainTypeIds,
    terrain: map.terrainState(),
    owners: [
      { id: "player", faction: "circle" },
      { id: "enemy", faction: "circle" },
      { id: "raiders", faction: "arc" },
    ],
    playerOwner: "player",
    relationships: [
      { owners: ["player", "enemy"], relationship: "hostile" },
      { owners: ["player", "raiders"], relationship: "hostile" },
      { owners: ["enemy", "raiders"], relationship: "hostile" },
    ],
    stockpiles: [
      ...stockpiles(2000, "lifebloom"),
      ...stockpiles(2000, "lifebloom", "enemy"),
    ],
    sites: [],
    loot: [],
    buildings: BASE_BUILDINGS,
    ...extra,
  });
const simulations: MissionSimulation[] = [];
afterEach(() => simulations.splice(0).forEach((sim) => sim.dispose()));
function fixture(content = scenario(), state?: MissionState) {
  const sim = startMission(new TerrainGrid(options), {
    state: state ?? exploredScenarioState(content, definitions),
    definitions,
    tickSeconds: 0.1,
  }).simulation;
  simulations.push(sim);
  return sim;
}
const train = (
  sim: MissionSimulation,
  producerId: string,
  definitionId: string,
  actorId = definitionId,
) => command(sim, { kind: "train-unit", producerId, actorId, definitionId });
test("Musterhalls train Healers; the Nursery trains Briar Rams and Artificers", () => {
  expect(definition("circle-musterhall").production!.unitDefinitionIds).toEqual(
    [SENTINEL, "circle-wayfinder", HEALER],
  );
  expect(definition(NURSERY).production!.unitDefinitionIds).toEqual([
    RAM,
    ARTIFICER,
  ]);
  const sim = fixture();
  expect(train(sim, "nursery", HEALER).accepted).toBe(false);
  expect(train(sim, "muster", RAM).accepted).toBe(false);
  expect(train(sim, "heart", ARTIFICER).accepted).toBe(false);
  expect(train(sim, "muster", HEALER).accepted).toBe(true);
  advanceSeconds(sim, 6.5);
  expect(sim.actorById(HEALER)).toBeDefined();
});

test("the Nursery shares one paid queue and resumes saved training deterministically", () => {
  const content = scenario();
  const sim = fixture(content);
  expect(train(sim, "nursery", RAM).accepted).toBe(true);
  expect(train(sim, "nursery", ARTIFICER).accepted).toBe(true);
  expect(balance(sim, "lifebloom")).toBe(1860);
  advanceSeconds(sim, 5);
  const resumed = fixture(content, savedState(content, sim));
  for (const running of [sim, resumed]) {
    advanceSeconds(running, 7.5);
    expect(running.actorById(RAM)).toBeDefined();
    expect(running.actorById(ARTIFICER)).toBeUndefined();
    advanceSeconds(running, 6);
    expect(running.actorById(ARTIFICER)).toBeDefined();
  }
  expect(resumed.snapshot()).toEqual(sim.snapshot());
});

test("Healers serve personnel and Artificers serve living constructs only", () => {
  const content = scenario({
    units: [
      unit("healer", HEALER, 20),
      unit("artificer", ARTIFICER, 21),
      unit("sentinel", SENTINEL, 22),
      unit("ram", RAM, 24),
      unit("other-healer", HEALER, 26),
    ],
  });
  const state = exploredScenarioState(content, definitions);
  for (const id of ["artificer", "sentinel", "ram", "other-healer", "muster"])
    actorIn(state, id).health = 30;
  actorIn(state, "healer").health = 30;
  const reject = (providerId: string, targetId: string) =>
    serviceRejection(
      actorIn(state, providerId),
      actorIn(state, targetId),
      definitionsById,
      state.actors,
    );
  expect(reject("healer", "sentinel")).toBeUndefined();
  expect(reject("healer", "artificer")).toBeUndefined();
  expect(reject("healer", "other-healer")).toBeUndefined();
  expect(reject("healer", "ram")).toBe("invalid-service-target");
  expect(reject("healer", "healer")).toBe("invalid-service-target");
  expect(reject("artificer", "ram")).toBeUndefined();
  expect(reject("artificer", "sentinel")).toBe("invalid-service-target");
  expect(reject("artificer", "muster")).toBe("invalid-service-target");
  expect(reject("sentinel", "ram")).toBe("invalid-provider");
});

test("idle Healers and Artificers restore their own kinds through a saved continuation", () => {
  const content = scenario({
    units: [
      unit("healer", HEALER, 20),
      unit("sentinel", SENTINEL, 21),
      unit("artificer", ARTIFICER, 20, "player", 16),
      unit("ram", RAM, 22, "player", 16),
    ],
  });
  const state = exploredScenarioState(content, definitions);
  actorIn(state, "sentinel").health = 50;
  actorIn(state, "ram").health = 100;
  const sim = fixture(content, state);
  advanceSeconds(sim, 3);
  expect(sim.actorById("healer")!.service?.targetId).toBe("sentinel");
  expect(sim.actorById("artificer")!.service?.targetId).toBe("ram");
  expect(sim.actorById("sentinel")!.health).toBeGreaterThan(50);
  expect(sim.actorById("ram")!.health).toBeGreaterThan(100);
  const resumed = fixture(content, savedState(content, sim));
  for (const running of [sim, resumed]) advanceSeconds(running, 30);
  expect(resumed.snapshot()).toEqual(sim.snapshot());
  expect(sim.actorById("sentinel")!.health).toBeUndefined();
  expect(sim.actorById("ram")!.health).toBeUndefined();
  expect(sim.actorById("healer")!.service).toBeUndefined();
});

test("Briar Ram strikes add the building bonus to one target, including unfinished growth", () => {
  const content = scenario({
    buildings: [...BASE_BUILDINGS, building("growing", SPIRE, 30, "enemy", 11)],
    units: [unit("ram", RAM, 27), unit("target", SENTINEL, 27, "enemy", 16)],
  });
  const state = exploredScenarioState(content, definitions);
  actorIn(state, "growing").construction = {
    paidCost: 100,
    completedTicks: 0,
    totalTicks: 100,
  };
  const sim = fixture(content, state);
  expect(
    command(sim, { kind: "attack", actorId: "ram", targetId: "growing" })
      .accepted,
  ).toBe(true);
  const hits = advanceCollectingHits(sim, 3).filter(
    ({ attackerId }) => attackerId === "ram",
  );
  expect(hits.length).toBeGreaterThan(0);
  expect(
    hits.every(
      ({ targetId, damage }) => targetId === "growing" && damage === 68,
    ),
  ).toBe(true);
  expect(sim.actorById("growing")!.health).toBe(600 - 68 * hits.length);

  const mobile = fixture(content, exploredScenarioState(content, definitions));
  command(mobile, { kind: "attack", actorId: "ram", targetId: "target" });
  const blows = advanceCollectingHits(mobile, 5).filter(
    ({ attackerId }) => attackerId === "ram",
  );
  expect(blows.length).toBeGreaterThan(0);
  expect(blows.every(({ damage }) => damage === 8)).toBe(true);
});

test.each([
  ["side", 36, 11],
  ["corner", 37, 15],
])(
  "a Briar Ram reaches a large building from its %s and batters it",
  (_, x, z) => {
    const content = scenario({
      buildings: [
        ...BASE_BUILDINGS,
        building("target", "circle-musterhall", 40, "enemy", 10),
      ],
      units: [unit("ram", RAM, x, "player", z)],
    });
    const sim = fixture(content);
    expect(
      command(sim, { kind: "attack", actorId: "ram", targetId: "target" })
        .accepted,
    ).toBe(true);
    advanceSeconds(sim, 30);
    expect(sim.actorById("target")).toBeUndefined();
  },
);

test("growing Thornspires hold fire; completed ones engage detected hostiles", () => {
  const content = scenario({
    buildings: [...BASE_BUILDINGS, building("spire", SPIRE, 30, "player", 11)],
    units: [unit("raider", TROOPER, 36, "raiders")],
  });
  const state = exploredScenarioState(content, definitions);
  actorIn(state, "spire").construction = {
    paidCost: 100,
    completedTicks: 0,
    totalTicks: 100,
  };
  const growing = fixture(content, state);
  expect(
    advanceCollectingHits(growing, 3).some(
      ({ attackerId }) => attackerId === "spire",
    ),
  ).toBe(false);
  const grown = fixture(content);
  const hits = advanceCollectingHits(grown, 3).filter(
    ({ attackerId }) => attackerId === "spire",
  );
  expect(hits.map(({ damage, targetId }) => [targetId, damage])[0]).toEqual([
    "raider",
    20,
  ]);
});

test("a Thornspire defeats a three-Trooper raid that attacks it", () => {
  const content = scenario({
    buildings: [...BASE_BUILDINGS, building("spire", SPIRE, 30, "player", 11)],
    units: [12, 14, 16].map((z, index) =>
      unit(`raider-${index}`, TROOPER, 36, "raiders", z),
    ),
  });
  const sim = fixture(content);
  for (let index = 0; index < 3; index++)
    sim.submitCommand(
      { kind: "attack", actorId: `raider-${index}`, targetId: "spire" },
      { owner: "raiders" },
    );
  advanceSeconds(sim, 40);
  expect(sim.actorById("spire")).toBeDefined();
  for (let index = 0; index < 3; index++)
    expect(sim.actorById(`raider-${index}`)).toBeUndefined();
});

test("a lone Briar Ram withstands Thornspire fire long enough to destroy it", () => {
  const content = scenario({
    buildings: [...BASE_BUILDINGS, building("spire", SPIRE, 40, "enemy", 11)],
    units: [unit("ram", RAM, 35)],
  });
  const sim = fixture(content);
  expect(
    command(sim, { kind: "attack", actorId: "ram", targetId: "spire" })
      .accepted,
  ).toBe(true);
  const hits = advanceCollectingHits(sim, 30);
  expect(sim.actorById("spire")).toBeUndefined();
  expect(sim.actorById("ram")).toBeDefined();
  expect(
    hits.some(
      ({ attackerId, targetId }) =>
        attackerId === "spire" && targetId === "ram",
    ),
  ).toBe(true);
});

test("two Sentinels defeat an exposed Briar Ram that costs more", () => {
  const sim = fixture(
    scenario({
      units: [
        unit("ram", RAM, 30, "enemy"),
        unit("sentinel-a", SENTINEL, 26, "player", 11),
        unit("sentinel-b", SENTINEL, 26, "player", 13),
      ],
    }),
  );
  advanceSeconds(sim, 40);
  expect(sim.actorById("ram")).toBeUndefined();
  expect(
    ["sentinel-a", "sentinel-b"].filter((id) => sim.actorById(id)),
  ).not.toHaveLength(0);
  expect(2 * definition(SENTINEL).lifebloomCost!).toBeLessThan(
    definition(RAM).lifebloomCost!,
  );
});

test("Thornspires and Nurseries repair through Heartgrove slots with Lifebloom", () => {
  const content = scenario({
    buildings: [...BASE_BUILDINGS, building("spire", SPIRE, 30, "player", 11)],
  });
  const state = exploredScenarioState(content, definitions);
  actorIn(state, "spire").health = 300;
  actorIn(state, "nursery").health = 450;
  const sim = fixture(content, state);
  expect(command(sim, { kind: "repair", actorId: "spire" }).accepted).toBe(
    true,
  );
  expect(command(sim, { kind: "repair", actorId: "nursery" }).accepted).toBe(
    true,
  );
  expect(sim.actorById("spire")!.repair).toMatchObject({ active: true });
  // One Heartgrove slot serves one repair at a time.
  expect(sim.actorById("nursery")!.repair!.active).toBeUndefined();
  advanceSeconds(sim, 3);
  expect(sim.actorById("spire")!.health).toBeGreaterThan(300);
  expect(balance(sim, "lifebloom")).toBeLessThan(2000);
});
