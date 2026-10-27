import { describe, expect, test, vi } from "vitest";

import { startSimulationLoop } from "../src/simulation/loop";

import type { SimulationLoop } from "../src/simulation/loop";
import type { CommandOutcome } from "../src/simulation/command";

test("speed changes retain fractional ticks instead of discarding earned time", () => {
  let now = 0;
  let ticks = 0;
  const loop = startSimulationLoop(
    {
      tickSeconds: 0.1,
      tick: () => {
        ticks++;
        return [];
      },
    },
    { pumpMilliseconds: 60_000, maxCatchUpSeconds: 1, now: () => now },
  );
  try {
    now = 50;
    loop.setSpeed(2);
    expect(loop.tickProgress()).toBeCloseTo(0.5);
    now = 75;
    loop.advance();
    expect(ticks).toBe(1);
    now = 100;
    loop.setSpeed(0.5);
    expect(loop.tickProgress()).toBeCloseTo(0.5);
    now = 200;
    loop.advance();
    expect(ticks).toBe(2);
  } finally {
    loop.stop();
  }
});

describe("simulation loop", () => {
  test.each(["beforeTick", "afterTick"] as const)(
    "pause and resume in %s discard the old batch",
    (hook) => {
      let now = 0;
      let ticks = 0;
      let restarted = false;
      const loop = startSimulationLoop(
        {
          tickSeconds: 0.1,
          tick: () => {
            ticks++;
            return [];
          },
        },
        {
          pumpMilliseconds: 60_000,
          maxCatchUpSeconds: 1,
          now: () => now,
          [hook]: () => {
            if (restarted) return;
            restarted = true;
            loop.pause();
            loop.resume();
          },
        },
      );
      try {
        now = 10_000;
        loop.advance();
        const before = hook === "beforeTick" ? 0 : 1;
        expect(ticks).toBe(before);
        loop.advance();
        expect(ticks).toBe(before);
        now += 100;
        loop.advance();
        expect(ticks).toBe(before + 1);
      } finally {
        loop.stop();
      }
    },
  );

  test("recursive hook advances cannot exceed the batch limit", () => {
    let now = 0;
    let ticks = 0;
    const loop = startSimulationLoop(
      {
        tickSeconds: 0.1,
        tick: () => {
          ticks++;
          return [];
        },
      },
      {
        pumpMilliseconds: 60_000,
        maxCatchUpSeconds: 1,
        now: () => now,
        beforeTick: () => loop.advance(),
        afterTick: () => loop.advance(),
      },
    );
    try {
      now = 10_000;
      loop.advance();
      expect(ticks).toBe(10);
      loop.advance();
      expect(ticks).toBe(20);
    } finally {
      loop.stop();
    }
  });

  test.each(["advance", "tickProgress", "resume", "setSpeed"] as const)(
    "a broken time source faults during %s",
    (operation) => {
      let now = 0;
      const tick = vi.fn(() => []);
      const onFault = vi.fn();
      const loop = startSimulationLoop(
        { tickSeconds: 0.1, tick },
        {
          pumpMilliseconds: 60_000,
          maxCatchUpSeconds: 1,
          now: () => now,
          onFault,
        },
      );
      if (operation === "resume") loop.pause();
      now = NaN;
      if (operation === "setSpeed") loop.setSpeed(2);
      else loop[operation]();
      expect(loop.faulted).toBe(true);
      expect(onFault).toHaveBeenCalledOnce();
      now = 1_000;
      loop.advance();
      expect(tick).not.toHaveBeenCalled();
      expect(loop.tickProgress()).toBe(1);
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
      let now = 0;
      let ticks = 0;
      const loop = startSimulationLoop(
        {
          tickSeconds: 0.1,
          tick: () => {
            ticks++;
            return [];
          },
        },
        { pumpMilliseconds: 60_000, maxCatchUpSeconds: 1, now: () => now },
      );
      try {
        now = 10_050;
        loop.setSpeed(speed);
        expect(ticks).toBe(0);
        expect(loop.tickProgress()).toBe(1);
        for (let batch = 0; batch < 20; batch++) loop.advance();
        expect(ticks).toBe(100);
        expect(loop.tickProgress()).toBeCloseTo(0.5);
        now += 50 / speed;
        loop.advance();
        expect(ticks).toBe(101);
        expect(loop.tickProgress()).toBeCloseTo(0);
      } finally {
        loop.stop();
      }
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
    let now = 0;
    let ticks = 0;
    let loop: SimulationLoop;
    loop = startSimulationLoop(
      {
        tickSeconds: 0.01,
        tick: () => {
          ticks++;
          return [];
        },
      },
      {
        pumpMilliseconds: 60_000,
        maxCatchUpSeconds: 1,
        now: () => now,
        afterTick: () => {
          if (ticks === 1) loop.pause();
        },
      },
    );
    now = 10_000;
    loop.advance();
    expect(ticks).toBe(1);
    now = 20_000;
    loop.advance();
    expect(ticks).toBe(1);
    loop.resume();
    loop.advance();
    expect(ticks).toBe(1);
    now += 20;
    loop.advance();
    expect(ticks).toBe(3);
    loop.stop();
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
    loop.stop();
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
    let now = 0;
    let ticks = 0;
    const loop = startSimulationLoop(
      {
        tickSeconds: 0.01,
        tick: () => {
          ticks++;
          return [];
        },
      },
      { pumpMilliseconds: 60_000, maxCatchUpSeconds: 1, now: () => now },
    );
    now = 50;
    loop.setSpeed(2);
    expect(ticks).toBe(0);
    now = 100;
    loop.advance();
    expect(ticks).toBe(15);
    expect(loop.speed).toBe(2);
    loop.setSpeed(0.5);
    now = 200;
    loop.advance();
    expect(ticks).toBe(20);
    expect(() => loop.setSpeed(0)).toThrow(RangeError);
    loop.stop();
  });
});

