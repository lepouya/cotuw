import { createMissionState } from "./mission";
import { createTilePlacedActor } from "./placement";
import { TerrainGrid } from "./terrain";

import type { ActorDefinition } from "./actor";
import type { ActorPlacement } from "./placement";
import type { EconomyState, MaterialsSite, MaterialsLoot } from "./economy";
import type { MissionState } from "./mission";
import type { TerrainState } from "./terrain";

export type ScenarioDefinition = {
  readonly id: string;
  readonly tileSize: number;
  readonly terrainTypeIds: readonly string[];
  readonly terrain: TerrainState;
  readonly buildings: readonly ActorPlacement[];
  readonly materials: number;
  readonly sites: readonly MaterialsSite[];
  readonly loot: readonly MaterialsLoot[];
};

/** Copies and freezes authored content; each mission gets its own runtime. */
export function defineScenario(
  content: ScenarioDefinition,
): ScenarioDefinition {
  return freeze(structuredClone(content));
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
  const actors = scenario.buildings.map((placement) => {
    const definition = definitions.find(
      (definition) => definition.id === placement.definitionId,
    );
    if (!definition)
      throw new RangeError(
        `Unknown scenario building: ${placement.definitionId}.`,
      );
    return createTilePlacedActor(map, definition, placement);
  });
  const economy: EconomyState = {
    materials: scenario.materials,
    depositedMaterials: 0,
    sites: structuredClone([...scenario.sites]),
    loot: structuredClone([...scenario.loot]),
    harvesters: [],
    production: [],
  };
  return {
    ...createMissionState(actors),
    scenarioId: scenario.id,
    terrain: structuredClone(terrain),
    economy,
  };
}

const SAVE_VERSION = 1;

export function serializeMission(
  state: MissionState,
  tickSeconds: number,
): string {
  if (!state.scenarioId || !state.terrain)
    throw new RangeError("A mission save requires its scenario and terrain.");
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
        sites[index]?.initialMaterials !== site.initialMaterials ||
        JSON.stringify(sites[index]?.tile) !== JSON.stringify(site.tile),
    ) ||
    scenario.loot.some(
      (cache, index) =>
        loot[index]?.id !== cache.id ||
        loot[index]?.materials !== cache.materials ||
        JSON.stringify(loot[index]?.tile) !== JSON.stringify(cache.tile),
    )
  )
    throw new RangeError(
      "This mission save has incompatible resource content.",
    );
  return save.state;
}

function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
