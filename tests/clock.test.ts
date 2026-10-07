import { describe, expect, test } from "vitest";

import { createFixedStepClock } from "../src/simulation/clock";

function clock(maxCatchUpTicks = 100) {
  return createFixedStepClock({
    tickSeconds: 1 / 60,
    startMilliseconds: 1_000,
    maxCatchUpTicks,
  });
}

describe("fixed-step clock", () => {
  test.each([NaN, Infinity, -Infinity, Number.MAX_VALUE])(
    "invalid time %s does not corrupt earned ticks",
    (now) => {
      const fixed = clock();
      for (const read of [
        fixed.ticksDue,
        fixed.pendingTicks,
        fixed.tickProgress,
      ])
        expect(() => read(now)).toThrow(RangeError);
      expect(fixed.ticksDue(1_050)).toBe(3);
    },
  );

  test("rejects origins, intervals and batch limits outside clock arithmetic", () => {
    const options = {
      tickSeconds: 0.1,
      startMilliseconds: 0,
      maxCatchUpTicks: 100,
    };
    for (const change of [
      { startMilliseconds: NaN },
      { startMilliseconds: Infinity },
      { tickSeconds: Number.MAX_VALUE },
      { maxCatchUpTicks: Number.MAX_SAFE_INTEGER + 1 },
    ])
      expect(() => createFixedStepClock({ ...options, ...change })).toThrow(
        RangeError,
      );
  });

  test("owes one tick per elapsed tick interval", () => {
    const fixed = clock();

    expect(fixed.ticksDue(1_010)).toBe(0);
    expect(fixed.ticksDue(1_017)).toBe(1);
    expect(fixed.ticksDue(1_020)).toBe(0);
    expect(fixed.ticksDue(1_050)).toBe(2);
  });

  test("tracks real time without drift over many irregular calls", () => {
    const fixed = clock();
    let ticks = 0;
    for (let now = 1_000; now <= 61_000; now += 7) {
      ticks += fixed.ticksDue(now);
    }
    ticks += fixed.ticksDue(61_000);

    expect(ticks).toBe(3_600);
  });

  test("catches up in bounded batches without dropping stalled time", () => {
    const fixed = clock(30);

    expect(fixed.ticksDue(1_250)).toBe(15);
    expect(fixed.ticksDue(3_000)).toBe(30);
    expect(fixed.tickProgress(3_000)).toBe(1);
    expect(fixed.ticksDue(3_000)).toBe(30);
    expect(fixed.ticksDue(3_000)).toBe(30);
    expect(fixed.ticksDue(3_017)).toBe(16);
    expect(fixed.ticksDue(3_017)).toBe(0);
    expect(fixed.tickProgress(3_017)).toBeCloseTo(0.02);
  });

  test("a ten-second stall accounts for every tick across five-second batches", () => {
    const fixed = clock(300);

    expect(fixed.ticksDue(11_000)).toBe(300);
    expect(fixed.ticksDue(11_000)).toBe(300);
    expect(fixed.ticksDue(11_000)).toBe(0);
    expect(fixed.tickProgress(11_000)).toBe(0);
  });

  test("reports progress into the next tick", () => {
    const fixed = clock();

    expect(fixed.tickProgress(1_000)).toBe(0);
    fixed.ticksDue(1_025);
    expect(fixed.tickProgress(1_025)).toBeCloseTo(0.5);
    // Before the owed tick runs, progress holds at a full tick.
    expect(fixed.tickProgress(1_040)).toBe(1);
  });
});
