// The economy opening's authored content, baked into its level file.
import { TerrainGrid } from "../../src/simulation/terrain.ts";
import { PROTOTYPE_TERRAIN } from "./m0-terrain.ts";
import { costOf } from "./base-content.ts";
import { createWolfDenScenario } from "./wolf-den.ts";

import type {
  ResourceLoot,
  MaterialsSite,
} from "../../src/simulation/economy.ts";
import type { TileCoord } from "../../src/simulation/grid.ts";

const map = new TerrainGrid(PROTOTYPE_TERRAIN);

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

const salvage = (id: string, name: string, tile: TileCoord): ResourceLoot => ({
  id,
  name,
  tile,
  materials: 25,
  collected: false,
});

export const ECONOMY_SCENARIO = createWolfDenScenario({
  id: "arc-economy-opening",
  name: "Clear the wolf threat",
  briefing: {
    label: "Materials economy",
    title: "Clear the wolf threat",
    description: "Defeat all six wolves to win. Victory unlocks free play.",
    goalsHeading: "Recommended preparation",
    goalsNote: "Build income and an army. Defeat all six wolves to win.",
    rules:
      "Paid construction · Timed production · Sell buildings for half their cost",
  },
  goals: [
    {
      definitionId: "arc-materials-refinery",
      label: "Build a Materials Refinery",
      directive: `Open Buildings and place a Refinery near your Command Center (${costOf("arc-materials-refinery")} Materials).`,
    },
    {
      definitionId: "arc-harvester",
      label: "Produce a Harvester",
      directive: `Select the Refinery, open Units, and produce a Harvester (${costOf("arc-harvester")} Materials). Send it to Near Materials.`,
    },
    {
      definitionId: "arc-field-barracks",
      label: "Build a Field Barracks",
      directive: `Gather Materials, then build a Barracks within connected support coverage (${costOf("arc-field-barracks")} Materials).`,
    },
    {
      definitionId: "arc-trooper",
      label: "Train Troopers",
      directive: `Select the Barracks to train Troopers (${costOf("arc-trooper")} Materials). Use Attack Move to advance and fight.`,
    },
  ],
  popups: [
    {
      id: "command-basics",
      title: "Welcome, Commander",
      text: `Open Buildings and place a Materials Refinery near your Command Center (${costOf("arc-materials-refinery")} Materials). Then select the Refinery and produce a Harvester from Units (${costOf("arc-harvester")} Materials). Protect your Command Center while you build an army to clear the wolves.`,
      trigger: { kind: "actor", definitionId: "arc-command-center-prototype" },
    },
    {
      id: "support-network",
      title: "Support Network",
      text: "Place buildings inside the support radius of a completed, connected building. The network must reach your Command Center. A broken connection pauses construction, training, and cargo delivery until reconnected.",
      trigger: { kind: "placement", definitionId: "arc-materials-refinery" },
    },
    {
      id: "harvester-operations",
      title: "Harvester Operations",
      text: "Select the Harvester, then click the blue Near Materials patch or choose Gather. It delivers cargo to its Refinery and repeats. When the patch runs out, send it to another patch. Gift boxes grant Materials when a unit walks over them.",
      trigger: { kind: "actor", definitionId: "arc-harvester" },
    },
    {
      id: "barracks-training",
      title: "Barracks & Training",
      text: "Select the Barracks and choose a unit from Units. Troopers fight; Scouts see farther but cannot attack. Training runs one order at a time. Choose Rally Point, then click ground to send new units there. Cancel an order for a full refund.",
      trigger: { kind: "actor", definitionId: "arc-field-barracks" },
    },
    {
      id: "scouting",
      title: "Scouting & Combat",
      text: "Select a unit, then click ground to move. Keep your unarmed Scout away from wolves. Drag a box around your Troopers, choose Attack Move, and click a destination. Follow the southern path to the lone wolf, then cross the ridge to the den.",
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
  playerFaction: "arc",
  headquarters: {
    actorId: "starting-command-center",
    definitionId: "arc-command-center-prototype",
  },
  protection: {
    id: "protect-command-center",
    label: "Protect the Command Center",
    directive: "Its destruction ends the mission in defeat.",
  },
  directions: {
    loneWolf:
      "Follow the southern path. One Trooper can defeat this wolf; Scouts cannot attack.",
    den: "Collect the salvage beyond the lone wolf for two more Troopers. Cross the ridge south of the split summit, then follow the path south between the den teeth. Bring several Troopers to defeat four wolves and the larger alpha.",
  },
  crossingLoot: (tile, index) =>
    salvage(`salvage-${index + 2}`, "Crossing salvage", tile),
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
  loot: [salvage("salvage-1", "Materials salvage", { x: 25, z: 52 })],
});
