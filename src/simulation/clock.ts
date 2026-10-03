const BOUNDARY_TOLERANCE_TICKS = 1e-9;

/** Timed work takes at least one tick. */
export const secondsToTicks = (seconds = 0, tickSeconds: number) =>
  Math.max(1, Math.ceil(seconds / tickSeconds));

export type FixedStepClockOptions = {
  tickSeconds: number;
  /** A monotonic timestamp, such as `performance.now()`, when ticking starts. */
  startMilliseconds: number;
  /** The most ticks one call may return. Any larger backlog is dropped. */
  maxCatchUpTicks: number;
};

/** Converts monotonic real time into the whole fixed ticks it owes. */
export type FixedStepClock = {
  ticksDue: (nowMilliseconds: number) => number;
  /** How far real time is past the last counted tick, from 0 to 1. */
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
  if (!Number.isInteger(maxCatchUpTicks) || maxCatchUpTicks < 1) {
    throw new RangeError("Clock catch-up ticks must be a positive integer.");
  }

  const tickMilliseconds = tickSeconds * 1_000;
  // Counting from a fixed origin keeps rounding from accumulating as drift.
  const elapsed = (nowMilliseconds: number) =>
    (nowMilliseconds - startMilliseconds) / tickMilliseconds;
  let ticksCounted = 0;
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

      ticksCounted = elapsedTicks;
      return Math.min(due, maxCatchUpTicks);
    },
    tickProgress: (nowMilliseconds) =>
      Math.min(Math.max(elapsed(nowMilliseconds) - ticksCounted, 0), 1),
  };
}
