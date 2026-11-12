// Tick-by-tick observers that headless matches report from.
import { operationsOf } from "../../src/simulation/ai-operations.ts";
import { secondsToTicks } from "../../src/simulation/clock.ts";
import {
  hasOwn,
  isCount,
  isIdList,
  isNonnegative,
} from "../../src/simulation/validation.ts";

import type { DeepReadonly } from "../../src/simulation/actor.ts";
import type {
  OperationKind,
  OperationOutcome,
} from "../../src/simulation/ai-operations.ts";
import type { AiPosture, AiState } from "../../src/simulation/director.ts";
import type { MissionSimulation } from "../../src/simulation/mission.ts";

/** One kind of AI operation, as seen during a run. */
export type OperationSummary = {
  launched: number;
  firstLaunchTick: number;
  /** When the first group of this kind set out from its gathering point. */
  firstAdvanceTick?: number;
  /** `disbanded` groups ended without an outcome, including lost claims. */
  ended: Partial<Record<OperationOutcome | "disbanded", number>>;
};

export type OwnerActivity = {
  /** Ticks the AI spent in each posture. */
  postureTicks: Partial<Record<AiPosture, number>>;
  operations: Partial<Record<OperationKind, OperationSummary>>;
  /** Refused AI commands by kind and reason. */
  refused: Record<string, number>;
};

/**
 * Follows posture time, refusals, and operation launches, advances, and ends
 * tick by tick, since saved AI state keeps only running operations.
 */
export function activityTracker() {
  const owners = new Map<
    string,
    OwnerActivity & {
      /** Running operations by concern and ID, with their latest outcome. */
      running: Map<string, { kind: OperationKind; outcome?: OperationOutcome }>;
    }
  >();
  let previous: unknown;
  const observe = (ai: DeepReadonly<AiState>, tick: number) => {
    const changed = ai !== previous;
    previous = ai;
    for (const [owner, state] of Object.entries(ai)) {
      let activity = owners.get(owner);
      if (!activity)
        owners.set(
          owner,
          (activity = {
            postureTicks: {},
            operations: {},
            refused: {},
            running: new Map(),
          }),
        );
      const { postureTicks, operations, refused, running } = activity;
      postureTicks[state.posture] = (postureTicks[state.posture] ?? 0) + 1;
      if (!changed) continue;
      // Refusals are recorded at the tick their commands were planned.
      for (const rejection of state.rejections)
        if (rejection.tick === tick) {
          const key = `${rejection.command.kind}:${rejection.reason ?? "refused"}`;
          refused[key] = (refused[key] ?? 0) + 1;
        }
      const seen = new Set<string>();
      for (const { concern, operation } of operationsOf(state.memory)) {
        const key = JSON.stringify([concern, operation.id]);
        seen.add(key);
        const summary = (operations[operation.kind] ??= {
          launched: 0,
          firstLaunchTick: tick,
          ended: {},
        });
        let entry = running.get(key);
        // A group redirected after its operation ended starts another.
        if (!entry || (entry.outcome && !operation.outcome))
          summary.launched += 1;
        if (!entry) running.set(key, (entry = { kind: operation.kind }));
        if (operation.phase === "advance") summary.firstAdvanceTick ??= tick;
        if (operation.outcome && !entry.outcome)
          summary.ended[operation.outcome] =
            (summary.ended[operation.outcome] ?? 0) + 1;
        entry.outcome = operation.outcome;
      }
      for (const [key, { kind, outcome }] of running) {
        if (seen.has(key)) continue;
        running.delete(key);
        if (!outcome) {
          const { ended } = operations[kind]!;
          ended.disbanded = (ended.disbanded ?? 0) + 1;
        }
      }
    }
  };
  const report = (owner: string): OwnerActivity | undefined => {
    const activity = owners.get(owner);
    return (
      activity && {
        postureTicks: activity.postureTicks,
        operations: activity.operations,
        refused: activity.refused,
      }
    );
  };
  return { observe, report };
}

/** Saved AI state larger than this suggests memory that keeps growing. */
const MEMORY_LIMIT_CHARACTERS = 64 * 1024;
/** The first problems found; repeats of one problem count once. */
const AUDIT_LIMIT = 20;

/**
 * Checks AI bookkeeping once a simulation second: claims and operation units
 * owned by their AI, claims of lost units dropped by the next planning round,
 * and bounded saved state. Budgets are not compared with balances, since
 * payments outside AI commands reach budgets only at the next round.
 */
