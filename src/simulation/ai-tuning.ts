// AI profile thresholds and timing, kept apart from difficulty scaling.
import { secondsToTicks } from "./clock";
import {
  hasOwn,
  isCount,
  isNonnegative,
  isPositive,
  isRecord,
} from "./validation";

/** Distances are in tiles, durations in seconds, odds as strength ratios. */
export type AiTuning = {
  /** Reports this old are uncertain and prompt fresh scouting. */
  readonly staleReportSeconds: number;
  readonly scouting: {
    /** The wait before replacing a lost scout. */
    readonly replacementSeconds: number;
    /** Spacing of the map points an otherwise idle scout sweeps. */
    readonly sweepTiles: number;
    /** Radius around danger or an unreachable target to avoid. */
    readonly avoidTiles: number;
    /** Delay before retrying a failed retreat home. */
    readonly retreatRetrySeconds: number;
  };
  readonly defense: {
    /** Hostiles this near own buildings or workers threaten them. */
    readonly threatTiles: number;
    /** Defense commits this multiple of the threat's strength. */
    readonly odds: number;
    /** Threats must stay away this long before defense ends. */
    readonly calmSeconds: number;
    /** Movement of a threat before the defense updates its objective. */
    readonly retargetTiles: number;
  };
  readonly offense: {
    /** No offensive operation starts before this match time. */
    readonly graceSeconds: number;
    /** Raid size, and the odds a raid needs against known defenders. */
    readonly raid: {
      readonly minUnits: number;
      readonly maxUnits: number;
      readonly odds: number;
    };
    /** An attack's minimum size, and its odds against known defenders. */
    readonly attack: { readonly units: number; readonly odds: number };
    /** Known hostiles this near a target defend it. */
    readonly defendedTiles: number;
    /** A raid moves on to income this near its finished target. */
    readonly raidRedirectTiles: number;
    /** Targets near a failed advance wait this long. */
    readonly avoidSeconds: number;
    readonly avoidTiles: number;
  };
  readonly operations: {
    /** A group within this distance of its gathering point has gathered. */
    readonly gatherTiles: number;
    /** An advancing group this spread out regroups, up to `maxRegroups`. */
    readonly regroupTiles: number;
    readonly maxRegroups: number;
    /** A phase without progress this long is replanned, up to `maxRetries`. */
    readonly stallSeconds: number;
    readonly maxRetries: number;
    /** Visible hostiles this near an advancing group count against it. */
    readonly engagementTiles: number;
    /** An advance retreats when visible hostiles outmatch it this much. */
    readonly retreatOdds: number;
    /** A group depleted below this share of its strength must clearly win. */
    readonly depletedShare: number;
  };
};

/** A check of one value; durations also need a safe tick count. */
type Check = (value: unknown, tickSeconds?: number) => boolean;
/** The checks for each tuning value, shaped like the tuning itself. */
type Spec<T> = {
  readonly [K in keyof T]-?: T[K] extends number ? Check : Spec<T[K]>;
};

const isPositiveCount: Check = (value) => isCount(value) && isPositive(value);
const isShare: Check = (value) => isPositive(value) && value <= 1;
/** Concerns add durations to ticks they save, so the sum must stay safe. */
const duration =
  (check: Check): Check =>
  (value, tickSeconds) =>
    check(value) &&
    (tickSeconds === undefined ||
      isCount(secondsToTicks(value as number, tickSeconds)));

const TUNING_SPEC: Spec<AiTuning> = {
  staleReportSeconds: duration(isPositive),
  scouting: {
    replacementSeconds: duration(isNonnegative),
    sweepTiles: isPositiveCount,
    avoidTiles: isNonnegative,
    retreatRetrySeconds: duration(isPositive),
  },
  defense: {
    threatTiles: isPositive,
    odds: isPositive,
    calmSeconds: duration(isNonnegative),
    retargetTiles: isNonnegative,
  },
  offense: {
    graceSeconds: duration(isNonnegative),
    raid: {
      minUnits: isPositiveCount,
      maxUnits: isPositiveCount,
      odds: isPositive,
    },
    attack: { units: isPositiveCount, odds: isPositive },
    defendedTiles: isNonnegative,
    raidRedirectTiles: isNonnegative,
    avoidSeconds: duration(isNonnegative),
    avoidTiles: isNonnegative,
  },
  operations: {
    gatherTiles: isPositive,
    regroupTiles: isPositive,
    maxRegroups: isCount,
    stallSeconds: duration(isPositive),
    maxRetries: isCount,
    engagementTiles: isPositive,
    retreatOdds: isPositive,
    depletedShare: isShare,
  },
};

/** Whether `value` has exactly the spec's keys, each valid. */
function matches(
  spec: Readonly<Record<string, unknown>>,
  value: unknown,
  tickSeconds: number | undefined,
): boolean {
  return (
    isRecord(value) &&
    Object.keys(value).every((key) => hasOwn(spec, key)) &&
    Object.entries(spec).every(([key, check]) =>
      typeof check === "function"
        ? (check as Check)(value[key], tickSeconds)
        : matches(check as Record<string, unknown>, value[key], tickSeconds),
    )
  );
}

/** With `tickSeconds`, durations must also convert to safe tick counts. */
export const isAiTuning = (
  value: unknown,
  tickSeconds?: number,
): value is AiTuning =>
  matches(TUNING_SPEC, value, tickSeconds) &&
  (value as AiTuning).offense.raid.minUnits <=
    (value as AiTuning).offense.raid.maxUnits;
