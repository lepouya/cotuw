import { createMissionState } from "../../src/simulation/mission.ts";
import { TerrainGrid } from "../../src/simulation/terrain.ts";
import { actorDefinition, BASE_CONTENT } from "./base-content.ts";

import type {
  MissionFile,
  MissionScenario,
  ScenarioBriefing,
} from "../../src/simulation/mission-file.ts";
import type { TerrainGridOptions } from "../../src/simulation/terrain.ts";

type SandboxOptions = Pick<
  MissionScenario,
  "id" | "name" | "goals" | "content" | "actors" | "savePolicy"
> & {
  terrain: TerrainGridOptions;
  briefing: Omit<ScenarioBriefing, "rules">;
};

const DEFAULT_BUILDINGS = [
  "arc-command-center-prototype",
  "arc-field-barracks",
];
const DEFAULT_ACTORS = [
  ...new Set(
    DEFAULT_BUILDINGS.flatMap(
      (id) => actorDefinition(id).production?.unitDefinitionIds ?? [],
    ),
  ),
  ...DEFAULT_BUILDINGS,
];

/** Free construction on authored terrain, with ARC content by default. */
export function createSandboxLevel({
  terrain,
  briefing,
  content = BASE_CONTENT,
  actors = DEFAULT_ACTORS,
  ...scenario
}: SandboxOptions): MissionFile {
  const map = new TerrainGrid(terrain);
  return {
    scenario: {
      ...scenario,
      content: { id: content.id, version: content.version },
      actors: [...actors],
      tileSize: map.tileSize,
      terrainTypeIds: [...map.terrainTypeIds],
      briefing: {
        ...briefing,
        rules:
          "Instant construction & training · No resource or power requirements",
      },
    },
    state: {
      ...createMissionState([]),
      scenarioId: scenario.id,
      terrain: map.terrainState(),
    },
  };
}
