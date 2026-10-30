import { contentPack } from "./content/packs";
import { errorMessage } from "./errors";
import { SIMULATION_TICK_SECONDS } from "./simulation/clock";
import { createMissionSimulation } from "./simulation/mission";
import { checkMissionHeader, parseMission } from "./simulation/mission-file";
import { OccupancyGrid } from "./simulation/occupancy";
import { createScenarioMap } from "./simulation/scenario";
import { createTerrainMoveBehavior } from "./simulation/terrain-movement";
import { isCount, isId, isRecord } from "./simulation/validation";

import type { ContentPack } from "./content/content-pack";
import type { ActorDefinition } from "./simulation/actor";
import type { MissionSimulation } from "./simulation/mission";
import type { MissionFile } from "./simulation/mission-file";
import type { ScenarioTerrain } from "./simulation/scenario";
import type { TerrainGrid } from "./simulation/terrain";

/** A parsed mission file with the content pack and definitions it uses. */
export type LoadedMission = MissionFile & {
  content: ContentPack;
  definitions: readonly ActorDefinition[];
};

/** Scenario layout with the mission's current, possibly saved, terrain. */
export const missionTerrain = (mission: MissionFile): ScenarioTerrain => ({
  ...mission.scenario,
  terrain: mission.state.terrain,
});

/** A headless simulation unless `map` supplies rendered terrain. */
export function createSessionSimulation(
  mission: LoadedMission,
  map: TerrainGrid = createScenarioMap(missionTerrain(mission)),
): MissionSimulation {
  const occupancy = new OccupancyGrid(map);
  return createMissionSimulation({
    state: mission.state,
    objectives: mission.scenario.objectives,
    events: mission.scenario.events,
    emergencyHeadquarters: mission.scenario.emergencyHeadquarters,
    scriptControl: mission.scenario.scriptControl,
    behaviorRegistry: new Map([
      [
        "terrain-move",
        createTerrainMoveBehavior(
          map,
          occupancy,
          mission.content.movementProfiles,
        ),
      ],
      ["idle", { handleCommand: () => false, update: () => {} }],
    ]),
    bounds: map.worldBounds,
    definitions: mission.definitions,
    tickSeconds: SIMULATION_TICK_SECONDS,
    map,
    occupancy,
  });
}

/**
 * Why this build cannot load a parsed mission file, from the format, tick
 * rate, and content pack checks loading applies. Contents are not validated.
 */
export function missionIncompatibility(file: unknown): string | undefined {
  try {
    checkMissionHeader(file, SIMULATION_TICK_SECONDS);
    const scenario = isRecord(file) ? file.scenario : undefined;
    const content = isRecord(scenario) && scenario.content;
    if (isRecord(content) && isId(content.id) && isCount(content.version))
      contentPack({ id: content.id, version: content.version });
  } catch (error) {
    return errorMessage(error);
  }
}

/** Parses a level or save, rejecting state the simulation would refuse. */
export function loadMission(source: string): LoadedMission {
  const file = parseMission(source, SIMULATION_TICK_SECONDS);
  if (!file.scenario.content)
    throw new RangeError("This mission file names no content pack.");
  const content = contentPack(file.scenario.content);
  const wanted = file.scenario.actors;
  const definitions = wanted
    ? wanted.map((id) => {
        const definition = content.actors.find((actor) => actor.id === id);
        if (!definition)
          throw new RangeError(
            `Content pack ${content.id} has no actor named "${id}".`,
          );
        return definition;
      })
    : content.actors;
  const mission = { ...file, content, definitions };
  const requireActor = (use: string, definitionId: string) => {
    const definition = definitions.find(({ id }) => id === definitionId);
    if (!definition)
      throw new RangeError(
        `Scenario ${use} uses unknown actor "${definitionId}".`,
      );
    return definition;
  };
  for (const goal of file.scenario.goals ?? [])
    requireActor("goal", goal.definitionId);
  for (const { trigger } of file.scenario.popups ?? []) {
    const definition = requireActor("popup", trigger.definitionId);
    if (trigger.kind === "placement" && !definition.footprint)
      throw new RangeError("Placement popups require a building definition.");
  }
  createSessionSimulation(mission).dispose();
  return mission;
}
