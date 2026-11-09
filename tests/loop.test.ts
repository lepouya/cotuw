import { afterEach, describe, expect, test, vi } from "vitest";

import { startSimulationLoop } from "../src/simulation/loop";

import type { CommandOutcome } from "../src/simulation/command";
import type {
  SimulationLoop,
  SimulationLoopOptions,
} from "../src/simulation/loop";

const loops: SimulationLoop[] = [];
afterEach(() => {
  for (const loop of loops.splice(0)) loop.stop();
});

/** A loop on a manual clock whose timer never fires during a test. */
function manualLoop(
  tickSeconds: number,
  options: Partial<SimulationLoopOptions> = {},
) {
  const clock = { now: 0, ticks: 0 };
  const loop = startSimulationLoop(
    {
      tickSeconds,
      tick: () => {
        clock.ticks++;
        return [];
      },
    },
    {
      pumpMilliseconds: 60_000,
      maxCatchUpSeconds: 1,
      now: () => clock.now,
      ...options,
    },
  );
  loops.push(loop);
  return Object.assign(clock, { loop });
}

test("speed changes retain fractional ticks instead of discarding earned time", () => {
  const run = manualLoop(0.1);
  run.now = 50;
  run.loop.setSpeed(2);
  expect(run.loop.tickProgress()).toBeCloseTo(0.5);
  run.now = 75;
  run.loop.advance();
  expect(run.ticks).toBe(1);
  run.now = 100;
  run.loop.setSpeed(0.5);
  expect(run.loop.tickProgress()).toBeCloseTo(0.5);
  run.now = 200;
  run.loop.advance();
  expect(run.ticks).toBe(2);
});

