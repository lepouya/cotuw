import { afterAll, beforeAll, expect, test } from "vitest";

import { ARC_MIRROR_CASES } from "../scripts/ai-match/runner";
import {
  assembleSkirmish,
  createSessionSimulation,
  loadMission,
} from "../src/mission-loading";
import {
  secondsToTicks,
  SIMULATION_TICK_SECONDS,
} from "../src/simulation/clock";
import { serializeMission } from "../src/simulation/mission-file";
import { disconnectedBuildings } from "../src/simulation/support";
import { BUILT_IN_AI_CONCERNS } from "../src/simulation/ai-concerns";
import { createHarvesterState } from "../src/simulation/harvesting";

import type { CommandOutcome } from "../src/simulation/command";
import type { AiConcern } from "../src/simulation/director";
import type {
  MissionSimulation,
  MissionState,
} from "../src/simulation/mission";

const OWNERS = ["west", "east"] as const;
const STARTING_MATERIALS = 150;
const minutes = (count: number) =>
  secondsToTicks(count * 60, SIMULATION_TICK_SECONDS);

const mission = assembleSkirmish(
  ARC_MIRROR_CASES.find(({ id }) => id === "arc-mirror-west-normal")!.choice,
);
let simulation: MissionSimulation;
const outcomes: CommandOutcome[] = [];
let saved: string;
let atSave: MissionState;
let afterSave: MissionState;

const run = (sim: MissionSimulation, ticks: number) => {
  const recorded: CommandOutcome[] = [];
  for (let tick = 0; tick < ticks; tick++) recorded.push(...sim.tick());
  return recorded;
};

const resume = (
  state: MissionState,
  concerns?: ReadonlyMap<string, AiConcern>,
) =>
  createSessionSimulation(
    { ...mission, state: { ...state, terrain: state.terrain! } },
    undefined,
    concerns,
  );

// One undisturbed opening, inspected at three and five minutes.
beforeAll(() => {
  simulation = createSessionSimulation(mission);
  outcomes.push(...run(simulation, minutes(3)));
  atSave = simulation.snapshot();
  saved = serializeMission(mission.scenario, atSave, SIMULATION_TICK_SECONDS);
  outcomes.push(...run(simulation, minutes(0.5)));
  afterSave = simulation.snapshot();
  outcomes.push(...run(simulation, minutes(1.5)));
});
afterAll(() => simulation.dispose());

const ownedBy = (owner: string, definitionId: string) =>
  simulation.actors.filter(
    (actor) => actor.owner === owner && actor.definitionId === definitionId,
  );

test("the ARC AI opens within the development windows", () => {
  for (const owner of OWNERS) {
    const { milestones } = simulation.metrics!.owners.find(
      (metrics) => metrics.owner === owner,
    )!;
    expect(milestones.firstIncome).toBeLessThanOrEqual(minutes(2));
    expect(milestones.militaryReady).toBeLessThanOrEqual(minutes(4));
    expect(milestones.firstCombatUnit).toBeLessThanOrEqual(minutes(5));
    expect(simulation.ai[owner]!.posture).toBe("developing");
  }
});

test("the ARC AI grows income and forces with ordinary placement and costs", () => {
  const disconnected = disconnectedBuildings(simulation.support);
  for (const owner of OWNERS) {
    const refineries = ownedBy(owner, "arc-materials-refinery");
    expect(refineries.length).toBeGreaterThanOrEqual(2);
    expect(ownedBy(owner, "arc-field-barracks")).toHaveLength(1);
    expect(ownedBy(owner, "arc-trooper").length).toBeGreaterThanOrEqual(4);
    for (const building of [
      ...refineries,
      ...ownedBy(owner, "arc-field-barracks"),
    ])
      expect(disconnected.has(building.id)).toBe(false);
    const harvesters = simulation.economy!.harvesters.filter(({ actorId }) =>
      ownedBy(owner, "arc-harvester").some(({ id }) => id === actorId),
    );
    expect(harvesters.length).toBeGreaterThanOrEqual(1);
    for (const harvester of harvesters) {
      expect(refineries.map(({ id }) => id)).toContain(harvester.refineryId);
      expect(harvester.targetSiteId).toMatch(new RegExp(`^${owner}-home-`));
    }
    const { gathered, spent } = simulation.metrics!.owners.find(
      (metrics) => metrics.owner === owner,
    )!;
    expect(spent.materials).toBeLessThanOrEqual(
      STARTING_MATERIALS + gathered.materials,
    );
  }
});

