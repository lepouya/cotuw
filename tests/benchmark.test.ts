import { expect, test } from "vitest";

import { advanceTicks } from "./helpers/scenario";
import {
  BENCHMARK_AI_CONCERNS,
  createBenchmarkMission,
  probeOptions,
  WORKLOADS,
} from "../scripts/benchmark/workload";
import { attachBenchmarkProbe } from "../src/benchmark-probe";
import { createSessionSimulation, loadMission } from "../src/mission-loading";
import {
  summarizeTimes,
  summarizePopulation,
} from "../scripts/benchmark/metrics";

import type { Workload } from "../scripts/benchmark/workload";
import type { MissionSimulation } from "../src/simulation/mission";

test.each(Object.keys(WORKLOADS) as Workload[])(
  "the %s benchmark starts at a 5:1 ratio",
  (workload) => {
    const simulation = createSessionSimulation(
      loadMission(createBenchmarkMission(workload)),
    );
    const { actors, commands } = simulation.snapshot();
    const buildings = actors.filter((actor) => actor.tilePlacement);
    expect(buildings).toHaveLength(WORKLOADS[workload].buildings);
    expect(actors.length - buildings.length).toBe(WORKLOADS[workload].units);
    for (const owner of ["west", "east"])
      expect(buildings.filter((actor) => actor.owner === owner)).toHaveLength(
        WORKLOADS[workload].buildings / 2,
      );
    expect(commands.length).toBeGreaterThan(0);
    for (let tick = 0; tick < 2; tick++)
      expect(simulation.tick().filter(({ accepted }) => !accepted)).toEqual([]);
    expect(simulation.actors.some((actor) => actor.movement)).toBe(true);
    simulation.dispose();
  },
);

test(
  "the AI runs alongside the scripted load while the probe holds its scale",
  { timeout: 20_000 },
  () => {
    const mission = loadMission(createBenchmarkMission("normal", { ai: true }));
    expect(mission.scenario.ai?.map(({ owner }) => owner)).toEqual([
      "west",
      "east",
    ]);
    expect(
      new Set(mission.state.commands.map(({ command }) => command.kind)),
    ).toEqual(
      new Set([
        "assign-refinery",
        "gather",
        "move",
        "group-move",
        "group-attack-move",
        "set-rally-point",
      ]),
    );
    const simulation = createSessionSimulation(
      mission,
      undefined,
      BENCHMARK_AI_CONCERNS,
    );
    const probe = attachBenchmarkProbe(simulation, {
      ...probeOptions("normal"),
      now: () => 0,
    });
    try {
      advanceTicks(simulation, 600);
      const share = WORKLOADS.normal.units / 2;
      for (const owner of ["west", "east"]) {
        const units = simulation.actors.filter(
          (actor) => actor.owner === owner && !actor.tilePlacement,
        );
        expect(units.length).toBeLessThanOrEqual(share);
        expect(units.length).toBeGreaterThan(share * 0.85);
        expect(simulation.ai[owner]!.nextRoundTick).toBeGreaterThan(0);
        expect(simulation.ai[owner]!.posture).not.toBe("establishing");
      }
      // The AI trains nothing; queued units are the probe's reinforcements.
      for (const { definitionId } of simulation.economy!.production)
        expect(definitionId).toBe(
          probeOptions("normal").reinforcement.definitionId,
        );
    } finally {
      probe.detach();
      simulation.dispose();
    }
  },
);

const westTrooper = (simulation: MissionSimulation) =>
  simulation.actors.find(
    (actor) => actor.owner === "west" && actor.definitionId === "arc-trooper",
  )!.id;

