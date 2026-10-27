import { TerrainGrid } from "../../src/simulation/terrain.ts";
import { defineScenario } from "../../src/simulation/scenario.ts";
import { BASE_CONTENT } from "./base-content.ts";
import { PROTOTYPE_TERRAIN } from "./m0-terrain.ts";
import { wolfEncounters, wolfObjectives } from "./wolf-encounters.ts";

import type { ScenarioDefinition } from "../../src/simulation/scenario.ts";
import type { ActorPlacement } from "../../src/simulation/placement.ts";
import type { ObjectiveDefinition } from "../../src/simulation/objectives.ts";
import type { ResourceLoot } from "../../src/simulation/economy.ts";
import type { TileCoord } from "../../src/simulation/grid.ts";

type WolfDenOptions = Omit<
  Extract<ScenarioDefinition, { materials: number }>,
  | "content"
  | "terrain"
  | "tileSize"
  | "terrainTypeIds"
  | "buildings"
  | "units"
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
    units: wolfEncounters(map),
    objectives: [
      { ...protection, kind: "protect", actorIds: [headquarters.actorId] },
      ...wolfObjectives(directions),
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