describe("simulation loop", () => {
  test.each(["beforeTick", "afterTick"] as const)(
    "pause and resume in %s discard the old batch",
    (hook) => {
      let restarted = false;
      const run = manualLoop(0.1, {
        [hook]: () => {
          if (restarted) return;
          restarted = true;
          run.loop.pause();
          run.loop.resume();
        },
      });
      run.now = 10_000;
      run.loop.advance();
      const before = hook === "beforeTick" ? 0 : 1;
      expect(run.ticks).toBe(before);
      run.loop.advance();
      expect(run.ticks).toBe(before);
      run.now += 100;
      run.loop.advance();
      expect(run.ticks).toBe(before + 1);
    },
  );

  test("recursive hook advances cannot exceed the batch limit", () => {
    const run = manualLoop(0.1, {
      beforeTick: () => run.loop.advance(),
      afterTick: () => run.loop.advance(),
    });
    run.now = 10_000;
    run.loop.advance();
    expect(run.ticks).toBe(10);
    run.loop.advance();
    expect(run.ticks).toBe(20);
  });

  test.each(["advance", "tickProgress", "resume", "setSpeed"] as const)(
    "a broken time source faults during %s",
    (operation) => {
      const onFault = vi.fn();
      const run = manualLoop(0.1, { onFault });
      if (operation === "resume") run.loop.pause();
      run.now = NaN;
      if (operation === "setSpeed") run.loop.setSpeed(2);
      else run.loop[operation]();
      expect(run.loop.faulted).toBe(true);
      expect(onFault).toHaveBeenCalledOnce();
      run.now = 1_000;
      run.loop.advance();
      expect(run.ticks).toBe(0);
      expect(run.loop.tickProgress()).toBe(1);
      expect(onFault).toHaveBeenCalledOnce();
    },
  );

  test.each([0, -1, NaN, Infinity])(
    "rejects invalid pump and catch-up intervals %s",
    (invalid) => {
      const simulation = { tickSeconds: 0.1, tick: () => [] };
      for (const options of [
        { pumpMilliseconds: invalid, maxCatchUpSeconds: 1 },
        { pumpMilliseconds: 1, maxCatchUpSeconds: invalid },
      ])
        expect(() => startSimulationLoop(simulation, options)).toThrow(
          RangeError,
        );
    },
  );

  test.each([0.5, 2, 4])(
    "speed %s preserves whole and fractional ticks owed before a rate change",
    (speed) => {
      const run = manualLoop(0.1);
      run.now = 10_050;
      run.loop.setSpeed(speed);
      expect(run.ticks).toBe(0);
      expect(run.loop.tickProgress()).toBe(1);
      for (let batch = 0; batch < 20; batch++) run.loop.advance();
      expect(run.ticks).toBe(100);
      expect(run.loop.tickProgress()).toBeCloseTo(0.5);
      run.now += 50 / speed;
      run.loop.advance();
      expect(run.ticks).toBe(101);
      expect(run.loop.tickProgress()).toBeCloseTo(0);
    },
  );

  test.each([4, 250, 1_000])(
    "timer pumps every %s ms run at 60 Hz without a render loop",
    (pumpMilliseconds) => {
      vi.useFakeTimers();
      let ticks = 0;
      const loop = startSimulationLoop(
        {
          tickSeconds: 1 / 60,
          tick: () => {
            ticks++;
            return [];
          },
        },
        { pumpMilliseconds, maxCatchUpSeconds: 5 },
      );
      try {
        vi.advanceTimersByTime(10_000);
        expect(ticks).toBe(600);
      } finally {
        loop.stop();
        vi.useRealTimers();
      }
    },
  );

  test("pausing during a result discards backlog and resumes from the current time", () => {
    const run = manualLoop(0.01, {
      afterTick: () => {
        if (run.ticks === 1) run.loop.pause();
      },
    });
    run.now = 10_000;
    run.loop.advance();
    expect(run.ticks).toBe(1);
    run.now = 20_000;
    run.loop.advance();
    expect(run.ticks).toBe(1);
    run.loop.resume();
    run.loop.advance();
    expect(run.ticks).toBe(1);
    run.now += 20;
    run.loop.advance();
    expect(run.ticks).toBe(3);
  });

  test("runs owed ticks with hooks around each one", () => {
    let now = 0;
    const calls: string[] = [];
    const outcomes: CommandOutcome[] = [];
    const loop = startSimulationLoop(
      {
        tickSeconds: 0.01,
        tick: () => {
          calls.push("tick");
          return outcomes;
        },
      },
      {
        pumpMilliseconds: 60_000,
        maxCatchUpSeconds: 0.05,
        beforeTick: () => calls.push("before"),
        afterTick: (result) => {
          expect(result).toBe(outcomes);
          calls.push("after");
        },
        now: () => now,
      },
    );
    loops.push(loop);

    now = 25;
    loop.advance();
    expect(calls).toEqual([
      "before",
      "tick",
      "after",
      "before",
      "tick",
      "after",
    ]);
    expect(loop.tickProgress()).toBeCloseTo(0.5);

    calls.length = 0;
    now = 1_000;
    loop.advance();
    expect(calls.filter((call) => call === "tick")).toHaveLength(5);
  });

  test("stops on a fault without running the failed tick again", () => {
    let now = 0;
    let calls = 0;
    const error = new Error("invalid mission state");
    const faults: unknown[] = [];
    const loop = startSimulationLoop(
      {
        tickSeconds: 0.01,
        tick: () => {
          calls += 1;
          throw error;
        },
      },
      {
        pumpMilliseconds: 60_000,
        maxCatchUpSeconds: 0.05,
        now: () => now,
        onFault: (fault) => faults.push(fault),
      },
    );

    now = 10_000;
    loop.advance();
    loop.advance();

    expect(calls).toBe(1);
    expect(loop.faulted).toBe(true);
    expect(loop.fault).toBe(error);
    expect(loop.tickProgress()).toBe(1);
    expect(faults).toEqual([error]);
  });

  test("speed scales ticks per real second and carries owed ticks", () => {
    const run = manualLoop(0.01);
    run.now = 50;
    run.loop.setSpeed(2);
    expect(run.ticks).toBe(0);
    run.now = 100;
    run.loop.advance();
    expect(run.ticks).toBe(15);
    expect(run.loop.speed).toBe(2);
    run.loop.setSpeed(0.5);
    run.now = 200;
    run.loop.advance();
    expect(run.ticks).toBe(20);
    expect(() => run.loop.setSpeed(0)).toThrow(RangeError);
  });
});

test("stopping in a tick callback discards the remaining clock backlog", () => {
  const run = manualLoop(0.01, { afterTick: () => run.loop.stop() });
  run.now = 10_000;
  run.loop.advance();
  expect(run.ticks).toBe(1);
  expect(run.loop.tickProgress()).toBe(1);
  run.loop.advance();
  expect(run.ticks).toBe(1);
});

test("paused inspection owes no ticks even when its speed changes", () => {
  const run = manualLoop(0.01, { paused: true });
  run.now = 1000;
  run.loop.setSpeed(2);
  run.now = 10_000;
  run.loop.advance();
  expect(run.ticks).toBe(0);
  run.loop.resume();
  run.loop.advance();
  expect(run.ticks).toBe(0);
  run.now += 20;
  run.loop.advance();
  expect(run.ticks).toBe(4);
});

test("stopping before a tick prevents it from running", () => {
  const run = manualLoop(0.01, { beforeTick: () => run.loop.stop() });
  run.now = 1000;
  run.loop.advance();
  expect(run.ticks).toBe(0);
});
