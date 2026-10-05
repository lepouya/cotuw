// The economy opening's authored content, baked into its level file.
import { currentContentPack } from "../../src/content/packs.ts";
import { materialsCost } from "../../src/simulation/economy.ts";
import { TerrainGrid } from "../../src/simulation/terrain.ts";
import { defineScenario } from "../../src/simulation/scenario.ts";
import { PROTOTYPE_TERRAIN } from "./m0-terrain.ts";

import type {
  MaterialsLoot,
  MaterialsSite,
} from "../../src/simulation/economy.ts";
import type { TileCoord } from "../../src/simulation/grid.ts";

const map = new TerrainGrid(PROTOTYPE_TERRAIN);

export const BASE_CONTENT = currentContentPack("base");

const costOf = (id: string) =>
  materialsCost(BASE_CONTENT.actors.find((actor) => actor.id === id)!);

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
  content: { id: BASE_CONTENT.id, version: BASE_CONTENT.version },
  name: "Clear the wolf threat",
  briefing: {
    label: "Materials economy",
    title: "Clear the wolf threat",
    description: "Defeat all six wolves to win. Victory unlocks free play.",
    goalsHeading: "Recommended preparation",
    goalsNote:
      "These counts show your current forces. Preparation steps guide you; defeating the wolves wins the mission.",
    rules:
      "Paid construction · Timed production · Sell buildings for half their cost",
  },
  goals: [
    {
      definitionId: "arc-materials-refinery",
      label: "Build a Materials Refinery",
      directive: `Spend ${costOf("arc-materials-refinery")} Materials near your Command Center and wait for construction.`,
    },
    {
      definitionId: "arc-harvester",
      label: "Produce a Harvester",
      directive: `Select the Refinery, pay ${costOf("arc-harvester")} Materials, then send its Harvester to Near Materials.`,
    },
    {
      definitionId: "arc-field-barracks",
      label: "Build a Field Barracks",
      directive: `Gather or collect salvage to pay ${costOf("arc-field-barracks")} Materials. Build within connected support coverage.`,
    },
    {
      definitionId: "arc-trooper",
      label: "Train Troopers",
      directive: `Troopers cost ${costOf("arc-trooper")} Materials each. Use Attack Move to advance as a group; a Scout can reveal the route ahead.`,
    },
  ],
  popups: [
    {
      id: "support-network",
      title: "Support Network",
      text: "ARC buildings draw support from a connected network rooted at the Command Center. Place each blueprint inside the support radius of a completed, connected building. If a building loses its path back to the Command Center, its construction, production, and cargo delivery pause until the connection returns.",
      trigger: { kind: "placement", definitionId: "arc-materials-refinery" },
    },
    {
      id: "harvester-operations",
      title: "Harvester Operations",
      text: "Select the Harvester and choose a Materials patch to gather. It fills its 100-Materials cargo, returns it to its Refinery, and repeats automatically. When the patch is exhausted, it delivers its last load and waits; choose a new patch to reassign it.",
      trigger: { kind: "actor", definitionId: "arc-harvester" },
    },
  ],
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
