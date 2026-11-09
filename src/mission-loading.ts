import { contentPack } from "./content/packs";
import {
  createSkirmishScenario,
  SKIRMISH_SCENARIO_ID,
  skirmishChoiceError,
} from "./content/skirmish";
import { errorMessage } from "./errors";
import { SIMULATION_TICK_SECONDS } from "./simulation/clock";
import { resolveSetup } from "./simulation/mission-setup";
import { createMissionSimulation } from "./simulation/mission";
import {
  checkMissionHeader,
  parseMission,
  serializeMission,
} from "./simulation/mission-file";
import { OccupancyGrid } from "./simulation/occupancy";
import { createScenarioMap, createScenarioState } from "./simulation/scenario";
import { createTerrainMoveBehavior } from "./simulation/terrain-movement";
import { isCount, isId, isRecord } from "./simulation/validation";

import type { ContentPack } from "./content/content-pack";
import type { SkirmishChoice } from "./content/skirmish";
import type { ActorDefinition } from "./simulation/actor";
import type { AiConcern } from "./simulation/director";
import type { Difficulty } from "./simulation/mission-setup";
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

/**
 * A headless simulation unless `map` supplies rendered terrain. `aiConcerns`
 * supplies the concerns the mission's AI profiles name.
 */
export function createSessionSimulation(
  mission: LoadedMission,
  map: TerrainGrid = createScenarioMap(missionTerrain(mission)),
  aiConcerns?: ReadonlyMap<string, AiConcern>,
): MissionSimulation {
  const occupancy = new OccupancyGrid(map);
  const { content } = mission;
  return createMissionSimulation({
    state: mission.state,
    objectives: mission.scenario.objectives,
    skirmish: mission.scenario.skirmish,
    setup: mission.scenario.setup,
    events: mission.scenario.events,
    emergencyHeadquarters: mission.scenario.emergencyHeadquarters,
    scriptControl: mission.scenario.scriptControl,
    ai: mission.scenario.ai?.map(({ owner, profileId }) => {
      const profile = content.aiProfiles?.find(({ id }) => id === profileId);
      if (!profile)
        throw new RangeError(
          `Content pack ${content.id} has no AI profile named "${profileId}".`,
        );
      return { owner, profile };
    }),
    aiConcerns,
    behaviorRegistry: new Map([
      [
        "terrain-move",
        createTerrainMoveBehavior(map, occupancy, content.movementProfiles),
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
  return prepareMission(parseMission(source, SIMULATION_TICK_SECONDS));
}

/** Starts a level at a difficulty, or as authored without one. */
export function loadLevel(
  source: string,
  difficulty?: Difficulty,
): LoadedMission {
  const file = parseMission(source, SIMULATION_TICK_SECONDS);
  // A level authored at this difficulty keeps its own enemy owners.
  if (!difficulty || difficulty === file.scenario.setup?.difficulty)
    return prepareMission(file);
  // The level's own owners decide who counts as an enemy.
  const setup = resolveSetup(
    difficulty,
    file.state,
    file.scenario.setup?.factions,
  );
  return prepareMission({ ...file, scenario: { ...file.scenario, setup } });
}

/** Resolves launch choices into a tick-0 mission file and loads it. */
export function assembleSkirmish(choice: SkirmishChoice): LoadedMission {
  const scenario = createSkirmishScenario(choice);
  const pack = contentPack(scenario.content!);
  return loadMission(
    serializeMission(
      scenario,
      createScenarioState(scenario, pack.actors),
      SIMULATION_TICK_SECONDS,
    ),
  );
}

/** Registered levels take precedence over built-in setup reconstruction. */
export function missionRestart(
  { scenario, state }: MissionFile,
  levelSource?: string,
): (() => LoadedMission) | undefined {
  const { setup } = scenario;
  if (levelSource !== undefined)
    return () => loadLevel(levelSource, setup?.difficulty);
  if (scenario.id === SKIRMISH_SCENARIO_ID && setup?.factions) {
    const choice = {
      factions: setup.factions,
      playerSlot: state.playerOwner,
      difficulty: setup.difficulty,
      ai: scenario.ai,
    };
    if (!skirmishChoiceError(choice)) return () => assembleSkirmish(choice);
  }
}

function prepareMission(file: MissionFile): LoadedMission {
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
