import { createScenarioState } from "../../src/simulation/scenario";
import type { MissionState } from "../../src/simulation/mission";

/** Starts fully explored, so fog does not limit placement in these tests. */
export function exploredScenarioState(
  ...args: Parameters<typeof createScenarioState>
): MissionState {
  const state = createScenarioState(...args);
  return {
    ...state,
    fog: { explored: "1".repeat(state.fog!.explored.length) },
  };
}
