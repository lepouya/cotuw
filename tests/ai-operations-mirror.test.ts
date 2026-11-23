import { afterAll, beforeAll, expect, test } from "vitest";

import {
  dueRound,
  MIRROR,
  resumeMirror,
  ROUND_TICKS,
  runTicks,
} from "./helpers/ai-mirror";
import { ARC_AI_TUNING } from "./helpers/content";
import { savedState } from "./helpers/scenario";
import { createSessionSimulation } from "../src/mission-loading";
import { isIncomeBuilding } from "../src/simulation/actor";
import { BUILT_IN_AI_CONCERNS } from "../src/simulation/ai-concerns";
import { operationsOf } from "../src/simulation/ai-operations";
import {
  secondsToTicks,
  SIMULATION_TICK_SECONDS,
} from "../src/simulation/clock";
import { startSimulationLoop } from "../src/simulation/loop";
import { distance } from "../src/simulation/world";

import type { CommandOutcome } from "../src/simulation/command";
import type {
  MissionSimulation,
  MissionState,
} from "../src/simulation/mission";

const OWNERS = ["west", "east"] as const;
const seconds = (count: number) =>
  secondsToTicks(count, SIMULATION_TICK_SECONDS);
const definitions = new Map(MIRROR.content.actors.map((d) => [d.id, d]));
/** Seconds after the grace until shortly before west's first raid. */
const LEAD_SECONDS = 105;
/** West's first raid has launched this long after the lead. */
const WEST_RAID_SECONDS = 10;
/** Both owners' first raids are advancing this long after the lead. */
const BOTH_RAIDS_SECONDS = 15;
const operations = (sim: MissionSimulation | MissionState, owner = "west") =>
  operationsOf(sim.ai[owner]!.memory);

let simulation: MissionSimulation;
let graced: MissionState;
let leading: MissionState;
const opening: { posture: string; operations: number; claims: string[] }[] = [];

// The undisturbed opening up to the end of the offensive grace period.
beforeAll(() => {
  simulation = createSessionSimulation(MIRROR);
  const rounds = seconds(ARC_AI_TUNING.offense.graceSeconds) / 60;
  for (let round = 0; round < rounds; round++) {
    runTicks(simulation, 60);
    for (const owner of OWNERS) {
      const ai = simulation.ai[owner]!;
      opening.push({
        posture: ai.posture,
        operations: operations(simulation, owner).length,
        claims: Object.values(ai.claims),
      });
    }
  }
  graced = simulation.snapshot();
  runTicks(simulation, seconds(LEAD_SECONDS));
  leading = simulation.snapshot();
}, 30_000);
afterAll(() => simulation.dispose());

test("offense waits out the opening grace period", () => {
  expect(opening.some(({ posture }) => posture === "pressuring")).toBe(false);
  expect(opening.every(({ operations }) => !operations)).toBe(true);
  expect(opening.some(({ claims }) => claims.includes("offense"))).toBe(false);
});

test("a raid sets out against observed enemy income after the grace", () => {
  const sim = resumeMirror(structuredClone(leading));
  try {
    const results = runTicks(sim, seconds(BOTH_RAIDS_SECONDS));
    for (const owner of OWNERS) {
      expect(sim.ai[owner]!.posture).toBe("pressuring");
      const [raid] = operations(sim, owner);
      expect(raid).toMatchObject({
        concern: "offense",
        operation: { kind: "raid", phase: "advance" },
      });
      const { operation } = raid!;
      expect(operation.units.length).toBeGreaterThanOrEqual(4);
      const target = sim
        .viewOf(owner)
        .knowledge.observations.actors.find(
          ({ actorId }) => actorId === operation.targetId,
        )!;
      expect(target.owner).not.toBe(owner);
      expect(isIncomeBuilding(definitions.get(target.definitionId)!)).toBe(
        true,
      );
      expect(
        results.some(
          ({ command, accepted, issuer }) =>
            accepted &&
            issuer.owner === owner &&
            command.kind === "attack-move" &&
            command.actorId === operation.units[0],
        ),
      ).toBe(true);
    }
    expect(
      results.filter(({ issuer, accepted }) => issuer.ai && !accepted),
    ).toEqual([]);
  } finally {
    sim.dispose();
  }
});

test("an operation continues identically after save and load", () => {
  const sim = resumeMirror(structuredClone(leading));
  try {
    expect(operations(sim)).toHaveLength(0);
    runTicks(sim, seconds(WEST_RAID_SECONDS));
    expect(operations(sim)).toHaveLength(1);
    const saved = savedState(MIRROR.scenario, sim);
    const resumed = createSessionSimulation({
      ...MIRROR,
      state: { ...saved, terrain: saved.terrain! },
    });
    try {
      expect(resumed.snapshot()).toEqual(sim.snapshot());
      expect(runTicks(resumed, seconds(30))).toEqual(
        runTicks(sim, seconds(30)),
      );
      expect(resumed.snapshot()).toEqual(sim.snapshot());
    } finally {
      resumed.dispose();
    }
  } finally {
    sim.dispose();
  }
});

test("active operations continue identically through bounded clock catch-up", () => {
  const whole = resumeMirror(structuredClone(leading));
  const batched = resumeMirror(structuredClone(leading));
  let now = 0;
  const loop = startSimulationLoop(batched, {
    pumpMilliseconds: 60_000,
    maxCatchUpSeconds: 0.5,
    now: () => now,
  });
  try {
    runTicks(whole, seconds(WEST_RAID_SECONDS));
    expect(operations(whole)).toHaveLength(1);
    now = WEST_RAID_SECONDS * 1000 + SIMULATION_TICK_SECONDS * 500;
    for (
      let batch = 0;
      batched.completedTicks < whole.completedTicks && batch < 100;
      batch++
    )
      loop.advance();
    expect(loop.faulted).toBe(false);
    expect(batched.snapshot()).toEqual(whole.snapshot());
  } finally {
    loop.stop();
    whole.dispose();
    batched.dispose();
  }
});

