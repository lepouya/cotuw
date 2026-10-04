import { createActor, deepFreeze } from "./actor";
import { createMissionState } from "./mission";
import { createTilePlacedActor } from "./placement";
import { TerrainGrid } from "./terrain";
import { createFogState } from "./vision";
import { createHarvesterState } from "./economy";
import { createTerritoryState } from "./territory";
import { createObjectiveStates } from "./objectives";
import type { ObjectiveDefinition } from "./objectives";

import type { TerritoryAssignment } from "./territory";
import type { ActorDefinition } from "./actor";
import type { ActorPlacement } from "./placement";
import type { EconomyState, MaterialsSite, MaterialsLoot } from "./economy";
import type { MissionState } from "./mission";
import type { TerrainState } from "./terrain";
import type { TileCoord } from "./grid";

/** A mobile actor that starts at a tile's center. */
export type ScenarioUnit = {
  actorId: string;
  definitionId: string;
  tile: TileCoord;
  facing?: number;
  territory?: TerritoryAssignment;
};

export type ScenarioDefinition = {
  readonly id: string;
  readonly tileSize: number;
  readonly terrainTypeIds: readonly string[];
  readonly terrain: TerrainState;
  /** The faction the player controls and whose vision the fog records. */
  readonly playerFaction: string;
  readonly objectives?: readonly ObjectiveDefinition[];
  readonly buildings: readonly ActorPlacement[];
  /** Territorial units default to their starting position as home. */
  readonly units?: readonly ScenarioUnit[];
  readonly materials: number;
  readonly sites: readonly MaterialsSite[];
  readonly loot: readonly MaterialsLoot[];
};

/** Copies and freezes authored content; each mission gets its own runtime. */
export function defineScenario(
  content: ScenarioDefinition,
): ScenarioDefinition {
  return deepFreeze(structuredClone(content));
}

export function createScenarioState(
  scenario: ScenarioDefinition,
  definitions: readonly ActorDefinition[],
): MissionState {
  const terrain = scenario.terrain;
  const map = new TerrainGrid({
    width: terrain.width,
    height: terrain.height,
    tileSize: scenario.tileSize,
    terrainTypeIds: scenario.terrainTypeIds,
  });
  map.restoreTerrainState(terrain);
  const definitionFor = (id: string) => {
    const definition = definitions.find((definition) => definition.id === id);
    if (!definition) throw new RangeError(`Unknown scenario actor: ${id}.`);
    return definition;
  };
  const buildings = scenario.buildings.map((placement) =>
    createTilePlacedActor(
      map,
      definitionFor(placement.definitionId),
      placement,
    ),
  );
  const units = (scenario.units ?? []).map((unit) => {
    const worldPosition = map.tileCenter(unit.tile.x, unit.tile.z);
    const actor = createActor({
      id: unit.actorId,
      definitionId: unit.definitionId,
      worldPosition,
      facing: unit.facing,
    });
    if (definitionFor(unit.definitionId).territory)
      actor.territory = createTerritoryState(worldPosition, unit.territory);
    return actor;
  });
  const actors = [...buildings, ...units];
  const economy: EconomyState = {
    materials: scenario.materials,
    depositedMaterials: 0,
    sites: structuredClone([...scenario.sites]),
    loot: structuredClone([...scenario.loot]),
    harvesters: units
      .filter((actor) => definitionFor(actor.definitionId).harvesting)
      .map((actor) => createHarvesterState(actor.id)),
    production: [],
  };
  return {
    ...createMissionState(actors),
    objectives: createObjectiveStates(scenario.objectives ?? []),
    scenarioId: scenario.id,
    playerFaction: scenario.playerFaction,
    terrain: structuredClone(terrain),
    economy,
    fog: createFogState(terrain.width, terrain.height),
  };
}

const SAVE_VERSION = 7;

export function serializeMission(
  state: MissionState,
  tickSeconds: number,
): string {
  if (!state.scenarioId || !state.terrain)
    throw new RangeError("A mission save requires its scenario and terrain.");
  if (state.fog === undefined)
    throw new RangeError("A mission save requires explored terrain.");
  return JSON.stringify({
    version: SAVE_VERSION,
    scenarioId: state.scenarioId,
    tickSeconds,
    state,
  });
}

/** Simulation initialization validates the returned authoritative state. */
export function deserializeMission(
  source: string,
  scenario: ScenarioDefinition,
  tickSeconds: number,
): MissionState {
  const save = JSON.parse(source);
  if (!save || save.version !== SAVE_VERSION)
    throw new RangeError("This mission save uses an unsupported version.");
  if (save.scenarioId !== scenario.id || save.state?.scenarioId !== scenario.id)
    throw new RangeError("This mission save belongs to a different scenario.");
  if (save.state.playerFaction !== scenario.playerFaction)
    throw new RangeError(
      "This mission save has an incompatible player faction.",
    );
  if (save.state.fog === undefined)
    throw new RangeError("A mission save requires explored terrain.");
  if (
    save.tickSeconds !== tickSeconds ||
    !save.state.terrain ||
    save.state.terrain.width !== scenario.terrain.width ||
    save.state.terrain.height !== scenario.terrain.height
  )
    throw new RangeError(
      "This mission save has incompatible simulation settings.",
    );
  const sites = save.state.economy?.sites;
  const loot = save.state.economy?.loot;
  if (
    !Array.isArray(sites) ||
    !Array.isArray(loot) ||
    sites.length !== scenario.sites.length ||
    loot.length !== scenario.loot.length ||
    scenario.sites.some(
      (site, index) =>
        sites[index]?.id !== site.id ||
        sites[index]?.name !== site.name ||
        sites[index]?.initialMaterials !== site.initialMaterials ||
        sites[index]?.tile?.x !== site.tile.x ||
        sites[index]?.tile?.z !== site.tile.z,
    ) ||
    scenario.loot.some(
      (cache, index) =>
        loot[index]?.id !== cache.id ||
        loot[index]?.name !== cache.name ||
        loot[index]?.materials !== cache.materials ||
        loot[index]?.tile?.x !== cache.tile.x ||
        loot[index]?.tile?.z !== cache.tile.z,
    )
  )
    throw new RangeError(
      "This mission save has incompatible resource content.",
    );
  return save.state;
}
