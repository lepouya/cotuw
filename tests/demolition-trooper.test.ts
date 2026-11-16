import { afterEach, expect, test } from "vitest";

import { BASE_CONTENT } from "./helpers/content";
import {
  actorIn,
  advanceSeconds,
  balance,
  command,
  exploredScenarioState,
  savedState,
  startMission,
  stockpiles,
} from "./helpers/scenario";
import { validateCombatDefinition } from "../src/simulation/combat";
import { resolveSetup } from "../src/simulation/mission-setup";
import { defineScenario } from "../src/simulation/scenario";
import { TerrainGrid } from "../src/simulation/terrain";

import type { ActorDefinition } from "../src/simulation/actor";
import type { AttackEvent } from "../src/simulation/combat";
import type {
  MissionSimulation,
  MissionState,
} from "../src/simulation/mission";
import type { Difficulty } from "../src/simulation/mission-setup";
import type { ScenarioDefinition } from "../src/simulation/scenario";

const DEMOLITION = "arc-demolition-trooper";
const TROOPER = "arc-trooper";
const SENTRY = "arc-sentry-turret";
const definitions = BASE_CONTENT.actors;
const definition = (id: string) => definitions.find((d) => d.id === id)!;
const options = {
  width: 64,
  height: 32,
  tileSize: 1,
  terrainTypeIds: ["plain", "path", "rough", "water"],
};
const map = new TerrainGrid(options);
const scenario = (extra: Partial<ScenarioDefinition> = {}) =>
  defineScenario({
    id: "demolition-trooper",
    tileSize: 1,
    terrainTypeIds: options.terrainTypeIds,
    terrain: map.terrainState(),
    owners: [
      { id: "player", faction: "arc" },
      { id: "enemy", faction: "arc" },
    ],
    playerOwner: "player",
    relationships: [{ owners: ["player", "enemy"], relationship: "hostile" }],
    stockpiles: [
      ...stockpiles(1000),
      ...stockpiles(1000, "materials", "enemy"),
    ],
    sites: [],
    loot: [],
    buildings: [
      {
        actorId: "cc",
        definitionId: "arc-command-center-prototype",
        origin: { x: 2, z: 10 },
      },
      {
        actorId: "enemy-cc",
        definitionId: "arc-command-center-prototype",
        origin: { x: 35, z: 10 },
        owner: "enemy",
      },
      {
        actorId: "barracks",
        definitionId: "arc-field-barracks",
        origin: { x: 8, z: 10 },
      },
    ],
    ...extra,
  });
const unit = (
  actorId: string,
  definitionId: string,
  x: number,
  owner = "player",
  z = 12,
) => ({
  actorId,
  definitionId,
  owner,
  tile: { x, z },
});
const simulations: MissionSimulation[] = [];
afterEach(() => simulations.splice(0).forEach((sim) => sim.dispose()));
function fixture(
  content = scenario(),
  state?: MissionState,
  difficulty: Difficulty = "normal",
) {
  const sim = startMission(new TerrainGrid(options), {
    state: state ?? exploredScenarioState(content, definitions),
    definitions,
    tickSeconds: 0.1,
    setup: resolveSetup(difficulty, content),
  }).simulation;
  simulations.push(sim);
  return sim;
}

test.each([-1, NaN, Infinity, -Infinity, null, "54"])(
  "rejects invalid building damage bonus %s",
  (bonus) => {
    const edited = structuredClone(definition(DEMOLITION));
    Object.assign(edited.weapon!, { buildingDamageBonus: bonus });
    expect(() => validateCombatDefinition(edited)).toThrow(/combat definition/);
  },
);

test.each([undefined, 0, 54])(
  "accepts optional building damage bonus %s",
  (bonus) => {
    const edited: ActorDefinition = {
      ...definition(DEMOLITION),
      weapon: { ...definition(DEMOLITION).weapon!, buildingDamageBonus: bonus },
    };
    expect(() => validateCombatDefinition(edited)).not.toThrow();
  },
);

test("rejects a combined building hit that overflows finite damage", () => {
  const edited = structuredClone(definition(DEMOLITION));
  edited.weapon!.damage = Number.MAX_VALUE;
  edited.weapon!.buildingDamageBonus = Number.MAX_VALUE;
  expect(() => validateCombatDefinition(edited)).toThrow(/combat definition/);
});