test.each([
  ["offense", { operations: [null] }],
  ["offense", { operations: [{ id: "raid:1", phase: "advance" }] }],
  ["offense", { avoid: [{ x: 1, z: 2, tick: -1 }] }],
  ["defense", { calmTick: "later" }],
  ["scouting", { goal: { kind: "area", id: "1,1", position: null } }],
  ["scouting", { swept: [] }],
])(
  "rejects malformed %s memory before starting the mission",
  (concern, memory) => {
    const state = structuredClone(graced);
    state.ai.west!.memory[concern] = memory;
    expect(() => resumeMirror(state)).toThrow("invalid AI state");
  },
);

/** Two east Troopers placed beside west's Refinery, holding still. */
function raidedRefinery() {
  const state = structuredClone(graced);
  const refinery = state.actors.find(
    ({ owner, definitionId }) =>
      owner === "west" && definitionId === "arc-materials-refinery",
  )!;
  const raiders = state.actors
    .filter(
      ({ owner, definitionId }) =>
        owner === "east" && definitionId === "arc-trooper",
    )
    .slice(0, 2);
  expect(raiders).toHaveLength(2);
  const home = state.actors.find(({ id }) => id === "west-headquarters")!;
  const offset = 6;
  const toward = {
    x: refinery.worldPosition.x - home.worldPosition.x,
    z: refinery.worldPosition.z - home.worldPosition.z,
  };
  const length = Math.hypot(toward.x, toward.z);
  raiders.forEach((raider, index) => {
    raider.worldPosition = {
      x: refinery.worldPosition.x + (toward.x / length) * offset + index * 1.5,
      z: refinery.worldPosition.z + (toward.z / length) * offset,
    };
    delete raider.movement;
    delete raider.orders;
    delete raider.attackMove;
    delete raider.combat;
  });
  // Raiders hold still, so only defense decides the outcome.
  const concerns = new Map(BUILT_IN_AI_CONCERNS).set("offense", () => {});
  return { sim: resumeMirror(dueRound(state), concerns), raiders };
}

test("defense meets raiders near the base, then stands down", () => {
  const { sim, raiders } = raidedRefinery();
  try {
    const results: CommandOutcome[] = runTicks(sim, ROUND_TICKS);
    const [defense] = operations(sim);
    expect(defense).toMatchObject({
      concern: "defense",
      operation: { kind: "defend", phase: "advance" },
    });
    expect(sim.ai.west!.requestedPosture ?? sim.ai.west!.posture).toBe(
      "defending",
    );
    const claimed = Object.entries(sim.ai.west!.claims)
      .filter(([, concern]) => concern === "defense")
      .map(([id]) => id);
    expect(claimed.sort()).toEqual(defense!.operation.units);
    expect(
      distance(defense!.operation.target, raiders[0]!.worldPosition),
    ).toBeLessThan(3);
    results.push(...runTicks(sim, seconds(60)));
    for (const raider of raiders)
      expect(sim.actorById(raider.id)).toBeUndefined();
    expect(operations(sim)).toEqual([]);
    expect(sim.ai.west!.posture).not.toBe("defending");
    expect(Object.values(sim.ai.west!.claims)).not.toContain("defense");
    expect(
      results.filter(({ issuer, accepted }) => issuer.ai && !accepted),
    ).toEqual([]);
  } finally {
    sim.dispose();
  }
}, 30_000);

test("defenders stop at the base's edge when raiders retreat", () => {
  const { sim, raiders } = raidedRefinery();
  try {
    runTicks(sim, ROUND_TICKS);
    const operation = operations(sim)[0]?.operation;
    expect(operation?.phase).toBe("advance");
    const defenders = operation!.units;
    const engaged = () =>
      defenders.some((id) => sim.actorById(id)?.combat?.attack);
    for (let tick = 0; tick < seconds(20) && !engaged(); tick++) sim.tick();
    expect(engaged()).toBe(true);
    const home = sim.actorById("east-headquarters")!.worldPosition;
    sim.submitCommand(
      {
        kind: "group-move",
        actorIds: raiders.map(({ id }) => id),
        target: { ...home },
      },
      { owner: "east" },
    );
    expect(sim.tick()).toEqual(
      expect.arrayContaining(
        raiders.map(({ id }) =>
          expect.objectContaining({
            accepted: true,
            command: expect.objectContaining({ kind: "move", actorId: id }),
          }),
        ),
      ),
    );
    const calm = () => sim.ai.west!.memory.defense?.calmTick !== undefined;
    let outcomes: CommandOutcome[] = [];
    for (let tick = 0; tick < seconds(20) && !calm(); tick++)
      outcomes = sim.tick();
    expect(calm()).toBe(true);
    expect(raiders.some(({ id }) => sim.actorById(id))).toBe(true);
    expect(sim.ai.west!.posture).toBe("defending");
    expect(operations(sim)[0]?.operation).toMatchObject({
      phase: "return",
      outcome: "completed",
    });
    const returning = outcomes.flatMap(({ accepted, command, issuer }) =>
      accepted && issuer.owner === "west" && command.kind === "move"
        ? [command.actorId]
        : [],
    );
    expect(returning).toEqual(expect.arrayContaining(defenders));
    for (const id of defenders)
      expect(sim.actorById(id)?.attackMove).toBeUndefined();
    runTicks(sim, seconds(20));
    expect(operations(sim)).toEqual([]);
  } finally {
    sim.dispose();
  }
}, 30_000);
