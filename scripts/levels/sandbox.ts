// The construction sandbox: the opening's terrain with no actors or economy.
import { TerrainGrid } from "../../src/simulation/terrain.ts";
import { createMissionState } from "../../src/simulation/mission.ts";
import { PROTOTYPE_TERRAIN } from "./m0-terrain.ts";
import { BASE_CONTENT } from "./m0.ts";

import type { MissionFile } from "../../src/simulation/mission-file.ts";

const map = new TerrainGrid(PROTOTYPE_TERRAIN);

export const SANDBOX_LEVEL: MissionFile = {
  scenario: {
    id: "sandbox",
    content: { id: BASE_CONTENT.id, version: BASE_CONTENT.version },
    // Free construction leaves out the Materials economy.
    actors: [
      "arc-trooper",
      "arc-scout",
      "arc-command-center-prototype",
      "arc-field-barracks",
    ],
    name: "Build & explore",
    tileSize: map.tileSize,
    terrainTypeIds: [...map.terrainTypeIds],
    briefing: {
      label: "Base & infantry sandbox",
      title: "Build & explore",
      description:
        "Practice construction and training. This sandbox has no victory or defeat condition.",
      goalsHeading: "Construction & training",
      goalsNote: "Counts show buildings and units currently in the field.",
      rules:
        "Instant construction & training · No resource or power requirements",
    },
    goals: [
      {
        definitionId: "arc-command-center-prototype",
        label: "Place a Command Center",
      },
      { definitionId: "arc-field-barracks", label: "Build a Field Barracks" },
      { definitionId: "arc-trooper", label: "Train a Trooper" },
      { definitionId: "arc-scout", label: "Train a Scout" },
    ],
  },
  state: {
    ...createMissionState([]),
    scenarioId: "sandbox",
    terrain: map.terrainState(),
  },
};