test.each(["easy", "normal", "hard"] as const)(
  "%s scales the complete building hit and leaves mobile hits at base damage",
  (difficulty) => {
    for (const targetDefinitionId of [
      "arc-materials-refinery",
      "arc-field-barracks",
      SENTRY,
      TROOPER,
      "arc-harvester",
    ]) {
      const targetDefinition = definition(targetDefinitionId);
      const target = targetDefinition.footprint
        ? {
            buildings: [
              {
                actorId: "target",
                definitionId: targetDefinitionId,
                origin: { x: 30, z: 12 },
              },
            ],
          }
        : { units: [unit("target", targetDefinitionId, 30)] };
      const content = scenario({
        ...target,
        units: [...(target.units ?? []), unit("demo", DEMOLITION, 24, "enemy")],
      });
      const sim = fixture(content, undefined, difficulty);
      expect(
        command(
          sim,
          { kind: "attack", actorId: "demo", targetId: "target" },
          { owner: "enemy" },
        ).accepted,
      ).toBe(true);
      const hit = sim.attacks.find(({ attackerId }) => attackerId === "demo")!;
      const damage = targetDefinition.footprint ? 60 : 6;
      expect(hit.damage).toBeCloseTo(
        damage * resolveSetup(difficulty, content).enemyScale,
      );
      expect(sim.actorById("target")!.health).toBeCloseTo(
        targetDefinition.health! - hit.damage,
      );
      expect(
        sim.attacks.filter(({ attackerId }) => attackerId === "demo"),
      ).toHaveLength(1);
    }
  },
);

test.each(["easy", "normal", "hard"] as const)(
  "%s scales the target's effective building health after the bonus",
  (difficulty) => {
    const content = scenario({ units: [unit("demo", DEMOLITION, 34)] });
    const sim = fixture(content, undefined, difficulty);
    expect(
      command(sim, { kind: "attack", actorId: "demo", targetId: "enemy-cc" })
        .accepted,
    ).toBe(true);
    expect(
      sim.attacks.find(({ attackerId }) => attackerId === "demo")!.damage,
    ).toBe(60);
    expect(sim.actorById("enemy-cc")!.health).toBeCloseTo(
      definition("arc-command-center-prototype").health! -
        60 / resolveSetup(difficulty, content).enemyScale,
    );
  },
);

test("unfinished buildings receive the bonus; ordinary weapons keep base damage", () => {
  const base = scenario();
  const content = scenario({
    buildings: base.buildings!.map((building) =>
      building.actorId === "barracks"
        ? { ...building, origin: { x: 30, z: 12 } }
        : building,
    ),
    units: [
      unit("demo", DEMOLITION, 24, "enemy"),
      unit("trooper", TROOPER, 27, "enemy", 15),
    ],
  });
  const state = exploredScenarioState(content, definitions);
  actorIn(state, "barracks").construction = {
    paidCost: 100,
    completedTicks: 0,
    totalTicks: 80,
  };
  const sim = fixture(content, state);
  sim.submitCommand(
    { kind: "attack", actorId: "demo", targetId: "barracks" },
    { owner: "enemy" },
  );
  sim.submitCommand(
    { kind: "attack", actorId: "trooper", targetId: "barracks" },
    { owner: "enemy" },
  );
  expect(sim.tick().every(({ accepted }) => accepted)).toBe(true);
  expect(
    sim.attacks.map(({ attackerId, damage }) => [attackerId, damage]),
  ).toEqual([
    ["demo", 60],
    ["trooper", 10],
  ]);
  expect(sim.actorById("barracks")!.health).toBe(730);
});

test("Barracks shares its paid queue and resumes saved training deterministically", () => {
  const content = scenario();
  const sim = fixture(content);
  for (const [actorId, definitionId] of [
    ["demo", DEMOLITION],
    ["trooper", TROOPER],
  ])
    expect(
      command(sim, {
        kind: "train-unit",
        producerId: "barracks",
        actorId,
        definitionId,
      }).accepted,
    ).toBe(true);
  expect(balance(sim)).toBe(925);
  advanceSeconds(sim, 3);
  const resumed = fixture(content, savedState(content, sim));
  for (const running of [sim, resumed]) {
    advanceSeconds(running, 5);
    expect(running.actorById("demo")).toBeDefined();
    expect(running.actorById("trooper")).toBeUndefined();
    advanceSeconds(running, 4);
    expect(running.actorById("trooper")).toBeDefined();
  }
  expect(resumed.snapshot()).toEqual(sim.snapshot());
});