export function matchAudit(simulation: MissionSimulation) {
  const auditTicks = secondsToTicks(1, simulation.tickSeconds);
  const problems = new Set<string>();
  /** Claims of missing units, with the owner's next round when first seen. */
  let missingClaims = new Map<string, number>();
  const report = (problem: string) => {
    if (problems.size < AUDIT_LIMIT) problems.add(problem);
  };
  const observe = (tick: number) => {
    if (tick % auditTicks) return;
    const actors = new Map(simulation.actors.map((actor) => [actor.id, actor]));
    const missing = new Map<string, number>();
    for (const [owner, state] of Object.entries(simulation.ai)) {
      for (const [actorId, concern] of Object.entries(state.claims)) {
        const actor = actors.get(actorId);
        if (!actor) {
          const key = JSON.stringify([owner, actorId]);
          const round = missingClaims.get(key) ?? state.nextRoundTick;
          missing.set(key, round);
          // A round that began since then reconciled claims.
          if (state.nextRoundTick > round)
            report(`${owner} ${concern} keeps a claim on a lost unit`);
        } else if (actor.owner !== owner)
          report(`${owner} ${concern} claims another owner's unit`);
      }
      for (const { concern, operation } of operationsOf(state.memory))
        for (const id of operation.units)
          if (actors.has(id) && actors.get(id)!.owner !== owner)
            report(`${owner} ${concern} operation holds another owner's unit`);
      if (JSON.stringify(state).length > MEMORY_LIMIT_CHARACTERS)
        report(
          `${owner} AI state exceeds ${MEMORY_LIMIT_CHARACTERS} characters`,
        );
    }
    missingClaims = missing;
  };
  return { observe, problems: () => [...problems] };
}

/** Removes an owner's actors partway through a match. */
export type Disruption = {
  readonly minutes: number;
  readonly owner: string;
  /** Every actor of these definitions the owner then has is removed. */
  readonly definitionIds: readonly string[];
  /** A loss the owner is not expected to replace, such as its headquarters. */
  readonly accepted?: true;
};

export type DisruptionReport = Disruption & {
  /** The owner's matching actors that the removal took away. */
  removed: number;
  /** When a new one was completed again; absent if it never was. */
  restoredTicks: Record<string, number>;
};

/** Applies disruptions on schedule and notes when each loss was replaced. */
export function disruptionTracker(
  simulation: MissionSimulation,
  disruptions: readonly Disruption[],
) {
  const { tickSeconds } = simulation;
  for (const { minutes, owner, definitionIds } of disruptions)
    if (
      !isNonnegative(minutes) ||
      !isCount(secondsToTicks(minutes * 60, tickSeconds)) ||
      !simulation.owners.some(({ id }) => id === owner) ||
      !isIdList(definitionIds) ||
      !definitionIds.length
    )
      throw new RangeError(
        "A disruption needs a valid time, owner, and distinct definitions.",
      );
  // A resumed match already holds the losses scheduled before it.
  const reports = disruptions
    .map(
      (
        disruption,
      ): DisruptionReport & {
        tick: number;
        /** The actors whose removal was submitted, once it was. */
        targets?: ReadonlySet<string>;
      } => ({
        ...disruption,
        tick: secondsToTicks(disruption.minutes * 60, tickSeconds),
        removed: 0,
        restoredTicks: {},
      }),
    )
    .filter(({ tick }) => tick >= simulation.completedTicks);
  /** Queues removals for the coming tick. */
  const apply = () => {
    for (const report of reports) {
      if (report.targets || simulation.completedTicks < report.tick) continue;
      report.targets = new Set(
        simulation.actors
          .filter(
            (actor) =>
              actor.owner === report.owner &&
              report.definitionIds.includes(actor.definitionId),
          )
          .map(({ id }) => id),
      );
      for (const actorId of report.targets)
        simulation.submitCommand(
          { kind: "remove-actor", actorId },
          { owner: report.owner },
        );
    }
  };
  /** Counts removals that took effect; only other actors restore a loss. */
  const observe = (tick: number) => {
    const present = new Set(simulation.actors.map(({ id }) => id));
    for (const report of reports) {
      const { targets } = report;
      if (!targets || tick < report.tick) continue;
      if (tick === report.tick)
        report.removed = [...targets].filter((id) => !present.has(id)).length;
      else
        for (const definitionId of report.definitionIds)
          if (
            !hasOwn(report.restoredTicks, definitionId) &&
            simulation.actors.some(
              (actor) =>
                actor.owner === report.owner &&
                actor.definitionId === definitionId &&
                !actor.construction &&
                !targets.has(actor.id),
            )
          )
            report.restoredTicks = {
              ...report.restoredTicks,
              [definitionId]: tick,
            };
    }
  };
  const results = (): DisruptionReport[] =>
    reports.map(({ tick: _, targets: __, ...report }) => report);
  return { apply, observe, results };
}