test("stopping in a tick callback discards the remaining clock backlog", () => {
  let now = 0;
  let ticks = 0;
  let loop: SimulationLoop;
  loop = startSimulationLoop(
    {
      tickSeconds: 0.01,
      tick: () => {
        ticks++;
        return [];
      },
    },
    {
      pumpMilliseconds: 60_000,
      maxCatchUpSeconds: 1,
      now: () => now,
      afterTick: () => loop.stop(),
    },
  );
  now = 10_000;
  loop.advance();
  expect(ticks).toBe(1);
  expect(loop.tickProgress()).toBe(1);
  loop.advance();
  expect(ticks).toBe(1);
});

test("paused inspection owes no ticks even when its speed changes", () => {
  let now = 0;
  let ticks = 0;
  const loop = startSimulationLoop(
    {
      tickSeconds: 0.01,
      tick: () => {
        ticks++;
        return [];
      },
    },
    {
      pumpMilliseconds: 60_000,
      maxCatchUpSeconds: 1,
      now: () => now,
      paused: true,
    },
  );
  now = 1000;
  loop.setSpeed(2);
  now = 10_000;
  loop.advance();
  expect(ticks).toBe(0);
  loop.resume();
  loop.advance();
  expect(ticks).toBe(0);
  now += 20;
  loop.advance();
  expect(ticks).toBe(4);
  loop.stop();
});

test("stopping before a tick prevents it from running", () => {
  let now = 0;
  let ticks = 0;
  let loop: SimulationLoop;
  loop = startSimulationLoop(
    {
      tickSeconds: 0.01,
      tick: () => {
        ticks++;
        return [];
      },
    },
    {
      pumpMilliseconds: 60_000,
      maxCatchUpSeconds: 1,
      now: () => now,
      beforeTick: () => loop.stop(),
    },
  );
  now = 1000;
  loop.advance();
  expect(ticks).toBe(0);
});
