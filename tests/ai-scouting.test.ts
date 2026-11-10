import { afterAll, beforeAll, expect, test } from "vitest";

import {
  dueRound,
  MIRROR,
  resumeMirror,
  ROUND_TICKS,
  runTicks,
} from "./helpers/ai-mirror";
import { savedState } from "./helpers/scenario";
import { createSessionSimulation } from "../src/mission-loading";
import { BUILT_IN_AI_CONCERNS } from "../src/simulation/ai-concerns";
import { SCOUT_REPLACEMENT_SECONDS } from "../src/simulation/ai-scouting";
import {
  secondsToTicks,
  SIMULATION_TICK_SECONDS,
} from "../src/simulation/clock";
import { distance } from "../src/simulation/world";

import type { ScoutMemory } from "../src/simulation/ai-scouting";
import type { CommandOutcome } from "../src/simulation/command";
import type {
  MissionSimulation,
  MissionState,
} from "../src/simulation/mission";

const OWNERS = ["west", "east"] as const;
const seconds = (count: number) =>
  secondsToTicks(count, SIMULATION_TICK_SECONDS);

let simulation: MissionSimulation;
const outcomes: CommandOutcome[] = [];
let scouted: MissionState;

const memoryOf = (sim: MissionSimulation | MissionState, owner = "west") =>
  sim.ai[owner]!.memory.scouting as ScoutMemory;

const resumeForRound = (state: MissionState) => resumeMirror(dueRound(state));

// One undisturbed opening through the scout's first tour.
beforeAll(() => {
  simulation = createSessionSimulation(MIRROR);
  outcomes.push(...runTicks(simulation, seconds(4 * 60)));
  scouted = simulation.snapshot();
}, 30_000);
afterAll(() => simulation.dispose());

test("scouting finds every authored site and enemy income in the opening", () => {
  for (const owner of OWNERS) {
    const { sites, observations } = simulation.viewOf(owner).knowledge;
    expect(observations.sites.map(({ siteId }) => siteId).sort()).toEqual(
      sites.map(({ id }) => id).sort(),
    );
    expect(
      observations.actors.some(
        (sighting) => sighting.owner !== owner && !!sighting.tilePlacement,
      ),
    ).toBe(true);
    const { scoutId } = memoryOf(simulation, owner);
    expect(simulation.actorById(scoutId!)?.definitionId).toBe("arc-scout");
    expect(simulation.ai[owner]!.claims[scoutId!]).toBe("scouting");
  }
  const ai = outcomes.filter(({ issuer }) => issuer.ai);
  expect(ai.filter(({ accepted }) => !accepted)).toEqual([]);
});

test("stale reports send the scout back out", () => {
  const state = structuredClone(scouted);
  const observations = state.observations.west!;
  for (const sighting of [...observations.sites, ...observations.actors])
    sighting.tick = 0;
  const { scoutId } = memoryOf(state);
  const scout = state.actors.find(({ id }) => id === scoutId)!;
  delete scout.movement;
  delete scout.orders;
  delete state.ai.west!.memory.scouting!.goal;
  const sim = resumeForRound(state);
  try {
    runTicks(sim, ROUND_TICKS);
    const { goal } = memoryOf(sim);
    expect(goal?.kind).toBe("site");
    const stale = sim
      .viewOf("west")
      .knowledge.observations.sites.filter(({ tick }) => tick === 0)
      .map(({ siteId }) => siteId);
    expect(stale).toContain(goal && "id" in goal ? goal.id : undefined);
    expect(sim.actorById(scoutId!)!.movement).toBeDefined();
  } finally {
    sim.dispose();
  }
});

