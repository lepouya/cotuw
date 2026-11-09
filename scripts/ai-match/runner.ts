// Plays headless AI-versus-AI skirmish cases and reports their outcomes.
import { SKIRMISH_MAP } from "../../src/content/skirmish-map.ts";
import { errorMessage } from "../../src/errors.ts";
import {
  assembleSkirmish,
  createSessionSimulation,
} from "../../src/mission-loading.ts";
import {
  secondsToTicks,
  SIMULATION_TICK_SECONDS,
} from "../../src/simulation/clock.ts";
import { serializeMission } from "../../src/simulation/mission-file.ts";
import { DIFFICULTY_IDS } from "../../src/simulation/mission-setup.ts";
import { isCount, isPositive } from "../../src/simulation/validation.ts";

import type { SkirmishChoice } from "../../src/content/skirmish.ts";
import type { SkirmishFaction } from "../../src/content/skirmish-map.ts";
import type { LoadedMission } from "../../src/mission-loading.ts";
import type { AiConcern, OwnerAiState } from "../../src/simulation/director.ts";
import type {
  MatchSample,
  OwnerMetrics,
} from "../../src/simulation/match-metrics.ts";
import type { Difficulty } from "../../src/simulation/mission-setup.ts";
import type { SkirmishResult } from "../../src/simulation/skirmish.ts";

export const DEFAULT_CUTOFF_MINUTES = 30;

export type MatchCase = {
  readonly id: string;
  readonly choice: SkirmishChoice;
  /** Simulation minutes before an unfinished case stops. */
  readonly cutoffMinutes?: number;
};

/** The profile each faction's AI uses in baseline cases. */
const STANDARD_PROFILES: Partial<Record<SkirmishFaction, string>> = {
  arc: "arc-skirmish",
};

/**
 * Every slot under its faction's standard AI, with each slot standing in for
 * the player at each difficulty. The player slot decides enemy scaling.
 */
export function skirmishCases(
  name: string,
  factions: Readonly<Record<string, SkirmishFaction>>,
): MatchCase[] {
  const slots = SKIRMISH_MAP.starts.map(({ id }) => id);
  const ai = slots.map((owner) => {
    const profileId = STANDARD_PROFILES[factions[owner]!];
    if (!profileId)
      throw new RangeError(`Faction ${factions[owner]} has no standard AI.`);
    return { owner, profileId };
  });
  return slots.flatMap((playerSlot) =>
    DIFFICULTY_IDS.map((difficulty) => ({
      id: `${name}-${playerSlot}-${difficulty}`,
      choice: { factions, playerSlot, difficulty, ai },
    })),
  );
}

export const ARC_MIRROR_CASES = skirmishCases("arc-mirror", {
  west: "arc",
  east: "arc",
});

/** Named case sets the command line runs; every set by default. */
export const CASE_SETS: ReadonlyMap<string, readonly MatchCase[]> = new Map([
  ["arc-mirror", ARC_MIRROR_CASES],
]);

export type AiDiagnostics = Pick<
  OwnerAiState,
  "posture" | "requestedPosture" | "budgets" | "memory"
> & {
  /** Claimed actors by concern. */
  claims: Record<string, number>;
  /** Refused commands still waiting for their concerns' next turns. */
  rejections: {
    concern: string;
    tick: number;
    kind: string;
    reason?: string;
  }[];
};

export type OwnerReport = Omit<OwnerMetrics, "history"> & {
  faction?: string;
  profileId?: string;
  /** The latest history sample; the final one when the match has a result. */
  latest?: MatchSample;
  ai?: AiDiagnostics;
};

/** Deterministic for a given case, revision, and set of concerns. */
export type MatchReport = {
  case: string;
  factions: Record<string, string>;
  playerSlot: string;
  difficulty?: Difficulty;
  enemyScale: number;
  enemyOwners: readonly string[];
  cutoffTicks: number;
  /** Completed ticks; a faulted case stops after its last committed tick. */
  ticks: number;
  seconds: number;
  owners: OwnerReport[];
} & MatchOutcome;

