import { SIMULATION_TICK_SECONDS } from "../../src/simulation/clock.ts";
import { createScenarioState } from "../../src/simulation/scenario.ts";
import { serializeMission } from "../../src/simulation/mission-file.ts";
import { BASE_CONTENT, ECONOMY_SCENARIO } from "./m0.ts";
import { SANDBOX_LEVEL } from "./sandbox.ts";
import { SKIRMISH_PREVIEW } from "./skirmish-preview.ts";

import type { MissionState } from "../../src/simulation/mission.ts";
import type { MissionScenario } from "../../src/simulation/mission-file.ts";

/** Level file contents by scenario ID. */
export function buildLevels(): Map<string, string> {
  const levels: { scenario: MissionScenario; state: MissionState }[] = [
    {
      scenario: ECONOMY_SCENARIO,
      state: createScenarioState(ECONOMY_SCENARIO, BASE_CONTENT.actors),
    },
    SANDBOX_LEVEL,
    SKIRMISH_PREVIEW,
  ];
  return new Map(
    levels.map(({ scenario, state }) => [
      scenario.id,
      serializeMission(scenario, state, SIMULATION_TICK_SECONDS),
    ]),
  );
}
