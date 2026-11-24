// Holds a benchmark mission at its target scale and records what it did.
// Only the headless runner and COTUW_BENCHMARK builds use it.
import { PRODUCTION_QUEUE_LIMIT } from "./simulation/production";
import { compareIds } from "./simulation/actor";
import { BUILT_IN_AI_CONCERNS } from "./simulation/ai-concerns";

import type { CommandOutcome } from "./simulation/command";
import type { AiConcern, AiConcernContext } from "./simulation/director";
import type { MissionSimulation } from "./simulation/mission";

/** Benchmark builds give missions with this scenario ID the benchmark AI. */
export const BENCHMARK_SCENARIO_ID = "benchmark";

/**
 * The probe alone trains replacements, and the AI places no buildings, so
 * neither recruitment nor expansion moves the scene off its scale. Other
 * concern commands still run.
 */
export const BENCHMARK_AI_CONCERNS: ReadonlyMap<string, AiConcern> = new Map<
  string,
  AiConcern
>(
  [...BUILT_IN_AI_CONCERNS].map(([id, concern]) => [
    id,
    Object.assign((context: AiConcernContext) => {
      concern({
        ...context,
        issue: (command) =>
          command.kind !== "train-unit" &&
          command.kind !== "place-actor" &&
          context.issue(command),
      });
    }, concern),
  ]),
);

export type BenchmarkScale = { units: number; buildings: number };

export type PopulationSample = {
  tick: number;
  units: number;
  buildings: number;
};

export type BenchmarkProbeOptions = {
  scale: BenchmarkScale;
  /** Caps fielded and queued units together. */
  maxUnits: number;
  /** Each owner trains this unit at these producers to replace losses. */
  reinforcement: {
    definitionId: string;
    producerDefinitionId: string;
    trainingTicks: number;
  };
  sampleTicks: number;
  /** A monotonic millisecond clock. */
  now: () => number;
};

export type BenchmarkRecord = {
  ticks: number[];
  population: PopulationSample[];
  rejected: string[];
  attacks: number;
  gatheredMaterials: number;
  deliveredMaterials: number;
};

export type BenchmarkProbe = {
  /** Starts recording from the next tick. */
  measure: () => void;
  record: () => BenchmarkRecord;
  /** Stops recording and reinforcing. */
  detach: () => void;
};

/**
 * Observes every tick. After each one, each owner orders replacements until
 * its units and queued training reach its share of the target, plus its
 * losses within one training time. The orders depend only on simulation
 * state, so runs stay reproducible.
 */
export function attachBenchmarkProbe(
  simulation: MissionSimulation,
  { scale, maxUnits, reinforcement, sampleTicks, now }: BenchmarkProbeOptions,
): BenchmarkProbe {
  // Each owner with producers holds an equal share of the units.
  const owners = [
    ...new Set(
      simulation.actors
        .filter(
          ({ definitionId }) =>
            definitionId === reinforcement.producerDefinitionId,
        )
        .map(({ owner }) => owner),
    ),
  ].sort(compareIds);
  const share = scale.units / owners.length;
  const ceiling = Math.floor(maxUnits / owners.length);
  const delivered = () =>
    (simulation.economy?.deposited ?? []).reduce(
      (total, { amount }) => total + amount,
      0,
    );
  const remaining = () =>
    (simulation.economy?.sites ?? []).reduce(
      (total, { remainingMaterials }) => total + remainingMaterials,
      0,
    );
  const record: BenchmarkRecord = {
    ticks: [],
    population: [],
    rejected: [],
    attacks: 0,
    gatheredMaterials: 0,
    deliveredMaterials: 0,
  };
  let measuring = false;
  let startDelivered = 0;
  let startRemaining = 0;

  const populationSample = (): PopulationSample => {
    const buildings = simulation.actors.filter(
      (actor) => actor.tilePlacement,
    ).length;
    return {
      tick: simulation.completedTicks,
      units: simulation.actors.length - buildings,
      buildings,
    };
  };

  // Each owner's fielded units after the last tick, and the ticks it lost
  // units on, so training keeps pace with losses.
  const fielded = new Map(owners.map((owner) => [owner, new Set<string>()]));
  const losses = new Map(owners.map((owner) => [owner, [] as number[]]));

  const reinforce = () => {
    const queued = new Map<string, number>();
    for (const { producerId } of simulation.economy?.production ?? [])
      queued.set(producerId, (queued.get(producerId) ?? 0) + 1);
    const tick = simulation.completedTicks;
    for (const owner of owners) {
      const owned = simulation.actors.filter((actor) => actor.owner === owner);
      const units = new Set(
        owned.filter((actor) => !actor.tilePlacement).map(({ id }) => id),
      );
      const lost = losses.get(owner)!;
      for (const id of fielded.get(owner)!) if (!units.has(id)) lost.push(tick);
      fielded.set(owner, units);
      // Recent losses predict those during the next training time.
      while (lost.length && lost[0]! <= tick - reinforcement.trainingTicks)
        lost.shift();
      const producers = owned
        .filter(
          (actor) =>
            actor.definitionId === reinforcement.producerDefinitionId &&
            !actor.construction,
        )
        .map(({ id }) => id)
        .sort(compareIds);
      const training = producers.reduce(
        (total, id) => total + (queued.get(id) ?? 0),
        0,
      );
      let deficit =
        Math.min(share + lost.length, ceiling) - units.size - training;
      while (deficit > 0) {
        // The shortest queue, then the lowest ID, keeps the choice stable.
        const producerId = producers.reduce<string | undefined>(
          (best, id) =>
            (queued.get(id) ?? 0) < PRODUCTION_QUEUE_LIMIT &&
            (best === undefined ||
              (queued.get(id) ?? 0) < (queued.get(best) ?? 0))
              ? id
              : best,
          undefined,
        );
        if (!producerId) break;
        simulation.submitCommand(
          {
            kind: "train-unit",
            producerId,
            actorId: simulation.unusedActorId(`${producerId}-recruit-`),
            definitionId: reinforcement.definitionId,
          },
          { owner },
        );
        queued.set(producerId, (queued.get(producerId) ?? 0) + 1);
        deficit -= 1;
      }
    }
  };

  const rejection = ({ command, reason }: CommandOutcome) =>
    `${command.kind}${reason ? `: ${reason}` : ""}`;

  let started = 0;
  const detach = simulation.observeTicks({
    beforeTick: () => {
      if (measuring) started = now();
    },
    afterTick: (outcomes) => {
      if (measuring) {
        record.ticks.push(now() - started);
        record.attacks += simulation.attacks.length;
        if (record.ticks.length % sampleTicks === 0)
          record.population.push(populationSample());
      }
      for (const outcome of outcomes)
        if (!outcome.accepted) record.rejected.push(rejection(outcome));
      if (!simulation.result) reinforce();
    },
  });

  return {
    measure: () => {
      measuring = true;
      startDelivered = delivered();
      startRemaining = remaining();
      record.population.push(populationSample());
    },
    record: () => {
      const population = record.population;
      return {
        ...record,
        population:
          measuring &&
          population[population.length - 1]?.tick !== simulation.completedTicks
            ? [...population, populationSample()]
            : [...population],
        gatheredMaterials: startRemaining - remaining(),
        deliveredMaterials: delivered() - startDelivered,
      };
    },
    detach,
  };
}
