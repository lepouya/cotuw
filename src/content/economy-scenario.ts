import { ARC_ACTOR_DEFINITIONS } from "./arc";
import { WILDLIFE_ACTOR_DEFINITIONS } from "./wildlife";
import { TerrainGrid } from "../simulation/terrain";
import type { ActorDefinition } from "../simulation/actor";
import { defineScenario } from "../simulation/scenario";
import {
  PROTOTYPE_MAP_SIZE,
  prototypeHeightAt,
  prototypeTerrainAt,
} from "./prototype-terrain";

const map = new TerrainGrid({
  width: PROTOTYPE_MAP_SIZE,
  height: PROTOTYPE_MAP_SIZE,
  tileSize: 1,
  terrainTypeIds: ["plain", "path", "rough", "water"],
  createHeight: prototypeHeightAt,
  createTerrain: prototypeTerrainAt,
});

/** Every actor type the opening can contain. */
export const ECONOMY_ACTOR_DEFINITIONS: readonly ActorDefinition[] = [
  ...ARC_ACTOR_DEFINITIONS,
  ...WILDLIFE_ACTOR_DEFINITIONS,
];

const DEN_WOLVES = [
  { actorId: "den-wolf-1", definitionId: "wolf", tile: { x: 74, z: 21 } },
  { actorId: "den-wolf-2", definitionId: "wolf", tile: { x: 82, z: 21 } },
  { actorId: "den-wolf-3", definitionId: "wolf", tile: { x: 75, z: 24 } },
  { actorId: "den-wolf-4", definitionId: "wolf", tile: { x: 81, z: 24 } },
  {
    actorId: "den-alpha-wolf",
    definitionId: "alpha-wolf",
    tile: { x: 78, z: 19 },
  },
];

export const ECONOMY_SCENARIO = defineScenario({
  id: "arc-economy-opening",
  tileSize: 1,
  terrainTypeIds: [...map.terrainTypeIds],
  terrain: map.terrainState(),
  playerFaction: "arc",
  defeatOnDestruction: ["starting-command-center"],
  buildings: [
    {
      actorId: "starting-command-center",
      definitionId: "arc-command-center-prototype",
      origin: { x: 8, z: 50 },
    },
  ],
  units: [
    {
      actorId: "lone-wolf",
      definitionId: "wolf",
      tile: { x: 46, z: 32 },
      facing: -Math.PI / 2,
      territory: { encounterId: "lone-wolf", radius: 14 },
    },
    ...DEN_WOLVES.map((wolf) => ({
      ...wolf,
      facing: Math.PI,
      territory: {
        encounterId: "wolf-den",
        center: map.tileCenter(78, 21),
        radius: 12,
      },
    })),
  ],
  materials: 150,
  sites: [
    {
      id: "near-materials-1",
      name: "Near Materials",
      tile: { x: 20, z: 50 },
      initialMaterials: 200,
      remainingMaterials: 200,
    },
    {
      id: "near-materials-2",
      name: "Near Materials",
      tile: { x: 21, z: 50 },
      initialMaterials: 200,
      remainingMaterials: 200,
    },
    {
      id: "near-materials-3",
      name: "Near Materials",
      tile: { x: 20, z: 51 },
      initialMaterials: 200,
      remainingMaterials: 200,
    },
    {
      id: "near-materials-4",
      name: "Near Materials",
      tile: { x: 21, z: 51 },
      initialMaterials: 200,
      remainingMaterials: 200,
    },
    {
      id: "north-materials-1",
      name: "North Materials",
      tile: { x: 24, z: 42 },
      initialMaterials: 200,
      remainingMaterials: 200,
    },
    {
      id: "north-materials-2",
      name: "North Materials",
      tile: { x: 25, z: 42 },
      initialMaterials: 200,
      remainingMaterials: 200,
    },
  ],
  loot: [
    {
      id: "salvage-1",
      name: "Materials salvage",
      tile: { x: 25, z: 52 },
      materials: 25,
      collected: false,
    },
    {
      id: "salvage-2",
      name: "Materials salvage",
      tile: { x: 27, z: 48 },
      materials: 25,
      collected: false,
    },
    {
      id: "salvage-3",
      name: "Materials salvage",
      tile: { x: 28, z: 44 },
      materials: 25,
      collected: false,
    },
  ],
});
