// Plays headless AI-versus-AI skirmish cases and reports their outcomes.
import { SKIRMISH_MAP } from "../../src/content/skirmish-map.ts";
import { errorMessage } from "../../src/errors.ts";
import { formatElapsed } from "../../src/format-time.ts";
import {
  assembleSkirmish,
  createSessionSimulation,
} from "../../src/mission-loading.ts";
import {
  secondsToTicks,
  SIMULATION_TICK_SECONDS,
} from "../../src/simulation/clock.ts";
import { aiDiagnostics } from "../../src/simulation/director.ts";
import {
  parseMission,
  serializeMission,
} from "../../src/simulation/mission-file.ts";
import { DIFFICULTY_IDS } from "../../src/simulation/mission-setup.ts";
import {
  hasOwn,
  isCount,
  isPositive,
} from "../../src/simulation/validation.ts";
import { activityTracker, disruptionTracker, matchAudit } from "./observers.ts";

import type { SkirmishChoice } from "../../src/content/skirmish.ts";
import type { SkirmishFaction } from "../../src/content/skirmish-map.ts";
import type { LoadedMission } from "../../src/mission-loading.ts";
import type { OperationKind } from "../../src/simulation/ai-operations.ts";
import type {
  AiConcern,
  AiDiagnostics,
} from "../../src/simulation/director.ts";
import type {
  MatchSample,
  OwnerMetrics,
} from "../../src/simulation/match-metrics.ts";
import type { Difficulty } from "../../src/simulation/mission-setup.ts";
import type { SkirmishResult } from "../../src/simulation/skirmish.ts";
import type {
  Disruption,
  DisruptionReport,
  OwnerActivity,
} from "./observers.ts";

export const DEFAULT_CUTOFF_MINUTES = 30;

export type MatchCase = {
  readonly id: string;
  readonly choice: SkirmishChoice;
  /** Simulation minutes before an unfinished case stops. */
  readonly cutoffMinutes?: number;
  readonly disruptions?: readonly Disruption[];
  /**
   * Saves and reloads the match at this time, and checks the resumed match
   * reports what an uninterrupted one does.
   */
  readonly resumeAtMinutes?: number;
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

const NORMAL_WEST = ARC_MIRROR_CASES.find(
  ({ id }) => id === "arc-mirror-west-normal",
)!;

/** West loses part of its base at 6:00, before either side attacks a base. */
const lossCase = (
  name: string,
  definitionIds: string[],
  options: Pick<Disruption, "accepted"> = {},
): MatchCase => ({
  id: `arc-recovery-${name}`,
  choice: NORMAL_WEST.choice,
  disruptions: [{ minutes: 6, owner: "west", definitionIds, ...options }],
});

export const ARC_RECOVERY_CASES: readonly MatchCase[] = [
  lossCase("workers", ["arc-harvester"]),
  lossCase("income", ["arc-harvester", "arc-materials-refinery"]),
  lossCase("production", ["arc-field-barracks"]),
  // A replacement needs more Materials banked than a 6:00 base holds.
  lossCase("headquarters", ["arc-command-center-prototype"], {
    accepted: true,
  }),
];

/** Saved during the first attacks, with operations under way. */
export const ARC_CONTINUATION_CASES: readonly MatchCase[] = [
  { ...NORMAL_WEST, id: "arc-continuation", resumeAtMinutes: 9.5 },
];

/** Named case sets the command line runs; every set by default. */
export const CASE_SETS: ReadonlyMap<string, readonly MatchCase[]> = new Map([
  ["arc-mirror", ARC_MIRROR_CASES],
  ["arc-recovery", ARC_RECOVERY_CASES],
  ["arc-continuation", ARC_CONTINUATION_CASES],
]);

export type OwnerReport = Omit<OwnerMetrics, "history"> & {
  faction?: string;
  profileId?: string;
  /** The latest history sample; the final one when the match has a result. */
  latest?: MatchSample;
  ai?: AiDiagnostics;
} & Partial<OwnerActivity>;

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
  /** AI bookkeeping faults; any fails the case. */
  audit: string[];
  disruptions?: DisruptionReport[];
  /** Whether a saved and resumed run reported the same match. */
  continuation?: "matched" | "diverged" | "not reached";
} & MatchOutcome;

export type MatchOutcome =
  | { status: "completed"; result: SkirmishResult }
  /** Reached the cutoff without a result. */
  | { status: "incomplete" }
  /** A tick threw; the error names the cause. */
  | { status: "faulted"; fault: string };

export type MatchRun = {
  report: MatchReport;
  /** A failed case's final state, or its checkpoint if continuation failed. */
  preservedState?: string;
};

export type MatchOptions = {
  cutoffMinutes?: number;
  aiConcerns?: ReadonlyMap<string, AiConcern>;
  disruptions?: readonly Disruption[];
};

