import { currentContentPack } from "../../src/content/packs.ts";
import { createMissionState } from "../../src/simulation/mission.ts";
import { TerrainGrid } from "../../src/simulation/terrain.ts";

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

/** Free construction on authored terrain, with ARC content by default. */
export function createSandboxLevel({
  terrain,
  briefing,
  content = currentContentPack("base"),
  actors = [
    "arc-trooper",
    "arc-scout",
    "arc-command-center-prototype",
    "arc-field-barracks",
  ],
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
