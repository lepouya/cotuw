// Holds a benchmark mission at its target scale and records what it did.
// Only the headless runner and COTUW_BENCHMARK builds use it.
import { PRODUCTION_QUEUE_LIMIT } from "./simulation/production";
import { compareIds } from "./simulation/actor";

import type { CommandOutcome } from "./simulation/command";
import type { MissionSimulation } from "./simulation/mission";

export type BenchmarkScale = { units: number; buildings: number };

export type PopulationSample = {
  tick: number;
  units: number;
  buildings: number;
};

export type BenchmarkProbeOptions = {
  scale: BenchmarkScale;
  /** Each owner trains this unit at these producers to replace losses. */
  reinforcement: { definitionId: string; producerDefinitionId: string };
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
 * its units and queued training reach its share of the target. The orders
 * depend only on simulation state, so runs stay reproducible.
 */
export function attachBenchmarkProbe(
  simulation: MissionSimulation,
  { scale, reinforcement, sampleTicks, now }: BenchmarkProbeOptions,
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

  const sample = () => {
    const buildings = simulation.actors.filter(
      (actor) => actor.tilePlacement,
    ).length;
    record.population.push({
      tick: simulation.completedTicks,
      units: simulation.actors.length - buildings,
      buildings,
    });
  };

  const reinforce = () => {
    const queued = new Map<string, number>();
    for (const { producerId } of simulation.economy?.production ?? [])
      queued.set(producerId, (queued.get(producerId) ?? 0) + 1);
    for (const owner of owners) {
      const owned = simulation.actors.filter((actor) => actor.owner === owner);
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
        share - owned.filter((actor) => !actor.tilePlacement).length - training;
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
        if (record.ticks.length % sampleTicks === 0) sample();
      }
      for (const outcome of outcomes)
        if (!outcome.accepted) record.rejected.push(rejection(outcome));
      reinforce();
    },
  });

  return {
    measure: () => {
      measuring = true;
      startDelivered = delivered();
      startRemaining = remaining();
      sample();
    },
    record: () => ({
      ...record,
      gatheredMaterials: startRemaining - remaining(),
      deliveredMaterials: delivered() - startDelivered,
    }),
    detach,
  };
}
