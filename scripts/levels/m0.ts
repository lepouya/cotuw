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
      id: "command-basics",
      title: "Welcome, Commander",
      text: "Build a base, gather Materials, and train a force to clear the wolves while protecting your Command Center. Use Buildings in the upper sidebar to place a Materials Refinery near your base first. Units lets you train from a selected production building. The lower sidebar always explains your selection and its actions. Click a unit to select it, then click clear ground to move it; drag a box to select several. Use the camera's Pan button to explore the map, and open Goals for your objectives. Take your time: Pause stops the mission while you look around.",
      trigger: { kind: "actor", definitionId: "arc-command-center-prototype" },
    },
    {
      id: "support-network",
      title: "Support Network",
      text: "ARC buildings draw support from a connected network rooted at the Command Center. Place each blueprint inside the support radius of a completed, connected building. If a building loses its path back to the Command Center, its construction, production, and cargo delivery pause until the connection returns.",
      trigger: { kind: "placement", definitionId: "arc-materials-refinery" },
    },
    {
      id: "harvester-operations",
      title: "Harvester Operations",
      text: "Select the Harvester, then click the blue Materials patch on the map or choose Gather in the lower selection panel. It fills its 100-Materials cargo, returns it to its Refinery, and repeats automatically. When the patch is exhausted, it delivers its last load and waits; choose a new patch to reassign it.",
      trigger: { kind: "actor", definitionId: "arc-harvester" },
    },
    {
      id: "barracks-training",
      title: "Barracks & Training",
      text: "Your Field Barracks trains Troopers and Scouts. Select it to open Units in the upper sidebar, then choose a unit picture to pay for a training order. Troopers fight; Scouts reveal more terrain but cannot attack. Orders train one at a time, and the selected building's lower panel lets you cancel for a full refund. Set Rally Point there, then click clear ground to send new units to a meeting point. Keep gathering Materials to grow your force.",
      trigger: { kind: "actor", definitionId: "arc-field-barracks" },
    },
    {
      id: "scouting",
      title: "Scouting & Combat",
      text: "Select your Scout and click unexplored ground to reveal the route south toward the wolves. Dark terrain is unexplored; dim terrain has been explored but is outside your units' current sight. Scouts are unarmed, so keep them away from wolves and bring Troopers before advancing. Drag a box around your Troopers, choose Attack Move in the lower sidebar, then click a destination to move and fight along the route. Click a visible wolf to attack it directly. Goals tracks the enemies you must defeat.",
      trigger: { kind: "actor", definitionId: "arc-scout" },
    },
  ],
  // Circles the lake shore beyond the near patch, visible early on.
  flocks: [
    {
      center: map.tileCenter(30, 57),
      radius: 6,
      altitude: 5,
      count: 4,
      lapSeconds: 28,
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
