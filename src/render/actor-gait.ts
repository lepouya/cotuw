// Speeds and rates are per real second, so the blend is frame-rate independent.
/** Walking fully replaces idle at this ground speed. */
const FULL_LOCOMOTION_SPEED = 2;
/** Turning at this many radians per second leans fully. */
const FULL_LEAN_TURN_RATE = Math.PI;
/** How quickly each weight closes on its target, per second. */
const LOCOMOTION_RESPONSE = 12;
const LEAN_RESPONSE = 10;

/** How an actor's rendered pose moved since the previous frame. */
export type ActorMotion = {
  /** Ground distance covered. */
  distance: number;
  /** Signed facing change in radians, clockwise positive. */
  turn: number;
  /** Real time elapsed. */
  seconds: number;
};

/** Render-only animation blend state for one actor. */
export type GaitState = {
  /** Progress through the locomotion clip, from 0 to 1. */
  cycle: number;
  /** Locomotion weight against idle, from 0 to 1. */
  locomotion: number;
  /** From -1 for a full left lean to 1 for a full right lean. */
  lean: number;
};

export function createGaitState(): GaitState {
  return { cycle: 0, locomotion: 0, lean: 0 };
}

/**
 * Advances `state` by one frame of motion. The locomotion cycle tracks ground
 * distance, so feet stay planted at any speed.
 */
export function stepGait(
  state: GaitState,
  { distance, turn, seconds }: Readonly<ActorMotion>,
  cycleDistance: number,
): void {
  if (seconds <= 0) {
    return;
  }
  state.cycle = (state.cycle + distance / cycleDistance) % 1;
  state.locomotion = approach(
    state.locomotion,
    clamp(distance / seconds / FULL_LOCOMOTION_SPEED, 0, 1),
    LOCOMOTION_RESPONSE * seconds,
  );
  state.lean = approach(
    state.lean,
    clamp(turn / seconds / FULL_LEAN_TURN_RATE, -1, 1),
    LEAN_RESPONSE * seconds,
  );
}

function approach(value: number, target: number, rate: number): number {
  return value + (target - value) * (1 - Math.exp(-rate));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
