import { TerrainGrid } from "../../src/simulation/terrain.ts";
import { defineScenario } from "../../src/simulation/scenario.ts";
import { BASE_CONTENT } from "./base-content.ts";
import { PROTOTYPE_TERRAIN } from "./prototype-terrain.ts";

import type {
  ScenarioDefinition,
  ScenarioUnit,
} from "../../src/simulation/scenario.ts";
import type { ActorPlacement } from "../../src/simulation/placement.ts";
import type { ObjectiveDefinition } from "../../src/simulation/objectives.ts";
import type { ResourceLoot } from "../../src/simulation/economy.ts";
import type { TileCoord } from "../../src/simulation/grid.ts";

type WolfDenOptions = Omit<
  Extract<ScenarioDefinition, { stockpiles: readonly unknown[] }>,
  | "content"
  | "terrain"
  | "tileSize"
  | "terrainTypeIds"
  | "buildings"
  | "units"
  | "flocks"
  | "objectives"
  | "owners"
  | "playerOwner"
  | "relationships"
> & {
  /** The player owns this faction's actors; wolves belong to the wildlife. */
  playerFaction: string;
  headquarters: Pick<ActorPlacement, "actorId" | "definitionId">;
  protection: Pick<ObjectiveDefinition, "id" | "label" | "directive">;
  directions: { loneWolf: string; den: string };
  crossingLoot: (tile: TileCoord, index: number) => ResourceLoot;
};

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

/** Both introductions share a battlefield; faction openings remain authored. */
export function createWolfDenScenario({
  headquarters,
  protection,
  directions,
  crossingLoot,
  playerFaction,
  ...opening
}: WolfDenOptions): ScenarioDefinition {
  const map = new TerrainGrid(PROTOTYPE_TERRAIN);
  const wolves: ScenarioUnit[] = [
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
  ];
  return defineScenario({
    ...opening,
    owners: [
      { id: "player", faction: playerFaction },
      { id: "wildlife", faction: "wildlife" },
    ],
    playerOwner: "player",
    relationships: [
      { owners: ["player", "wildlife"], relationship: "hostile" },
    ],
    content: { id: BASE_CONTENT.id, version: BASE_CONTENT.version },
    tileSize: map.tileSize,
    terrainTypeIds: [...map.terrainTypeIds],
    terrain: map.terrainState(),
    buildings: [{ ...headquarters, origin: { x: 8, z: 50 } }],
    units: wolves,
    // Circles the lake shore, visible early on.
    flocks: [
      {
        center: map.tileCenter(30, 57),
        radius: 6,
        altitude: 5,
        count: 4,
        lapSeconds: 28,
      },
    ],
    objectives: [
      { ...protection, kind: "protect", actorIds: [headquarters.actorId] },
      {
        id: "lone-wolf",
        kind: "destroy",
        label: "Defeat the lone wolf",
        directive: directions.loneWolf,
        actorIds: ["lone-wolf"],
      },
      {
        id: "wolf-den",
        kind: "destroy",
        label: "Clear the mountain den",
        directive: directions.den,
        actorIds: DEN_WOLVES.map(({ actorId }) => actorId),
      },
    ],
    loot: [
      ...opening.loot,
      ...[
        { x: 54, z: 32 },
        { x: 56, z: 34 },
      ].map(crossingLoot),
    ],
  });
}
