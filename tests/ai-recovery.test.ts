import { beforeAll, expect, test } from "vitest";

import { MIRROR, resumeMirror, runTicks } from "./helpers/ai-mirror";
import { balance, savedState, setBalance } from "./helpers/scenario";
import { createSessionSimulation } from "../src/mission-loading";
import { BUILT_IN_AI_CONCERNS } from "../src/simulation/ai-concerns";
import {
  secondsToTicks,
  SIMULATION_TICK_SECONDS,
} from "../src/simulation/clock";
import { createHarvesterState } from "../src/simulation/harvesting";
import {
  createScenarioState,
  defineScenario,
} from "../src/simulation/scenario";
import { TerrainGrid } from "../src/simulation/terrain";

import type { CommandOutcome } from "../src/simulation/command";
import type {
  MissionSimulation,
  MissionState,
} from "../src/simulation/mission";

const seconds = (count: number) =>
  secondsToTicks(count, SIMULATION_TICK_SECONDS);
// Undisturbed by raids and attacks, so only the losses below matter.
const CONCERNS = new Map(BUILT_IN_AI_CONCERNS).set("offense", () => {});

let developed: MissionState;

beforeAll(() => {
  const sim = createSessionSimulation(MIRROR, undefined, CONCERNS);
  try {
    runTicks(sim, seconds(6 * 60));
    developed = sim.snapshot();
  } finally {
    sim.dispose();
  }
}, 30_000);

const westOf = (sim: MissionSimulation | MissionState, definitionId: string) =>
  sim.actors.filter(
    (actor) => actor.owner === "west" && actor.definitionId === definitionId,
  );
const spent = (sim: MissionSimulation) =>
  sim.metrics!.owners.find(({ owner }) => owner === "west")!.spent.materials;

/** Destroys west's actors of a type, then records each tick's posture. */
function afterLoss(state: MissionState, ...definitionIds: string[]) {
  const sim = resumeMirror(state, CONCERNS);
  for (const definitionId of definitionIds)
    for (const { id } of westOf(sim, definitionId))
      sim.submitCommand(
        { kind: "remove-actor", actorId: id },
        { owner: "west" },
      );
  const postures = new Set<string>();
  const results: CommandOutcome[] = [];
  const run = (ticks: number, until: () => boolean) => {
    for (let tick = 0; tick < ticks && !until(); tick++) {
      results.push(...sim.tick());
      postures.add(sim.ai.west!.posture);
    }
    expect(until()).toBe(true);
  };
  return { sim, postures, results, run };
}

const rejected = (results: readonly CommandOutcome[]) =>
  results.filter(({ issuer, accepted }) => issuer.ai && !accepted);

test("an established base keeps a reserve for a replacement Harvester", () => {
  expect(developed.ai.west!.posture).not.toBe("establishing");
  expect(developed.ai.west!.budgets.recovery!.materials).toBeCloseTo(50);
});

test("losing every Harvester recovers income from the reserve", () => {
  const state = structuredClone(developed);
  const { sim, postures, results, run } = afterLoss(state, "arc-harvester");
  try {
    const before = spent(sim);
    run(seconds(5), () => sim.ai.west!.posture === "recovering");
    run(seconds(30), () => sim.ai.west!.posture === "developing");
    expect(postures).toContain("recovering");
    expect(westOf(sim, "arc-harvester").length).toBeGreaterThan(0);
    expect(spent(sim) - before).toBeGreaterThanOrEqual(50);
    expect(rejected(results)).toEqual([]);
  } finally {
    sim.dispose();
  }
}, 30_000);

test("income and recovery do not queue the same replacement worker", () => {
  const state = structuredClone(developed);
  setBalance(state, 1000, "materials", "west");
  state.ai.west!.budgets["arc-income"] = { materials: 150 };
  const { sim, results, run } = afterLoss(state, "arc-harvester");
  try {
    run(seconds(5), () => sim.ai.west!.posture === "recovering");
    expect(rejected(results)).toEqual([]);
  } finally {
    sim.dispose();
  }
});

test("recovery lets defense finish its calm interval before changing posture", () => {
  const state = structuredClone(developed);
  state.ai.west!.posture = "defending";
  delete state.ai.west!.requestedPosture;
  delete state.ai.west!.cursor;
  delete state.ai.west!.memory.defense;
  setBalance(state, 0, "materials", "west");
  const { sim } = afterLoss(state, "arc-field-barracks");
  try {
    runTicks(sim, seconds(5));
    expect(sim.ai.west!.posture).toBe("defending");
  } finally {
    sim.dispose();
  }
});

test("losing the Field Barracks rebuilds it at its normal cost", () => {
  const state = structuredClone(developed);
  const { sim, postures, results, run } = afterLoss(
    state,
    "arc-field-barracks",
  );
  try {
    const before = spent(sim);
    run(seconds(5), () => sim.ai.west!.posture === "recovering");
    run(seconds(120), () => sim.ai.west!.posture === "developing");
    expect(postures).toContain("recovering");
    const [barracks] = westOf(sim, "arc-field-barracks");
    expect(barracks?.construction).toBeUndefined();
    expect(spent(sim) - before).toBeGreaterThanOrEqual(100);
    // Recovering restores production before growing income further.
    const [first] = results.flatMap(({ command, issuer, accepted }) =>
      accepted && issuer.owner === "west" && command.kind === "place-actor"
        ? [command.definitionId]
        : [],
    );
    expect(first).toBe("arc-field-barracks");
    expect(rejected(results)).toEqual([]);
  } finally {
    sim.dispose();
  }
}, 30_000);

