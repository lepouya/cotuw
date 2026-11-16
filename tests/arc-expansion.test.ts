import { afterEach, expect, test } from "vitest";

import { BASE_CONTENT } from "./helpers/content";
import {
  advanceSeconds,
  balance,
  command,
  deposited,
  exploredScenarioState,
  playerOwners,
  savedState,
  spawnUnit,
  startMission,
  stockpiles,
  untilSeconds,
} from "./helpers/scenario";
import { defineScenario } from "../src/simulation/scenario";
import { TerrainGrid } from "../src/simulation/terrain";
import { createTilePlacedActor } from "../src/simulation/placement";
import { createSkirmishScenario } from "../src/content/skirmish";
import { evaluateSkirmish } from "../src/simulation/skirmish";

import type {
  MissionSimulation,
  MissionState,
} from "../src/simulation/mission";

const RELAY = "arc-relay-station";
const SENTRY = "arc-sentry-turret";
const REFINERY = "arc-materials-refinery";
const definitions = BASE_CONTENT.actors;
const definition = (id: string) => definitions.find((d) => d.id === id)!;
const options = {
  width: 64,
  height: 32,
  tileSize: 1,
  terrainTypeIds: ["plain", "path", "rough", "water"],
};
const map = new TerrainGrid(options);
const scenario = defineScenario({
  id: "arc-expansion",
  ...playerOwners("arc"),
  tileSize: 1,
  terrainTypeIds: options.terrainTypeIds,
  terrain: map.terrainState(),
  buildings: [
    {
      actorId: "cc",
      definitionId: "arc-command-center-prototype",
      origin: { x: 2, z: 10 },
    },
  ],
  stockpiles: stockpiles(2000),
  sites: [
    {
      id: "remote-materials",
      name: "Remote Materials",
      tile: { x: 34, z: 10 },
      initialMaterials: 100,
      remainingMaterials: 100,
    },
  ],
  loot: [],
});
const building = (id: string, definitionId: string, x: number, z = 10) =>
  createTilePlacedActor(
    map,
    definition(definitionId),
    {
      actorId: id,
      origin: { x, z },
    },
    "player",
  );
const initial = () => exploredScenarioState(scenario, definitions);
const simulations: MissionSimulation[] = [];
afterEach(() => simulations.splice(0).forEach((sim) => sim.dispose()));
function fixture(state: MissionState = initial()) {
  const { simulation } = startMission(new TerrainGrid(options), {
    state,
    definitions,
    tickSeconds: 0.1,
  });
  simulations.push(simulation);
  return simulation;
}
const connected = (sim: MissionSimulation, id: string) =>
  sim.support!.nodes.find((node) => node.actorId === id)!.connected;
const place = (
  sim: MissionSimulation,
  id: string,
  definitionId: string,
  x: number,
) =>
  command(sim, {
    kind: "place-actor",
    actorId: id,
    definitionId,
    origin: { x, z: 10 },
  });

test("a paid Relay extends placement only after completion and adds no capacity", () => {
  const sim = fixture();
  expect(definition(RELAY).materialsCost).toBeLessThan(
    definition(REFINERY).materialsCost!,
  );
  expect(definition(RELAY).support!.radius).toBeGreaterThan(
    definition(REFINERY).support!.radius,
  );
  expect(definition(RELAY).weapon).toBeUndefined();
  expect(definition(RELAY).infrastructure).toBeUndefined();
  expect(place(sim, "remote", REFINERY, 28)).toMatchObject({
    accepted: false,
    reason: "outside-support",
  });
  expect(place(sim, "relay", RELAY, 13).accepted).toBe(true);
  expect(balance(sim)).toBe(1950);
  expect(
    sim.support!.nodes.find(({ actorId }) => actorId === "relay")!.complete,
  ).toBe(false);
  expect(place(sim, "remote", REFINERY, 28).accepted).toBe(false);
  advanceSeconds(sim, 8);
  expect(connected(sim, "relay")).toBe(true);
  expect(place(sim, "remote", REFINERY, 28).accepted).toBe(true);
  advanceSeconds(sim, 8);
  expect(connected(sim, "remote")).toBe(true);
  expect(balance(sim)).toBe(1850);
  expect(
    command(sim, {
      kind: "train-unit",
      actorId: "worker",
      producerId: "remote",
      definitionId: "arc-harvester",
    }).accepted,
  ).toBe(true);
  untilSeconds(sim, () => !!sim.actorById("worker"));
  expect(
    command(sim, {
      kind: "gather",
      actorId: "worker",
      siteId: "remote-materials",
    }).accepted,
  ).toBe(true);
  untilSeconds(sim, () => deposited(sim) === 100);
  expect(sim.economy!.harvesters[0]!.refineryId).toBe("remote");
});

