import { createFixedStepClock } from "./clock";
import { isPositive } from "./validation";

import type { CommandOutcome } from "./command";
import type { MissionSimulation } from "./mission";

export type SimulationLoopOptions = {
  /** How often the timer wakes the clock. It does not set the tick rate. */
  pumpMilliseconds: number;
  /** Bounds each advance call; excess ticks remain owed. */
  maxCatchUpSeconds: number;
  /** Runs before each tick, while the state still shows the previous tick. */
  beforeTick?: () => void;
  afterTick?: (outcomes: CommandOutcome[]) => void;
  /** Receives the first error and leaves the loop stopped on valid state. */
  onFault?: (error: unknown) => void;
  /** A monotonic millisecond clock. */
  now?: () => number;
  paused?: boolean;
};

export type SimulationLoop = {
  /** Whether a tick or hook fault stopped the loop. */
  readonly faulted: boolean;
  /** The error that stopped the loop, if a tick or hook failed. */
  readonly fault: unknown | undefined;
  /** Runs a bounded batch of owed ticks, such as right before a render. */
  advance: () => void;
  /** Interpolation toward the next tick; 1 while halted or catching up. */
  tickProgress: () => number;
  pause: () => void;
  stop: () => void;
  resume: () => void;
  /** Simulated seconds per real second. */
  readonly speed: number;
  /** Changes the rate while preserving owed whole and fractional ticks. */
  setSpeed: (speed: number) => void;
};

/**
 * Ticks a simulation in real time. Late or merged timer callbacks cost no
 * simulated time, because the clock counts the ticks real time owes.
 */
export function startSimulationLoop(
  simulation: Pick<MissionSimulation, "tick" | "tickSeconds">,
  {
    pumpMilliseconds,
    maxCatchUpSeconds,
    beforeTick,
    afterTick,
    onFault,
    now = () => performance.now(),
    paused = false,
  }: SimulationLoopOptions,
): SimulationLoop {
  if (!isPositive(pumpMilliseconds) || !isPositive(maxCatchUpSeconds))
    throw new RangeError(
      "Simulation pump and catch-up intervals must be positive and finite.",
    );
  let speed = 1;
  const newClock = (rate = speed, pendingTicks = 0, at = now()) => {
    const tickSeconds = simulation.tickSeconds / rate;
    return createFixedStepClock({
      tickSeconds,
      startMilliseconds: at - pendingTicks * tickSeconds * 1000,
      maxCatchUpTicks: Math.max(Math.ceil(maxCatchUpSeconds / tickSeconds), 1),
    });
  };
  let clock = newClock();
  let fault: unknown;
  let faulted = false;
  let stopped = false;
  let advancing = false;
  let pauseGeneration = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  const stop = () => {
    stopped = true;
    if (timer !== undefined) {
      clearInterval(timer);
    }
  };
  const fail = (error: unknown) => {
    if (faulted) return;
    faulted = true;
    fault = error;
    stop();
    onFault?.(error);
  };
  const readClock = <T>(read: (at: number) => T): T | undefined => {
    if (faulted) return;
    try {
      return read(now());
    } catch (error) {
      fail(error);
      return;
    }
  };
  const advance = () => {
    if (stopped || paused || advancing) {
      return;
    }
    advancing = true;
    const generation = pauseGeneration;
    try {
      for (let ticks = clock.ticksDue(now()); ticks > 0; ticks -= 1) {
        if (stopped || paused || generation !== pauseGeneration) break;
        beforeTick?.();
        if (stopped || paused || generation !== pauseGeneration) break;
        const outcomes = simulation.tick();
        afterTick?.(outcomes);
      }
    } catch (error) {
      fail(error);
    } finally {
      advancing = false;
    }
  };
  timer = setInterval(advance, pumpMilliseconds);

  return {
    get faulted() {
      return faulted;
    },
    get fault() {
      return fault;
    },
    advance,
    tickProgress: () =>
      stopped || paused ? 1 : (readClock(clock.tickProgress) ?? 1),
    pause: () => {
      if (!paused) pauseGeneration++;
      paused = true;
    },
    resume: () => {
      if (!paused || stopped) return;
      const nextClock = readClock((at) => newClock(speed, 0, at));
      if (!nextClock) return;
      clock = nextClock;
      paused = false;
    },
    get speed() {
      return speed;
    },
    setSpeed: (next) => {
      if (!isPositive(next))
        throw new RangeError("Simulation speed must be positive and finite.");
      if (next === speed) return;
      // Owed ticks are counted in ticks, so they carry over unchanged.
      const nextClock = readClock((at) =>
        newClock(next, clock.pendingTicks(at), at),
      );
      if (!nextClock) return;
      clock = nextClock;
      speed = next;
    },
    stop,
  };
}
