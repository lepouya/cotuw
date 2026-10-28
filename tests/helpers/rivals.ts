import { ARC_ACTOR_DEFINITIONS } from "./content";
import { exploredFog, stockpiles } from "./scenario";
import { createMissionSimulation } from "../../src/simulation/mission";
import { OccupancyGrid } from "../../src/simulation/occupancy";
import {
  createScenarioState,
  defineScenario,
} from "../../src/simulation/scenario";
import { TerrainGrid } from "../../src/simulation/terrain";
import { createTerrainMoveBehavior } from "../../src/simulation/terrain-movement";

import type { ScriptControl } from "../../src/simulation/authority";
import type { MissionEventDefinition } from "../../src/simulation/events";
import type { MaterialsSite, ResourceLoot } from "../../src/simulation/economy";
import type { MissionState } from "../../src/simulation/mission";
import type { ObjectiveDefinition } from "../../src/simulation/objectives";
import type { OwnerRelationship } from "../../src/simulation/ownership";
import type { ActorPlacement } from "../../src/simulation/placement";
import type { ScenarioUnit } from "../../src/simulation/scenario";

// Two ARC owners, the player and a rival, on a flat 60 x 20 map.
export const TICK_SECONDS = 0.1;
export const mapOptions = {
  width: 60,
  height: 20,
  tileSize: 1,
  terrainTypeIds: ["plain", "path", "rough", "water"],
};
export const contentMap = new TerrainGrid(mapOptions);

export type Setup = {
  units?: ScenarioUnit[];
  buildings?: (ActorPlacement & { owner?: string })[];
  relationships?: OwnerRelationship[];
  events?: MissionEventDefinition[];
  objectives?: ObjectiveDefinition[];
  sites?: MaterialsSite[];
  loot?: ResourceLoot[];
  scriptControl?: ScriptControl[];
  /** Starts with every tile explored, so placement ignores fog. */
  explored?: boolean;
  edit?: (state: MissionState) => void;
};

export function scenario({
  units = [],
  buildings = [],
  relationships = [],
  events,
  objectives,
  scriptControl,
  sites = [],
  loot = [],
}: Setup) {
  return defineScenario({
    id: "relationships",
    tileSize: 1,
    terrainTypeIds: mapOptions.terrainTypeIds,
    terrain: contentMap.terrainState(),
    owners: [
      { id: "player", faction: "arc" },
      { id: "rival", faction: "arc" },
    ],
    playerOwner: "player",
    relationships,
    events,
    objectives,
    scriptControl,
    buildings,
    units,
    stockpiles: [
      ...stockpiles(1000),
      ...stockpiles(1000, "materials", "rival"),
    ],
    sites,
    loot,
  });
}

export function fixture(setup: Setup = {}, state?: MissionState) {
  const content = scenario(setup);
  const initial = state ?? createScenarioState(content, ARC_ACTOR_DEFINITIONS);
  if (!state && setup.explored) initial.fog = exploredFog(initial);
  setup.edit?.(initial);
  const map = new TerrainGrid(mapOptions);
  const occupancy = new OccupancyGrid(map);
  const simulation = createMissionSimulation({
    state: initial,
    objectives: content.objectives,
    events: content.events,
    scriptControl: content.scriptControl,
    definitions: ARC_ACTOR_DEFINITIONS,
    map,
    occupancy,
    tickSeconds: TICK_SECONDS,
    bounds: map.worldBounds,
    behaviorRegistry: new Map([
      [
        "terrain-move",
        createTerrainMoveBehavior(map, occupancy, [
          {
            id: "surface-ground",
            maxSlope: 0.75,
            slopeCostAtLimit: 2,
            terrainCosts: { plain: 1, path: 1, rough: 2, water: null },
          },
        ]),
      ],
      ["idle", { handleCommand: () => false, update: () => {} }],
    ]),
  });
  return { simulation, content };
}

export const unit = (
  actorId: string,
  x: number,
  owner = "player",
  definitionId = "arc-trooper",
): ScenarioUnit => ({ actorId, definitionId, owner, tile: { x, z: 10 } });

export const at = (
  seconds: number,
  actions: MissionEventDefinition["actions"],
) => ({
  id: `at-${seconds}`,
  trigger: { kind: "time" as const, seconds },
  actions,
});

export const rivals = (relationship: "allied" | "neutral" | "hostile") => ({
  kind: "set-relationship" as const,
  owners: ["player", "rival"] as [string, string],
  relationship,
});
