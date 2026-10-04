import { ARC_ACTOR_DEFINITIONS } from "./arc";
import { WILDLIFE_ACTOR_DEFINITIONS } from "./wildlife";
import { TerrainGrid } from "../simulation/terrain";
import type { ActorDefinition } from "../simulation/actor";
import type { MaterialsLoot, MaterialsSite } from "../simulation/economy";
import type { TileCoord } from "../simulation/grid";
import { defineScenario } from "../simulation/scenario";
import { PROTOTYPE_TERRAIN } from "./prototype-terrain";

const map = new TerrainGrid(PROTOTYPE_TERRAIN);

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

/** One named patch of 200-Materials tiles, numbered in authored order. */
const patch = (
  id: string,
  name: string,
  tiles: readonly TileCoord[],
): MaterialsSite[] =>
  tiles.map((tile, index) => ({
    id: `${id}-${index + 1}`,
    name,
    tile,
    initialMaterials: 200,
    remainingMaterials: 200,
  }));

const salvage = (id: string, name: string, tile: TileCoord): MaterialsLoot => ({
  id,
  name,
  tile,
  materials: 25,
  collected: false,
});

export const ECONOMY_SCENARIO = defineScenario({
  id: "arc-economy-opening",
  tileSize: map.tileSize,
  terrainTypeIds: [...map.terrainTypeIds],
  terrain: map.terrainState(),
  playerFaction: "arc",
  objectives: [
    {
      id: "protect-command-center",
      kind: "protect",
      label: "Protect the Command Center",
      directive: "Its destruction ends the mission in defeat.",
      actorIds: ["starting-command-center"],
    },
    {
      id: "lone-wolf",
      kind: "destroy",
      label: "Defeat the lone wolf",
      directive:
        "Follow the southern path. One Trooper can defeat this wolf; Scouts cannot attack.",
      actorIds: ["lone-wolf"],
    },
    {
      id: "wolf-den",
      kind: "destroy",
      label: "Clear the mountain den",
      directive:
        "Collect the salvage beyond the lone wolf for two more Troopers. Cross the ridge south of the split summit, then follow the path south between the den teeth. Bring several Troopers to defeat four wolves and the larger alpha.",
      actorIds: DEN_WOLVES.map(({ actorId }) => actorId),
    },
  ],
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
    ...patch("near-materials", "Near Materials", [
      { x: 20, z: 50 },
      { x: 21, z: 50 },
      { x: 20, z: 51 },
      { x: 21, z: 51 },
    ]),
    ...patch("south-materials", "South Materials", [
      { x: 24, z: 42 },
      { x: 25, z: 42 },
    ]),
  ],
  loot: [
    salvage("salvage-1", "Materials salvage", { x: 25, z: 52 }),
    salvage("salvage-2", "Crossing salvage", { x: 54, z: 32 }),
    salvage("salvage-3", "Crossing salvage", { x: 56, z: 34 }),
  ],
});
