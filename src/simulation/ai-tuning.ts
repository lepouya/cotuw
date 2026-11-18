// AI profile thresholds and timing, kept apart from difficulty scaling.
import { secondsToTicks } from "./clock";
import {
  hasOwn,
  isCount,
  isId,
  isNonnegative,
  isPositive,
  isRecord,
} from "./validation";

/** Distances are in tiles, durations in seconds, odds as strength ratios. */
export type AiTuning = {
  /** Reports this old are uncertain and prompt fresh scouting. */
  readonly staleReportSeconds: number;
  /** The wait after a building search finds no site before the next. */
  readonly placementRetrySeconds: number;
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
    /** A group takes one support provider per this many members. */
    readonly supportUnits: number;
  };
  /** Build-plan sections, each owned and validated by the concern it names. */
  readonly plans?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
};

/** A check of one value; durations also need a safe tick count. */
export type Check = (value: unknown, tickSeconds?: number) => boolean;
/** The checks for each tuning value, shaped like the tuning itself. */
export type Spec<T> = {
  readonly [K in keyof T]-?: T[K] extends number ? Check : Check | Spec<T[K]>;
};
/** A concern's plan section checks, for plans it reads as its own type. */
export type PlanSpec = { readonly [key: string]: Check | PlanSpec };

export const isPositiveCount: Check = (value) =>
  isCount(value) && isPositive(value);
export const isShare: Check = (value) => isPositive(value) && value <= 1;
/** A nonempty list where every entry passes `check`. */
export const listOf =
  (check: Check): Check =>
  (value, tickSeconds) =>
    Array.isArray(value) &&
    value.length > 0 &&
    Array.from(value).every((entry) => check(entry, tickSeconds));
/** A record of definition IDs, each passing `check`. */
export const weightsOf =
  (check: Check): Check =>
  (value, tickSeconds) =>
    isRecord(value) &&
    Object.entries(value).every(
      ([key, entry]) => isId(key) && check(entry, tickSeconds),
    );
/** Concerns add durations to ticks they save, so the sum must stay safe. */
export const duration =
  (check: Check): Check =>
  (value, tickSeconds) =>
    check(value) &&
    (tickSeconds === undefined ||
      isCount(secondsToTicks(value as number, tickSeconds)));

const TUNING_SPEC: Spec<Omit<AiTuning, "plans">> = {
  staleReportSeconds: duration(isPositive),
  placementRetrySeconds: duration(isPositive),
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
    supportUnits: isPositiveCount,
  },
};

/** Whether `value` has exactly the spec's keys, each valid. */
export function matchesSpec(
  spec: PlanSpec,
  value: unknown,
  tickSeconds: number | undefined,
): boolean {
  return (
    isRecord(value) &&
    Object.keys(value).every((key) => hasOwn(spec, key)) &&
    Object.entries(spec).every(
      ([key, check]) =>
        hasOwn(value, key) &&
        (typeof check === "function"
          ? check(value[key], tickSeconds)
          : matchesSpec(check, value[key], tickSeconds)),
    )
  );
}

const withoutPlans = ({ plans: _plans, ...rest }: Record<string, unknown>) =>
  rest;

/** With `tickSeconds`, durations must also convert to safe tick counts. */
export const isAiTuning = (
  value: unknown,
  tickSeconds?: number,
): value is AiTuning =>
  isRecord(value) &&
  (value.plans === undefined ||
    (isRecord(value.plans) && Object.values(value.plans).every(isRecord))) &&
  matchesSpec(TUNING_SPEC, withoutPlans(value), tickSeconds) &&
  (value as AiTuning).offense.raid.minUnits <=
    (value as AiTuning).offense.raid.maxUnits;
