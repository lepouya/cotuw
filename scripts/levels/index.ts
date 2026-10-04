import { SIMULATION_TICK_SECONDS } from "../../src/simulation/clock.ts";
import { createScenarioState } from "../../src/simulation/scenario.ts";
import { serializeMission } from "../../src/simulation/mission-file.ts";
import { BASE_CONTENT, ECONOMY_SCENARIO } from "./m0.ts";
import { SANDBOX_LEVEL } from "./sandbox.ts";

/** Level file contents by scenario ID. */
export function buildLevels(): Map<string, string> {
  return new Map([
    [
      ECONOMY_SCENARIO.id,
      serializeMission(
        ECONOMY_SCENARIO,
        createScenarioState(ECONOMY_SCENARIO, BASE_CONTENT.actors),
        SIMULATION_TICK_SECONDS,
      ),
    ],
    [
      SANDBOX_LEVEL.scenario.id,
      serializeMission(
        SANDBOX_LEVEL.scenario,
        SANDBOX_LEVEL.state,
        SIMULATION_TICK_SECONDS,
      ),
    ],
  ]);
}
