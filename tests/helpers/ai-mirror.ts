// The undisturbed Normal ARC mirror that AI planning tests continue from.
import { ARC_MIRROR_CASES } from "../../scripts/ai-match/runner";
import {
  assembleSkirmish,
  createSessionSimulation,
} from "../../src/mission-loading";

import type { CommandOutcome } from "../../src/simulation/command";
import type { AiConcern } from "../../src/simulation/director";
import type {
  MissionSimulation,
  MissionState,
} from "../../src/simulation/mission";

export const MIRROR = assembleSkirmish(
  ARC_MIRROR_CASES.find(({ id }) => id === "arc-mirror-west-normal")!.choice,
);

/** Enough ticks for one full planning round of the ARC profile. */
export const ROUND_TICKS = 3;

/** Ticks `sim`, returning every command outcome in order. */
export function runTicks(sim: MissionSimulation, ticks: number) {
  const outcomes: CommandOutcome[] = [];
  for (let tick = 0; tick < ticks; tick++) outcomes.push(...sim.tick());
  return outcomes;
}

/** Continues the mirror from `state`, optionally with other concerns. */
export const resumeMirror = (
  state: MissionState,
  concerns?: ReadonlyMap<string, AiConcern>,
) =>
  createSessionSimulation(
    { ...MIRROR, state: { ...state, terrain: state.terrain! } },
    undefined,
    concerns,
  );

/** Starts `owner`'s next planning round on the state's next tick. */
export function dueRound(state: MissionState, owner = "west") {
  const ai = state.ai[owner]!;
  ai.nextRoundTick = state.tick;
  delete ai.cursor;
  return state;
}