/** A result, clean bookkeeping, replaced losses, and an exercised resume. */
export const passed = (report: MatchReport) =>
  report.status === "completed" &&
  !report.audit.length &&
  (report.disruptions ?? []).every(
    ({ removed, definitionIds, restoredTicks, accepted }) =>
      removed > 0 &&
      (accepted || definitionIds.every((id) => hasOwn(restoredTicks, id))),
  ) &&
  (report.continuation === undefined || report.continuation === "matched");

export const formatTick = (tick: number) =>
  formatElapsed(tick * SIMULATION_TICK_SECONDS);

/** Each owner's first raid and attack launches, for pacing at a glance. */
export const launchSummary = (report: MatchReport) =>
  report.owners
    .map(({ owner, operations }) => {
      const first = (kind: OperationKind) => {
        const tick = operations?.[kind]?.firstLaunchTick;
        return tick === undefined ? "none" : formatTick(tick);
      };
      return `${owner} raid ${first("raid")}, attack ${first("attack")}`;
    })
    .join("; ");

/** Each disruption's losses and when the owner completed them again. */
export const disruptionSummary = (report: MatchReport) =>
  (report.disruptions ?? []).map(
    ({ owner, minutes, removed, definitionIds, restoredTicks, accepted }) => {
      const restored = definitionIds.map(
        (id) =>
          `${id} ${hasOwn(restoredTicks, id) ? formatTick(restoredTicks[id]!) : "never"}`,
      );
      return `${owner} lost ${removed} at ${formatElapsed(minutes * 60)}${accepted ? " (accepted)" : ""}; restored ${restored.join(", ")}`;
    },
  );

export function runMatch(
  { id, choice, cutoffMinutes, disruptions, resumeAtMinutes }: MatchCase,
  aiConcerns?: ReadonlyMap<string, AiConcern>,
): MatchRun {
  const mission = assembleSkirmish(choice);
  const options = { cutoffMinutes, aiConcerns, disruptions };
  if (resumeAtMinutes !== undefined && !isPositive(resumeAtMinutes))
    throw new RangeError("Resume time must be positive.");
  const run = simulateMatch(id, mission, options);
  if (resumeAtMinutes === undefined) return preserveFailure(run);
  // A shorter command-line cutoff leaves the checkpoint unreached.
  if (resumeAtMinutes >= (cutoffMinutes ?? DEFAULT_CUTOFF_MINUTES))
    return preserveFailure({
      ...run,
      report: { ...run.report, continuation: "not reached" },
    });
  const saved = simulateMatch(id, mission, {
    ...options,
    cutoffMinutes: resumeAtMinutes,
  });
  if (saved.report.status !== "incomplete")
    return preserveFailure({
      ...run,
      report: { ...run.report, continuation: "not reached" },
    });
  let resumed: SimulatedMatch;
  try {
    resumed = simulateMatch(
      id,
      {
        ...mission,
        ...parseMission(saved.state, SIMULATION_TICK_SECONDS),
      },
      options,
    );
  } catch (error) {
    return preserveFailure({
      state: saved.state,
      report: {
        ...run.report,
        continuation: "diverged",
        audit: [
          ...run.report.audit,
          `save/load failed: ${errorMessage(error)}`,
        ],
      },
    });
  }
  const matched = resumed.state === run.state;
  return preserveFailure({
    state: matched ? run.state : saved.state,
    report: {
      ...run.report,
      continuation: matched ? "matched" : "diverged",
      audit: [
        ...run.report.audit,
        ...saved.report.audit.map((problem) => `before save: ${problem}`),
        ...resumed.report.audit.map((problem) => `after load: ${problem}`),
      ],
    },
  });
}

type SimulatedMatch = { report: MatchReport; state: string };

const preserveFailure = ({ report, state }: SimulatedMatch): MatchRun => ({
  report,
  ...(!passed(report) && { preservedState: state }),
});

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
  options: MatchOptions = {},
): MatchRun {
  return preserveFailure(simulateMatch(caseId, mission, options));
}

function simulateMatch(
  caseId: string,
  mission: LoadedMission,
  {
    cutoffMinutes = DEFAULT_CUTOFF_MINUTES,
    aiConcerns,
    disruptions = [],
  }: MatchOptions = {},
): SimulatedMatch {
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
    const activity = activityTracker();
    const audit = matchAudit(simulation);
    const losses = disruptionTracker(simulation, disruptions);
    let fault: string | undefined;
    try {
      while (!simulation.result && simulation.completedTicks < cutoffTicks) {
        losses.apply();
        simulation.tick();
        // The director planned this tick from its starting state.
        const tick = simulation.completedTicks - 1;
        activity.observe(simulation.ai, tick);
        audit.observe(tick);
        losses.observe(tick);
      }
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
          ai: state.ai[owner] && aiDiagnostics(state.ai[owner]!),
          ...activity.report(owner),
        }),
      ),
      audit: audit.problems(),
      ...(disruptions.length && { disruptions: losses.results() }),
    };
    return {
      report,
      state: serializeMission(scenario, state, simulation.tickSeconds),
    };
  } finally {
    simulation.dispose();
  }
}