test("Medics heal Demolition Troopers and combat cooldown survives a saved continuation", () => {
  const content = scenario({
    units: [unit("demo", DEMOLITION, 28), unit("medic", "arc-medic", 27)],
  });
  const state = exploredScenarioState(content, definitions);
  actorIn(state, "demo").health = 20;
  const sim = fixture(content, state);
  expect(
    command(sim, { kind: "attack", actorId: "demo", targetId: "enemy-cc" })
      .accepted,
  ).toBe(true);
  advanceSeconds(sim, 1);
  expect(sim.actorById("demo")!.health).toBeGreaterThan(20);
  expect(sim.actorById("demo")!.combat!.weaponReadyTick).toBeGreaterThan(
    sim.snapshot().tick,
  );
  const resumed = fixture(content, savedState(content, sim));
  for (const running of [sim, resumed]) advanceSeconds(running, 8);
  expect(resumed.snapshot()).toEqual(sim.snapshot());
});

test("a Demolition Trooper destroys an online Sentry without return fire", () => {
  const base = scenario();
  const content = scenario({
    buildings: [
      ...base.buildings!,
      {
        actorId: "sentry",
        definitionId: SENTRY,
        origin: { x: 32, z: 12 },
        owner: "enemy",
      },
    ],
    units: [unit("demo", DEMOLITION, 24)],
  });
  const sim = fixture(content);
  expect(
    sim.support!.nodes.find(({ actorId }) => actorId === "sentry")!.connected,
  ).toBe(true);
  expect(
    command(sim, { kind: "attack", actorId: "demo", targetId: "sentry" })
      .accepted,
  ).toBe(true);
  advanceSeconds(sim, 16);
  expect(sim.actorById("sentry")).toBeUndefined();
  expect(sim.actorById("demo")!.health).toBeUndefined();
});

test("an exposed Demolition Trooper loses to a cheaper Trooper", () => {
  const sim = fixture(
    scenario({
      units: [
        unit("demo", DEMOLITION, 20),
        unit("trooper", TROOPER, 26, "enemy"),
      ],
    }),
  );
  advanceSeconds(sim, 20);
  expect(sim.actorById("demo")).toBeUndefined();
  expect(sim.actorById("trooper")).toBeDefined();
});

test("a Trooper screen protects a specialist while it breaks a defended position", () => {
  const base = scenario();
  const run = (screened: boolean) => {
    const content = scenario({
      buildings: [
        ...base.buildings!,
        {
          actorId: "sentry",
          definitionId: SENTRY,
          origin: { x: 32, z: 12 },
          owner: "enemy",
        },
      ],
      units: [
        unit("demo", DEMOLITION, 24),
        ...(screened
          ? [10, 12, 14, 16].map((z, i) =>
              unit(`screen-${i}`, TROOPER, 27, "player", z),
            )
          : []),
        unit("defender-a", TROOPER, 29, "enemy", 11),
        unit("defender-b", TROOPER, 29, "enemy", 14),
      ],
    });
    const sim = fixture(content);
    expect(
      command(sim, { kind: "attack", actorId: "demo", targetId: "sentry" })
        .accepted,
    ).toBe(true);
    const hits: AttackEvent[] = [...sim.attacks];
    for (let tick = 0; tick < 25 / sim.tickSeconds; tick++) {
      sim.tick();
      hits.push(...sim.attacks);
    }
    return { sim, hits };
  };
  const exposed = run(false).sim;
  expect(exposed.actorById("demo")).toBeUndefined();
  expect(exposed.actorById("sentry")).toBeDefined();
  const { sim, hits } = run(true);
  expect(sim.actorById("defender-a")).toBeUndefined();
  expect(sim.actorById("defender-b")).toBeUndefined();
  expect(sim.actorById("sentry")).toBeUndefined();
  expect(sim.actorById("demo")).toBeDefined();
  expect(
    hits.some(
      ({ attackerId, targetId }) =>
        attackerId === "demo" && targetId === "sentry",
    ),
  ).toBe(true);
  for (const defender of ["defender-a", "defender-b"])
    expect(
      hits.some(
        ({ attackerId, targetId }) =>
          attackerId.startsWith("screen-") && targetId === defender,
      ),
    ).toBe(true);
});