test("the ARC AI's commands stay valid", () => {
  const ai = outcomes.filter(({ issuer }) => issuer.ai);
  expect(ai.length).toBeGreaterThan(0);
  expect(ai.filter(({ accepted }) => !accepted)).toEqual([]);
  for (const owner of OWNERS)
    expect(simulation.ai[owner]!.rejections).toEqual([]);
});

test("the developing base reaches its income and production targets", () => {
  const sim = resume(simulation.snapshot());
  try {
    const results = run(sim, minutes(5));
    expect(results.filter(({ accepted }) => !accepted)).toEqual([]);
    for (const owner of OWNERS) {
      const completed = sim.actors.filter(
        (actor) => actor.owner === owner && !actor.construction,
      );
      expect(
        completed.filter(
          ({ definitionId }) => definitionId === "arc-materials-refinery",
        ),
      ).toHaveLength(3);
      expect(
        completed.filter(
          ({ definitionId }) => definitionId === "arc-field-barracks",
        ),
      ).toHaveLength(2);
      expect(
        sim.economy!.harvesters.filter(({ actorId }) =>
          sim.viewOf(owner).ownActor(actorId),
        ),
      ).toHaveLength(3);
    }
  } finally {
    sim.dispose();
  }
}, 30_000);

test("a saved ARC AI continues exactly as an uninterrupted one", () => {
  const resumed = createSessionSimulation(loadMission(saved));
  try {
    expect(resumed.snapshot()).toEqual(atSave);
    run(resumed, minutes(0.5));
    expect(resumed.snapshot()).toEqual(afterSave);
  } finally {
    resumed.dispose();
  }
});

test.each([1, 2])(
  "an income turn reserves a Refinery for one of %i unassigned workers",
  (workers) => {
    const state = structuredClone(atSave);
    const worker = state.actors.find(
      ({ owner, definitionId }) =>
        owner === "west" && definitionId === "arc-harvester",
    )!;
    const empty = state.economy!.harvesters.find(
      ({ actorId }) => actorId === worker.id,
    )!;
    const refineryId = empty.refineryId!;
    state.economy!.harvesters = state.economy!.harvesters.map((entry) =>
      entry === empty ? createHarvesterState(worker.id) : entry,
    );
    for (let index = 1; index < workers; index++) {
      const extra = { ...structuredClone(worker), id: `unassigned-${index}` };
      state.actors.push(extra);
      state.economy!.harvesters.push(createHarvesterState(extra.id));
    }
    const history = state.metrics!.owners.find(
      ({ owner }) => owner === "west",
    )!.history;
    history[history.length - 1]!.units += workers - 1;
    state.economy!.stockpiles.forEach((stockpile) => (stockpile.amount = 1000));
    const ai = state.ai.west!;
    ai.nextRoundTick = state.tick;
    delete ai.cursor;
    const concerns = new Map(BUILT_IN_AI_CONCERNS);
    concerns.set("arc-production", () => {});
    concerns.set("forces", () => {});
    const sim = resume(state, concerns);
    try {
      const results = sim
        .tick()
        .filter(({ issuer }) => issuer.owner === "west");
      expect(results.filter(({ accepted }) => !accepted)).toEqual([]);
      expect(
        results.filter(({ command }) => command.kind === "assign-refinery"),
      ).toHaveLength(1);
      expect(
        sim.economy!.production.filter(
          ({ producerId }) => producerId === refineryId,
        ),
      ).toEqual([]);
    } finally {
      sim.dispose();
    }
  },
);

test.each(["missing", "blocked"])(
  "forces restore a %s rally point",
  (condition) => {
    const state = structuredClone(atSave);
    const producer = state.actors.find(
      ({ owner, definitionId }) =>
        owner === "west" && definitionId === "arc-field-barracks",
    )!;
    if (condition === "missing") delete producer.rallyPoint;
    else
      producer.rallyPoint = {
        ...state.actors.find(({ id }) => id === "west-headquarters")!
          .worldPosition,
      };
    const ai = state.ai.west!;
    ai.nextRoundTick = state.tick;
    delete ai.cursor;
    const sim = resume(state);
    try {
      run(sim, 2);
      const target = sim.actorById(producer.id)!.rallyPoint;
      expect(target).toBeDefined();
      expect(sim.viewOf("west").evaluateRallyPoint(producer.id, target!)).toBe(
        true,
      );
    } finally {
      sim.dispose();
    }
  },
);
