// Runs inside the page under test, like `harness.ts`, to build mission files.
import { LEVEL_SOURCES } from "../src/content/levels";
import { SIMULATION_TICK_SECONDS } from "../src/simulation/clock";
import {
  createSessionSimulation,
  loadMission,
  missionTerrain,
} from "../src/mission-loading";
import { createScenarioMap } from "../src/simulation/scenario";
import { serializeMission } from "../src/simulation/mission-file";
import { createTilePlacedActor } from "../src/simulation/placement";

import type { LoadedMission } from "../src/mission-loading";
import type { MissionState } from "../src/simulation/mission";
import type { ActorPlacement } from "../src/simulation/placement";
import type { SaveInfo } from "../src/simulation/mission-file";

/** A fresh copy of a bundled level. */
export const level = (id = "arc-economy-opening") =>
  loadMission(LEVEL_SOURCES.get(id)!);

export const missionMap = (mission: LoadedMission) =>
  createScenarioMap(missionTerrain(mission));

/** Adds buildings after the authored ones, as if the level placed them. */
export function placeBuildings(
  mission: LoadedMission,
  placements: readonly (ActorPlacement & { owner?: string })[],
): void {
  const map = missionMap(mission);
  const { actors } = mission.state;
  const firstUnit = actors.findIndex((actor) => !actor.tilePlacement);
  actors.splice(
    firstUnit < 0 ? actors.length : firstUnit,
    0,
    ...placements.map(({ owner = "player", ...placement }) =>
      createTilePlacedActor(
        map,
        mission.definitions.find(({ id }) => id === placement.definitionId)!,
        placement,
        owner,
      ),
    ),
  );
}

/** A simulation of another state of the mission, outside any session. */
export function simulateMission(
  mission: LoadedMission,
  state: MissionState = mission.state,
) {
  const next = { ...mission, state: state as LoadedMission["state"] };
  return createSessionSimulation(next);
}

const INTRODUCTORY_POPUPS = ["command-basics", "barracks-training", "scouting"];

export const missionSource = (
  mission: LoadedMission,
  state: MissionState = mission.state,
  save?: SaveInfo,
) =>
  serializeMission(
    mission.scenario,
    {
      ...state,
      // Scripted saves focus on their scenario rather than introductory guides.
      dismissedPopups: [
        ...new Set([
          ...(state.dismissedPopups ?? []),
          ...INTRODUCTORY_POPUPS.filter((id) =>
            mission.scenario.popups?.some((popup) => popup.id === id),
          ),
        ]),
      ],
    },
    SIMULATION_TICK_SECONDS,
    save,
  );