export type MatchOutcome =
  | { status: "completed"; result: SkirmishResult }
  /** Reached the cutoff without a result. */
  | { status: "incomplete" }
  /** A tick threw; the error names the cause. */
  | { status: "faulted"; fault: string };

export type MatchRun = {
  report: MatchReport;
  /** The mission file where an unfinished case stopped, to load and inspect. */
  preservedState?: string;
};

export type MatchOptions = {
  cutoffMinutes?: number;
  aiConcerns?: ReadonlyMap<string, AiConcern>;
};

export function runMatch(
  { id, choice, cutoffMinutes }: MatchCase,
  aiConcerns?: ReadonlyMap<string, AiConcern>,
): MatchRun {
  return playMatch(id, assembleSkirmish(choice), { cutoffMinutes, aiConcerns });
}

function diagnose({
  posture,
  requestedPosture,
  budgets,
  claims,
  rejections,
  memory,
}: OwnerAiState): AiDiagnostics {
  const claimed = new Map<string, number>();
  for (const concern of Object.values(claims))
    claimed.set(concern, (claimed.get(concern) ?? 0) + 1);
  return {
    posture,
    ...(requestedPosture && { requestedPosture }),
    budgets,
    claims: Object.fromEntries(claimed),
    rejections: rejections.map(({ concern, tick, command, reason }) => ({
      concern,
      tick,
      kind: command.kind,
      ...(reason && { reason }),
    })),
    memory,
  };
}

const outcome = (
  result: SkirmishResult | undefined,
  fault: string | undefined,
): MatchOutcome => {
  if (result) return { status: "completed", result };
  return fault ? { status: "faulted", fault } : { status: "incomplete" };
};

/**
 * Ticks a loaded skirmish until its result, a fault, or an absolute match-time
 * cutoff, so a saved mission resumes toward the same cutoff.
 */
export function playMatch(
  caseId: string,
  mission: LoadedMission,
  { cutoffMinutes = DEFAULT_CUTOFF_MINUTES, aiConcerns }: MatchOptions = {},
): MatchRun {
  const { scenario } = mission;
  if (!scenario.skirmish)
    throw new RangeError(`Case ${caseId} is not a skirmish.`);
  const cutoffTicks = secondsToTicks(
    cutoffMinutes * 60,
    SIMULATION_TICK_SECONDS,
  );
  if (!isPositive(cutoffMinutes) || !isCount(cutoffTicks))
    throw new RangeError("Match cutoff must be positive and fit safe ticks.");
  const simulation = createSessionSimulation(mission, undefined, aiConcerns);
  try {
    let fault: string | undefined;
    try {
      while (!simulation.result && simulation.completedTicks < cutoffTicks)
        simulation.tick();
    } catch (error) {
      // A throwing tick leaves the mission at its last committed tick.
      fault = errorMessage(error);
    }
    const state = simulation.snapshot();
    const result = state.skirmishResult;
    const factions = new Map(
      state.owners.flatMap(({ id, faction }): [string, string][] =>
        faction === undefined ? [] : [[id, faction]],
      ),
    );
    const profiles = new Map(
      scenario.ai?.map(({ owner, profileId }) => [owner, profileId]),
    );
    const report: MatchReport = {
      case: caseId,
      factions: Object.fromEntries(factions),
      playerSlot: state.playerOwner,
      difficulty: scenario.setup?.difficulty,
      enemyScale: scenario.setup?.enemyScale ?? 1,
      enemyOwners: scenario.setup?.enemyOwners ?? [],
      ...outcome(result, fault),
      cutoffTicks,
      ticks: state.tick,
      seconds: state.tick * simulation.tickSeconds,
      owners: (state.metrics?.owners ?? []).map(
        ({ owner, history, ...totals }): OwnerReport => ({
          owner,
          faction: factions.get(owner),
          profileId: profiles.get(owner),
          ...totals,
          latest: history[history.length - 1],
          ai: state.ai[owner] && diagnose(state.ai[owner]!),
        }),
      ),
    };
    if (report.status === "completed") return { report };
    return {
      report,
      preservedState: serializeMission(scenario, state, simulation.tickSeconds),
    };
  } finally {
    simulation.dispose();
  }
}