test("the benchmark probe owns worker and scout replacements too", () => {
  const simulation = createSessionSimulation(
    loadMission(createBenchmarkMission("normal", { ai: true })),
    undefined,
    BENCHMARK_AI_CONCERNS,
  );
  for (const actor of simulation.actors)
    if (
      actor.owner === "west" &&
      ["arc-harvester", "arc-scout"].includes(actor.definitionId)
    )
      simulation.removeActor(actor.id);
  const probe = attachBenchmarkProbe(simulation, {
    ...probeOptions("normal"),
    now: () => 0,
  });
  try {
    const results = Array.from({ length: 600 }, () => simulation.tick()).flat();
    expect(
      results.filter(
        ({ accepted, issuer, command }) =>
          accepted && issuer.ai && command.kind === "train-unit",
      ),
    ).toEqual([]);
  } finally {
    probe.detach();
    simulation.dispose();
  }
});

// One run covers the scripted opening and the probe's replacements.
test(
  "the scene opens cleanly and holds its scale through combat",
  {
    timeout: 20_000,
  },
  () => {
    const simulation = createSessionSimulation(
      loadMission(createBenchmarkMission("normal")),
    );
    const probe = attachBenchmarkProbe(simulation, {
      ...probeOptions("normal"),
      now: () => 0,
    });
    probe.measure();
    advanceTicks(simulation, 1_000);
    expect(probe.record().rejected).toEqual([]);
    advanceTicks(simulation, 1_400);
    const { population, attacks, rejected } = probe.record();
    probe.detach();
    simulation.dispose();

    const { units } = WORKLOADS.normal;
    expect(attacks).toBeGreaterThan(0);
    // Only orders to scouts lost in combat may fail.
    expect(rejected.filter((reason) => !reason.startsWith("move"))).toEqual([]);
    for (const sample of population.slice(1)) {
      expect(sample.units).toBeGreaterThanOrEqual(units * 0.85);
      expect(sample.units).toBeLessThanOrEqual(units);
    }
  },
);

test("probe reinforcement is independent of timing and stops on detach", () => {
  const mission = loadMission(createBenchmarkMission("normal"));
  mission.state.commands = [];
  let elapsed = 0;
  const runs = [() => 0, () => (elapsed += 0.25)].map((now) => {
    const simulation = createSessionSimulation(mission);
    simulation.removeActor(westTrooper(simulation));
    const probe = attachBenchmarkProbe(simulation, {
      ...probeOptions("normal"),
      now,
    });
    return { simulation, probe };
  });
  try {
    for (const { simulation, probe } of runs) {
      probe.measure();
      advanceTicks(simulation, 20);
      expect(probe.record().rejected).toEqual([]);
      expect(simulation.economy!.production).toHaveLength(1);
      expect(simulation.snapshot().commands).toEqual([]);
    }
    expect(runs[0]!.simulation.snapshot()).toEqual(
      runs[1]!.simulation.snapshot(),
    );
    for (const { simulation, probe } of runs) {
      probe.detach();
      const measured = probe.record().ticks.length;
      simulation.tick();
      expect(probe.record().ticks).toHaveLength(measured);
    }
    // Skirmish actors can only be removed at tick 0.
    const detached = createSessionSimulation(mission);
    attachBenchmarkProbe(detached, {
      ...probeOptions("normal"),
      now: () => 0,
    }).detach();
    detached.removeActor(westTrooper(detached));
    detached.tick();
    expect(detached.economy!.production).toEqual([]);
    detached.dispose();
  } finally {
    for (const { simulation, probe } of runs) {
      probe.detach();
      simulation.dispose();
    }
  }
});

test("benchmark reports reject empty runs and use nearest-rank percentiles", () => {
  expect(() => summarizeTimes([])).toThrow("No timing samples");
  expect(() => summarizePopulation([])).toThrow("No population samples");
  expect(
    summarizeTimes([100, ...Array.from({ length: 99 }, (_, i) => i + 1)]),
  ).toEqual({
    count: 100,
    p50: 50,
    p95: 95,
    p99: 99,
    max: 100,
  });
  expect(
    summarizePopulation([
      { tick: 600, units: 200, buildings: 40 },
      { tick: 900, units: 180, buildings: 40 },
    ]),
  ).toMatchObject({
    unitsMin: 180,
    unitsMax: 200,
    unitsMean: 190,
    buildingsMin: 40,
    buildingsMax: 40,
  });
});
