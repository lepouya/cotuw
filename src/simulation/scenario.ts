import { createActor, deepFreeze } from "./actor";
import { createMissionState } from "./mission";
import { createTilePlacedActor } from "./placement";
import { TerrainGrid } from "./terrain";
import { createFogState } from "./vision";
import { createHarvesterState } from "./economy";
import { createTerritoryState } from "./territory";
import { createObjectiveStates } from "./objectives";
import type { MissionScenario } from "./mission-file";

import type { TerritoryAssignment } from "./territory";
import type { ActorDefinition } from "./actor";
import type { ActorPlacement } from "./placement";
import type { EconomyState, MaterialsSite, MaterialsLoot } from "./economy";
import type { MissionState } from "./mission";
import type { TerrainGridOptions, TerrainState } from "./terrain";
import type { TileCoord } from "./grid";

/** A mobile actor that starts at a tile's center. */
export type ScenarioUnit = {
  actorId: string;
  definitionId: string;
  tile: TileCoord;
  facing?: number;
  territory?: TerritoryAssignment;
};

/** Authoring input for a level's opening state. */
export type ScenarioDefinition = MissionScenario & {
  readonly terrain: TerrainState;
  /** The faction the player controls and whose vision the fog records. */
  readonly playerFaction: string;
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

/** Terrain content shared by scenario definitions and mission files. */
export type ScenarioTerrain = Pick<
  MissionScenario,
  "tileSize" | "terrainTypeIds"
> & { readonly terrain: TerrainState };

/** The factory can add presentation without introducing renderer dependencies. */
export function createScenarioMap(scenario: ScenarioTerrain): TerrainGrid;
export function createScenarioMap<T extends TerrainGrid>(
  scenario: ScenarioTerrain,
  createMap: (options: TerrainGridOptions) => T,
): T;
export function createScenarioMap(
  scenario: ScenarioTerrain,
  createMap: (options: TerrainGridOptions) => TerrainGrid = (options) =>
    new TerrainGrid(options),
): TerrainGrid {
  const { terrain } = scenario;
  const map = createMap({
    width: terrain.width,
    height: terrain.height,
    tileSize: scenario.tileSize,
    terrainTypeIds: scenario.terrainTypeIds,
    createHeight: (x, z) => terrain.heights[z * (terrain.width + 1) + x],
    createTerrain: (x, z) => terrain.tiles[z * terrain.width + x],
  });
  map.restoreTerrainState(terrain);
  return map;
}

export function createScenarioState(
  scenario: ScenarioDefinition,
  definitions: readonly ActorDefinition[],
): MissionState {
  const terrain = scenario.terrain;
  const map = createScenarioMap(scenario);
  const definitionsById = new Map(
    definitions.map((definition) => [definition.id, definition]),
  );
  const definitionFor = (id: string) => {
    const definition = definitionsById.get(id);
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