test.each(["stopped", "blocked"])(
  "a %s scout skips an unreachable report",
  (condition) => {
    const state = structuredClone(scouted);
    for (const sighting of state.observations.west!.sites) sighting.tick = 0;
    const heading = resumeForRound(state);
    let stopped: MissionState;
    let first: ScoutMemory["goal"];
    try {
      runTicks(heading, ROUND_TICKS);
      first = memoryOf(heading).goal;
      stopped = heading.snapshot();
    } finally {
      heading.dispose();
    }
    expect(first).toBeDefined();
    const scout = stopped.actors.find(
      ({ id }) => id === memoryOf(stopped).scoutId,
    )!;
    if (condition === "blocked") {
      scout.movement!.blocked = true;
      scout.movement!.waypoints = [];
      scout.movement!.waypointIndex = 0;
    } else delete scout.movement;
    delete scout.orders;
    const sim = resumeForRound(stopped);
    try {
      runTicks(sim, ROUND_TICKS);
      const memory = memoryOf(sim);
      expect(memory.avoid).toContainEqual({
        ...first!.position,
        tick: expect.any(Number),
      });
      expect(memory.goal).toBeDefined();
      expect(memory.goal!.position).not.toEqual(first!.position);
    } finally {
      sim.dispose();
    }
  },
);

test("a damaged scout retreats home and avoids the area", () => {
  const state = structuredClone(scouted);
  const { scoutId } = memoryOf(state);
  const scout = state.actors.find(({ id }) => id === scoutId)!;
  scout.health = 30;
  const hitAt = { ...scout.worldPosition };
  const sim = resumeForRound(state);
  try {
    runTicks(sim, ROUND_TICKS);
    const memory = memoryOf(sim);
    expect(memory.goal?.kind).toBe("retreat");
    expect(memory.avoid).toContainEqual({
      ...hitAt,
      tick: expect.any(Number),
    });
    const home = sim.actorById("west-headquarters")!.worldPosition;
    const target = sim.actorById(scoutId!)!.movement!.target;
    expect(distance(target, home)).toBeLessThan(distance(hitAt, home));
    const saved = savedState(MIRROR.scenario, sim);
    const resumed = createSessionSimulation({
      ...MIRROR,
      state: { ...saved, terrain: saved.terrain! },
    });
    try {
      expect(resumed.snapshot()).toEqual(sim.snapshot());
      expect(runTicks(resumed, seconds(2))).toEqual(runTicks(sim, seconds(2)));
      expect(resumed.snapshot()).toEqual(sim.snapshot());
    } finally {
      resumed.dispose();
    }
  } finally {
    sim.dispose();
  }
});

test("a lost scout is replaced at normal cost after a delay", () => {
  const state = structuredClone(scouted);
  const { scoutId } = memoryOf(state);
  state.actors = state.actors.filter(({ id }) => id !== scoutId);
  delete state.ai.west!.claims[scoutId!];
  for (const memory of Object.values(state.observations))
    memory.actors = memory.actors.filter(({ actorId }) => actorId !== scoutId);
  const history = state.metrics!.owners.find(
    ({ owner }) => owner === "west",
  )!.history;
  history[history.length - 1]!.units -= 1;
  // Raids would disrupt the income the replacement waits for.
  const concerns = new Map(BUILT_IN_AI_CONCERNS).set("offense", () => {});
  const sim = resumeMirror(dueRound(state), concerns);
  try {
    runTicks(sim, ROUND_TICKS);
    const lost = memoryOf(sim);
    expect(lost.scoutId).toBeUndefined();
    expect(lost.replaceTick).toBeGreaterThanOrEqual(
      sim.completedTicks + seconds(SCOUT_REPLACEMENT_SECONDS) - ROUND_TICKS,
    );
    runTicks(sim, lost.replaceTick! - sim.completedTicks - 1);
    expect(memoryOf(sim).scoutId).toBeUndefined();
    // Funds accrue from deliveries, which can be a minute apart.
    const results = runTicks(sim, seconds(90));
    const { scoutId: replacement } = memoryOf(sim);
    expect(replacement).toBeDefined();
    expect(replacement).not.toBe(scoutId);
    expect(sim.actorById(replacement!)?.definitionId).toBe("arc-scout");
    // Paid through an ordinary training order.
    expect(
      results.filter(
        ({ command, accepted }) =>
          accepted &&
          command.kind === "train-unit" &&
          command.actorId === replacement,
      ),
    ).toHaveLength(1);
  } finally {
    sim.dispose();
  }
}, 30_000);
