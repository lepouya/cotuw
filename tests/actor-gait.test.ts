import { describe, expect, test } from "vitest";

import { createGaitState, stepGait } from "../src/render/actor-gait";

import type { ActorMotion } from "../src/render/actor-gait";

function motion(distance: number, turn: number, seconds: number): ActorMotion {
  return { distance, turn, seconds };
}

describe("stepGait", () => {
  test("advances the locomotion cycle by ground distance", () => {
    const gait = createGaitState();

    stepGait(gait, motion(1, 0, 0.1), 2);
    expect(gait.cycle).toBeCloseTo(0.5);

    stepGait(gait, motion(1.5, 0, 0.1), 2);
    expect(gait.cycle).toBeCloseTo(0.25);
  });

  test("blends the same at any frame rate", () => {
    const once = createGaitState();
    const split = createGaitState();

    stepGait(once, motion(0.4, 0.2, 0.1), 2);
    for (let frame = 0; frame < 10; frame++) {
      stepGait(split, motion(0.04, 0.02, 0.01), 2);
    }

    expect(split.cycle).toBeCloseTo(once.cycle, 9);
    expect(split.locomotion).toBeCloseTo(once.locomotion, 9);
    expect(split.lean).toBeCloseTo(once.lean, 9);
  });

  test("leans toward the turn and settles back to idle", () => {
    const gait = createGaitState();

    stepGait(gait, motion(0.2, -0.2, 0.1), 2);
    expect(gait.lean).toBeLessThan(0);
    expect(gait.locomotion).toBeGreaterThan(0);

    for (let frame = 0; frame < 100; frame++) {
      stepGait(gait, motion(0, 0, 0.1), 2);
    }
    expect(gait.lean).toBeCloseTo(0);
    expect(gait.locomotion).toBeCloseTo(0);
  });

  test("ignores a frame without elapsed time", () => {
    const gait = createGaitState();

    stepGait(gait, motion(1, 1, 0), 2);

    expect(gait).toEqual(createGaitState());
  });
});