test("support loss pauses remote work and reconnection resumes it after saving", () => {
  const state = initial();
  state.actors.push(building("relay", RELAY, 13));
  const sim = fixture(state);
  expect(place(sim, "remote", REFINERY, 28).accepted).toBe(true);
  advanceSeconds(sim, 2);
  sim.removeActor("relay");
  sim.tick();
  const progress = sim.actorById("remote")!.construction!.completedTicks;
  advanceSeconds(sim, 2);
  expect(sim.actorById("remote")!.construction!.completedTicks).toBe(progress);
  const restored = fixture(savedState(scenario, sim));
  for (const running of [sim, restored]) {
    expect(place(running, "replacement", RELAY, 13).accepted).toBe(true);
    advanceSeconds(running, 16);
    expect(running.actorById("remote")!.construction).toBeUndefined();
    expect(connected(running, "remote")).toBe(true);
  }
  expect(restored.snapshot()).toEqual(sim.snapshot());
});

test("redundant Relay paths keep a remote Refinery connected", () => {
  const state = initial();
  state.actors.push(
    building("relay", RELAY, 13),
    building("alternate", RELAY, 15, 12),
    building("remote", REFINERY, 28),
  );
  const sim = fixture(state);
  sim.removeActor("relay");
  sim.tick();
  expect(connected(sim, "remote")).toBe(true);
  sim.removeActor("alternate");
  sim.tick();
  expect(connected(sim, "remote")).toBe(false);
  expect(sim.actorById("remote")).toBeDefined();
});

const defended = () => {
  const state = initial();
  state.actors.push(
    building("relay", RELAY, 13),
    building("sentry", SENTRY, 26, 14),
  );
  return state;
};
const enemy = (sim: MissionSimulation, id: string, x: number, z: number) =>
  spawnUnit(sim, id, "arc-scout", { x, z }, "wildlife");

test("Sentries acquire stably, accept priority targets, and never move or rotate placement", () => {
  const sim = fixture(defended());
  const sentry = sim.actorById("sentry")!;
  const position = sentry.worldPosition;
  const facing = sentry.facing;
  enemy(sim, "b", position.x + 3, position.z);
  enemy(sim, "a", position.x - 3, position.z);
  sim.tick();
  expect(sim.attacks).toContainEqual(
    expect.objectContaining({ attackerId: "sentry", targetId: "a" }),
  );
  expect(
    command(sim, { kind: "attack", actorId: "sentry", targetId: "b" }).accepted,
  ).toBe(true);
  advanceSeconds(sim, 0.3);
  expect(sim.actorById("sentry")!.combat!.attack!.targetId).toBe("b");
  expect(sim.actorById("sentry")!.combat!.aimFacing).toBeCloseTo(Math.PI / 2);
  expect(sim.actorById("sentry")!.facing).toBe(facing);
  expect(sim.actorById("sentry")!.worldPosition).toEqual(position);
  expect(sim.actorById("sentry")!.movement).toBeUndefined();
  const restored = fixture(savedState(scenario, sim));
  for (const running of [sim, restored]) advanceSeconds(running, 3);
  expect(restored.snapshot()).toEqual(sim.snapshot());
});

test("unfinished and disconnected Sentries cannot fire even with allied vision", () => {
  const state = defended();
  const sentry = state.actors.find(({ id }) => id === "sentry")!;
  sentry.construction = { paidCost: 75, completedTicks: 0, totalTicks: 80 };
  const sim = fixture(state);
  const raiderPosition = map.tileCenter(30, 15);
  enemy(sim, "raider", raiderPosition.x, raiderPosition.z);
  spawnUnit(sim, "observer", "arc-scout", map.tileCenter(31, 15));
  sim.tick();
  expect(sim.attacks).toEqual([]);
  advanceSeconds(sim, 8.3);
  expect(sim.actorById("raider")!.health).toBeLessThan(
    definition("arc-scout").health!,
  );
  sim.removeActor("relay");
  const restored = fixture(savedState(scenario, sim));
  for (const running of [sim, restored]) {
    const health = running.actorById("raider")!.health;
    expect(running.detects("player", running.actorById("raider")!)).toBe(true);
    advanceSeconds(running, 2);
    expect(running.actorById("raider")!.health).toBe(health);
    expect(running.attacks).toEqual([]);
    running.spawnActor(building("replacement", RELAY, 13));
    advanceSeconds(running, 0.3);
    expect(running.actorById("raider")!.health).toBeLessThan(health!);
  }
  expect(restored.snapshot()).toEqual(sim.snapshot());
});