test("losing all Refineries reuses surviving Harvesters at paid replacements", () => {
  const state = structuredClone(developed);
  const workers = westOf(state, "arc-harvester").map(({ id }) => id);
  setBalance(state, 100, "materials", "west");
  const { sim, results, run } = afterLoss(state, "arc-materials-refinery");
  try {
    run(seconds(5), () => sim.ai.west!.posture === "recovering");
    run(seconds(60), () => sim.ai.west!.posture === "developing");
    expect(westOf(sim, "arc-harvester").map(({ id }) => id)).toEqual(workers);
    expect(
      sim
        .viewOf("west")
        .economy()!
        .harvesters.some(
          ({ refineryId }) =>
            !!refineryId && !sim.viewOf("west").offlineIds().has(refineryId),
        ),
    ).toBe(true);
    expect(rejected(results)).toEqual([]);
  } finally {
    sim.dispose();
  }
});

test("a lost support link replaces offline production and reassigns its worker", () => {
  const terrain = new TerrainGrid({
    width: 64,
    height: 24,
    tileSize: 1,
    terrainTypeIds: ["plain", "path", "rough", "water"],
  });
  const scenario = defineScenario({
    id: "recovery-support-loss",
    tileSize: 1,
    terrainTypeIds: ["plain", "path", "rough", "water"],
    terrain: terrain.terrainState(),
    owners: [{ id: "west", faction: "arc" }],
    playerOwner: "west",
    ai: [{ owner: "west", profileId: "arc-skirmish" }],
    stockpiles: [{ resource: "materials", owners: ["west"], amount: 2000 }],
    sites: [
      {
        id: "materials",
        name: "Materials",
        tile: { x: 23, z: 14 },
        initialMaterials: 5000,
        remainingMaterials: 5000,
      },
    ],
    loot: [],
    buildings: [
      {
        actorId: "hq",
        definitionId: "arc-command-center-prototype",
        origin: { x: 2, z: 10 },
      },
      {
        actorId: "bridge",
        definitionId: "arc-field-barracks",
        origin: { x: 13, z: 10 },
      },
      {
        actorId: "remote",
        definitionId: "arc-materials-refinery",
        origin: { x: 18, z: 10 },
      },
      {
        actorId: "remote-barracks",
        definitionId: "arc-field-barracks",
        origin: { x: 23, z: 10 },
      },
    ],
    units: [
      {
        actorId: "worker",
        definitionId: "arc-harvester",
        tile: { x: 18, z: 14 },
      },
    ],
  });
  const state = createScenarioState(scenario, MIRROR.definitions);
  state.ai.west!.posture = "developing";
  state.economy!.harvesters = [createHarvesterState("worker", "remote")];
  const sim = createSessionSimulation(
    { ...MIRROR, scenario, state: { ...state, terrain: state.terrain! } },
    undefined,
    CONCERNS,
  );
  try {
    expect(sim.viewOf("west").offlineIds().size).toBe(0);
    sim.submitCommand(
      { kind: "remove-actor", actorId: "bridge" },
      { owner: "west" },
    );
    sim.tick();
    expect(sim.viewOf("west").offlineIds().has("remote")).toBe(true);
    expect(sim.viewOf("west").offlineIds().has("remote-barracks")).toBe(true);
    const results = runTicks(sim, seconds(60));
    expect(sim.ai.west!.posture).toBe("developing");
    const { refineryId } = sim.economy!.harvesters.find(
      ({ actorId }) => actorId === "worker",
    )!;
    expect(refineryId).toBeDefined();
    expect(sim.viewOf("west").offlineIds().has(refineryId!)).toBe(false);
    expect(
      westOf(sim, "arc-field-barracks").some(
        (building) =>
          !building.construction &&
          !sim.viewOf("west").offlineIds().has(building.id),
      ),
    ).toBe(true);
    expect(rejected(results)).toEqual([]);
  } finally {
    sim.dispose();
  }
});

test("losing the Command Center places a paid replacement that reconnects the base", () => {
  const state = structuredClone(developed);
  setBalance(state, 300, "materials", "west");
  const { sim, postures, results, run } = afterLoss(
    state,
    "arc-command-center-prototype",
  );
  try {
    run(seconds(5), () => sim.ai.west!.posture === "recovering");
    run(seconds(60), () => sim.ai.west!.posture === "developing");
    expect(postures).toContain("recovering");
    const [headquarters] = westOf(sim, "arc-command-center-prototype");
    expect(headquarters?.construction).toBeUndefined();
    expect(balance(sim, "materials", "west")).toBeLessThan(300);
    expect(sim.viewOf("west").offlineIds().size).toBe(0);
    expect(rejected(results)).toEqual([]);
  } finally {
    sim.dispose();
  }
}, 30_000);

test("recovery continues identically after save and load", () => {
  const state = structuredClone(developed);
  setBalance(state, 300, "materials", "west");
  const { sim, run } = afterLoss(state, "arc-command-center-prototype");
  try {
    run(seconds(5), () => sim.ai.west!.posture === "recovering");
    const saved = savedState(MIRROR.scenario, sim);
    const resumed = createSessionSimulation(
      { ...MIRROR, state: { ...saved, terrain: saved.terrain! } },
      undefined,
      CONCERNS,
    );
    try {
      expect(runTicks(resumed, seconds(20))).toEqual(
        runTicks(sim, seconds(20)),
      );
      expect(resumed.snapshot()).toEqual(sim.snapshot());
    } finally {
      resumed.dispose();
    }
  } finally {
    sim.dispose();
  }
}, 30_000);
