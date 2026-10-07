import { isCount } from "./validation";

const BOUNDARY_TOLERANCE_TICKS = 1e-9;
/** The game's fixed tick; mission files record it and load only at this rate. */
export const SIMULATION_TICK_SECONDS = 1 / 60;

/** Timed work takes at least one tick. */
export const secondsToTicks = (seconds = 0, tickSeconds: number) =>
  Math.max(1, Math.ceil(seconds / tickSeconds));

export const isTick = isCount;

export type FixedStepClockOptions = {
  tickSeconds: number;
  /** A monotonic timestamp, such as `performance.now()`, when ticking starts. */
  startMilliseconds: number;
  /** The most ticks one call may return; the rest remain pending. */
  maxCatchUpTicks: number;
};

/** Converts monotonic real time into the whole fixed ticks it owes. */
export type FixedStepClock = {
  ticksDue: (nowMilliseconds: number) => number;
  /** Unreturned ticks, including the fraction of the next tick. */
  pendingTicks: (nowMilliseconds: number) => number;
  /** Interpolation fraction, clamped to 1 while whole ticks remain pending. */
  tickProgress: (nowMilliseconds: number) => number;
};

export function createFixedStepClock({
  tickSeconds,
  startMilliseconds,
  maxCatchUpTicks,
}: FixedStepClockOptions): FixedStepClock {
  if (!Number.isFinite(tickSeconds) || tickSeconds <= 0) {
    throw new RangeError(
      "Clock tick seconds must be a positive finite number.",
    );
  }
  if (!isCount(maxCatchUpTicks) || maxCatchUpTicks < 1) {
    throw new RangeError(
      "Clock catch-up ticks must be a positive safe integer.",
    );
  }

  const tickMilliseconds = tickSeconds * 1_000;
  if (!Number.isFinite(tickMilliseconds) || !Number.isFinite(startMilliseconds))
    throw new RangeError("Clock interval and origin must be finite.");
  // Counting from a fixed origin keeps rounding from accumulating as drift.
  const elapsed = (nowMilliseconds: number) => {
    const ticks = (nowMilliseconds - startMilliseconds) / tickMilliseconds;
    if (!Number.isFinite(ticks) || Math.abs(ticks) > Number.MAX_SAFE_INTEGER)
      throw new RangeError(
        "Clock time must resolve to a finite, safe tick count.",
      );
    return ticks;
  };
  let ticksCounted = 0;
  const pendingTicks = (nowMilliseconds: number) =>
    Math.max(elapsed(nowMilliseconds) - ticksCounted, 0);
  return {
    ticksDue: (nowMilliseconds) => {
      // The tolerance lets an exact boundary count despite an inexact tick.
      const elapsedTicks = Math.floor(
        elapsed(nowMilliseconds) + BOUNDARY_TOLERANCE_TICKS,
      );
      const due = elapsedTicks - ticksCounted;
      if (due <= 0) {
        return 0;
      }

      const ticks = Math.min(due, maxCatchUpTicks);
      ticksCounted += ticks;
      return ticks;
    },
    pendingTicks,
    tickProgress: (nowMilliseconds) =>
      Math.min(pendingTicks(nowMilliseconds), 1),
  };
}
