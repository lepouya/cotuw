import { createActor, deepFreeze } from "./actor";
import { createMissionState } from "./mission";
import { createTilePlacedActor } from "./placement";
import { TerrainGrid } from "./terrain";
import { createFogState } from "./vision";
import { enrollWorker } from "./economy";
import { isValidLedger, regroupStockpiles } from "./stockpiles";
import { createRelations } from "./ownership";
import { assignInfrastructure } from "./infrastructure";
import { createSupportNetwork } from "./support";
import { createTerritoryState } from "./territory";
import { createObjectiveStates } from "./objectives";
import type { MissionScenario } from "./mission-file";

import type { CultivationState } from "./cultivation";
import type { TerritoryAssignment } from "./territory";
import type { ActorDefinition } from "./actor";
import type { ActorPlacement } from "./placement";
import type { EconomyState, MaterialsSite, ResourceLoot } from "./economy";
import type { Stockpile } from "./stockpiles";
import type { MissionState } from "./mission";
import type { Owner, OwnerRelationship } from "./ownership";
import type { TerrainGridOptions, TerrainState } from "./terrain";
import type { TileCoord } from "./grid";

/** A mobile actor that starts at a tile's center. */
export type ScenarioUnit = {
  actorId: string;
  definitionId: string;
  /** Defaults to the first owner playing the definition's faction. */
  owner?: string;
  tile: TileCoord;
  facing?: number;
  territory?: TerritoryAssignment;
};

/** Authoring input for a level's opening state. */
export type ScenarioDefinition = MissionScenario & {
  readonly terrain: TerrainState;
  readonly owners: readonly Owner[];
  /** The owner the player controls and whose vision the fog records. */
  readonly playerOwner: string;
  /** Starting allied and hostile pairs; other pairs start neutral. */
  readonly relationships?: readonly OwnerRelationship[];
  /** Owners default as they do for units. */
  readonly buildings: readonly (ActorPlacement & { owner?: string })[];
  /** Territorial units default to their starting position as home. */
  readonly units?: readonly ScenarioUnit[];
} & (
    | {
        readonly stockpiles: readonly Stockpile[];
        /** Worker states derive from the scenario's units. */
        readonly cultivation?: Pick<CultivationState, "sites">;
        readonly sites: readonly MaterialsSite[];
        readonly loot: readonly ResourceLoot[];
      }
    | {
        readonly stockpiles?: never;
        readonly cultivation?: never;
        readonly sites?: never;
        readonly loot?: never;
      }
  );

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
  const ownerFor = (authored: {
    actorId: string;
    definitionId: string;
    owner?: string;
  }) => {
    const faction = definitionFor(authored.definitionId).faction;
    const owner =
      authored.owner ??
      scenario.owners.find((owner) => owner.faction === faction)?.id;
    if (owner === undefined)
      throw new RangeError(`Scenario actor ${authored.actorId} has no owner.`);
    return owner;
  };
  const buildings = scenario.buildings.map((placement) =>
    createTilePlacedActor(
      map,
      definitionFor(placement.definitionId),
      placement,
      ownerFor(placement),
    ),
  );
  const units = (scenario.units ?? []).map((unit) => {
    const worldPosition = map.tileCenter(unit.tile.x, unit.tile.z);
    const actor = createActor({
      id: unit.actorId,
      definitionId: unit.definitionId,
      owner: ownerFor(unit),
      worldPosition,
      facing: unit.facing,
    });
    if (definitionFor(unit.definitionId).territory)
      actor.territory = createTerritoryState(worldPosition, unit.territory);
    return actor;
  });
  const actors = [...buildings, ...units];
  const economy: EconomyState | undefined =
    scenario.stockpiles === undefined
      ? undefined
      : {
          stockpiles: structuredClone([...scenario.stockpiles]),
          deposited: [],
          sites: structuredClone([...scenario.sites]),
          loot: structuredClone([...scenario.loot]),
          harvesters: [],
          production: [],
          ...(scenario.cultivation && {
            cultivation: {
              sites: structuredClone([...scenario.cultivation.sites]),
              workers: [],
            },
          }),
        };
  for (const actor of units)
    if (economy)
      enrollWorker(economy, actor.id, definitionFor(actor.definitionId));
  // Owners that start sharing resources start with pooled stockpiles.
  if (economy) {
    const owners = new Set(scenario.owners.map(({ id }) => id));
    if (!isValidLedger(economy, owners))
      throw new RangeError("Scenario has invalid stockpiles.");
    const relations = createRelations(scenario.relationships ?? []);
    regroupStockpiles(economy, owners, relations.sharesResources);
    assignInfrastructure(actors, {
      definitions: definitionsById,
      sharesHeadquarters: relations.sharesHeadquarters,
      emergencyHeadquarters: scenario.emergencyHeadquarters,
      support: createSupportNetwork(
        actors,
        definitionsById,
        relations.sharesSupport,
      ),
    });
  }
  return {
    ...createMissionState(actors, scenario.owners, scenario.playerOwner),
    objectives: createObjectiveStates(scenario.objectives ?? []),
    relationships: structuredClone([...(scenario.relationships ?? [])]),
    scenarioId: scenario.id,
    terrain: structuredClone(terrain),
    ...(economy && { economy }),
    fog: createFogState(),
  };
}
