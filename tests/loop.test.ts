import { describe, expect, test } from "vitest";

import { startSimulationLoop } from "../src/simulation/loop";

import type { CommandOutcome } from "../src/simulation/command";

describe("simulation loop", () => {
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

    now = 25;
    loop.advance();
    loop.advance();

    expect(calls).toBe(1);
    expect(loop.faulted).toBe(true);
    expect(loop.fault).toBe(error);
    expect(loop.tickProgress()).toBe(1);
    expect(faults).toEqual([error]);
  });
});
