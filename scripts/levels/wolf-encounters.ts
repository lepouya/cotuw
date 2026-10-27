import type { ObjectiveDefinition } from "../../src/simulation/objectives.ts";
import type { ScenarioUnit } from "../../src/simulation/scenario.ts";
import type { TerrainGrid } from "../../src/simulation/terrain.ts";

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

/** Shared wildlife placements keep the faction scenarios comparable. */
export function wolfEncounters(map: TerrainGrid): ScenarioUnit[] {
  return [
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
}

/** Objectives to clear both encounters, with faction-specific directions. */
export function wolfObjectives(directives: {
  loneWolf: string;
  den: string;
}): ObjectiveDefinition[] {
  return [
    {
      id: "lone-wolf",
      kind: "destroy",
      label: "Defeat the lone wolf",
      directive: directives.loneWolf,
      actorIds: ["lone-wolf"],
    },
    {
      id: "wolf-den",
      kind: "destroy",
      label: "Clear the mountain den",
      directive: directives.den,
      actorIds: DEN_WOLVES.map(({ actorId }) => actorId),
    },
  ];
}
