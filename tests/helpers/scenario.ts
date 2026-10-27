import { expect } from "vitest";
import { createScenarioState } from "../../src/simulation/scenario";
import type {
  MissionSimulation,
  MissionState,
} from "../../src/simulation/mission";

/** The player owns one faction's actors; wolves belong to hostile wildlife. */
export function playerOwners(faction: string) {
  return {
    owners: [
      { id: "player", faction },
      { id: "wildlife", faction: "wildlife" },
    ],
    playerOwner: "player",
    relationships: [
      {
        owners: ["player", "wildlife"] as [string, string],
        relationship: "hostile" as const,
      },
    ],
  };
}

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

export function advanceSeconds(sim: MissionSimulation, seconds: number) {
  for (let tick = 0; tick < Math.round(seconds / sim.tickSeconds); tick++)
    sim.tick();
}

/** Ticks until `predicate` holds, failing after `seconds` of mission time. */
export function untilSeconds(
  sim: MissionSimulation,
  predicate: () => boolean,
  seconds = 300,
) {
  for (let tick = 0; tick < seconds / sim.tickSeconds && !predicate(); tick++)
    sim.tick();
  expect(predicate()).toBe(true);
}
