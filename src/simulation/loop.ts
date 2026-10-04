import { createFixedStepClock } from "./clock";

import type { CommandOutcome } from "./command";
import type { MissionSimulation } from "./mission";

export type SimulationLoopOptions = {
  /** How often the timer wakes the clock. It does not set the tick rate. */
  pumpMilliseconds: number;
  /** Longer stalls drop time rather than freeze the page replaying it. */
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
  /** Runs the ticks real time owes now, such as right before a render. */
  advance: () => void;
  /** How far real time is into the next tick, from 0 to 1. */
  tickProgress: () => number;
  pause: () => void;
  stop: () => void;
  resume: () => void;
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
  const newClock = () =>
    createFixedStepClock({
      tickSeconds: simulation.tickSeconds,
      startMilliseconds: now(),
      maxCatchUpTicks: Math.max(
        Math.ceil(maxCatchUpSeconds / simulation.tickSeconds),
        1,
      ),
    });
  let clock = newClock();
  let fault: unknown;
  let faulted = false;
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  const stop = () => {
    stopped = true;
    if (timer !== undefined) {
      clearInterval(timer);
    }
  };
  const advance = () => {
    if (stopped || paused) {
      return;
    }
    try {
      for (let ticks = clock.ticksDue(now()); ticks > 0; ticks -= 1) {
        if (stopped || paused) break;
        beforeTick?.();
        if (stopped || paused) break;
        const outcomes = simulation.tick();
        afterTick?.(outcomes);
      }
    } catch (error) {
      faulted = true;
      fault = error;
      stop();
      onFault?.(error);
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
    tickProgress: () => (stopped || paused ? 1 : clock.tickProgress(now())),
    pause: () => {
      paused = true;
    },
    resume: () => {
      if (!paused || stopped) return;
      clock = newClock();
      paused = false;
    },
    stop,
  };
}