test("Turrets answer infantry at their firing range and protect against small raids", () => {
  expect(definition(SENTRY).weapon!.range).toBeGreaterThan(
    definition("arc-trooper").weapon!.range,
  );
  expect(definition(SENTRY).health).toBeLessThan(definition(REFINERY).health!);
  const sim = fixture(defended());
  const post = sim.actorById("sentry")!.worldPosition;
  spawnUnit(
    sim,
    "raider",
    "arc-trooper",
    { x: post.x + 7, z: post.z },
    "wildlife",
  );
  advanceSeconds(sim, 12);
  expect(sim.actorById("raider")).toBeUndefined();
  expect(sim.actorById("sentry")).toBeDefined();
});

test("automatic targeting includes body edges and ignores allies and blocked shots", () => {
  const sim = fixture(defended());
  const position = sim.actorById("sentry")!.worldPosition;
  spawnUnit(sim, "friendly", "arc-scout", { x: position.x + 1, z: position.z });
  enemy(sim, "edge", position.x, position.z + 7.2);
  sim.tick();
  expect(sim.attacks).toContainEqual(
    expect.objectContaining({ targetId: "edge" }),
  );
  sim.spawnActor(building("blocker", RELAY, 29, 14));
  enemy(sim, "blocked", position.x + 4.5, position.z);
  command(sim, { kind: "attack", actorId: "sentry", targetId: "blocked" });
  advanceSeconds(sim, 0.3);
  expect(sim.actorById("sentry")!.combat!.attack!.targetId).toBe("edge");
  expect(sim.actorById("blocked")!.health).toBeUndefined();
  expect(sim.actorById("friendly")!.health).toBeUndefined();
});

test.each([0.5, 1])(
  "Turrets acquire rotated footprints by their edge at tile size %s",
  (tileSize) => {
    const targetX = 14 + definition(SENTRY).weapon!.range / tileSize;
    for (const quarterTurns of [0, 1]) {
      const terrain = new TerrainGrid({ ...options, tileSize });
      const state = exploredScenarioState(
        {
          ...scenario,
          tileSize,
          buildings: [
            ...scenario.buildings,
            {
              actorId: "sentry",
              definitionId: SENTRY,
              origin: { x: 13, z: 10 },
            },
            {
              actorId: "target",
              definitionId: REFINERY,
              owner: "wildlife",
              origin: { x: targetX, z: 10 + quarterTurns * 2 },
              quarterTurns,
            },
          ],
        },
        definitions,
      );
      const { simulation } = startMission(terrain, {
        state,
        definitions,
        tickSeconds: 0.1,
      });
      simulations.push(simulation);
      simulation.tick();
      expect(simulation.attacks).toContainEqual(
        expect.objectContaining({ attackerId: "sentry", targetId: "target" }),
      );
      expect(simulation.actorById("sentry")!.movement).toBeUndefined();
    }
  },
);

test("assembled skirmishes count completed Sentries but never Relays", () => {
  const skirmish = createSkirmishScenario({
    factions: { west: "arc", east: "arc" },
    playerSlot: "west",
    difficulty: "normal",
  }).skirmish!;
  expect(skirmish.qualifyingDefinitionIds).toContain(SENTRY);
  expect(skirmish.qualifyingDefinitionIds).not.toContain(RELAY);
  const relay = { ...building("relay", RELAY, 13), owner: "west" };
  const turret = { ...building("sentry", SENTRY, 26, 14), owner: "west" };
  const rival = { ...building("rival", REFINERY, 40), owner: "east" };
  const evaluate = (actors: (typeof relay)[]) =>
    evaluateSkirmish(skirmish, actors, "west", 1);
  expect(evaluate([relay, rival])).toMatchObject({
    kind: "defeat",
    eliminatedOwners: ["west"],
  });
  expect(evaluate([turret, rival])).toBeUndefined();
  turret.construction = { paidCost: 75, completedTicks: 0, totalTicks: 80 };
  expect(evaluate([turret, rival])).toMatchObject({ kind: "defeat" });
});
