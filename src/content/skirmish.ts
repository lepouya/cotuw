// Resolves skirmish launch choices and a map into a tick-0 scenario.
import { currentContentPack } from "./packs";
import { SKIRMISH_MAP } from "./skirmish-map";
import { deepFreeze } from "../simulation/actor";
import { createCultivationSite } from "../simulation/cultivation";
import { isDifficulty, resolveSetup } from "../simulation/mission-setup";
import { defineScenario } from "../simulation/scenario";
import { TerrainGrid } from "../simulation/terrain";
import { hasOwn, isIdList } from "../simulation/validation";

import type { CultivationSite } from "../simulation/cultivation";
import type { AiAssignment } from "../simulation/director";
import type { MaterialsSite } from "../simulation/harvesting";
import type { Difficulty } from "../simulation/mission-setup";
import type { OwnerRelationship } from "../simulation/ownership";
import type { Resource } from "../simulation/resources";
import type { ScenarioDefinition } from "../simulation/scenario";
import type {
  ResourceArea,
  SkirmishFaction,
  SkirmishMap,
} from "./skirmish-map";

/** The starting package one faction receives at its start slot. */
type FactionOpening = {
  readonly headquarters: string;
  readonly worker: string;
  readonly dropoff: string;
  readonly resource: Resource;
  /** Pays for the first worker and drop-off building. */
  readonly stockpile: number;
};

const SITE_MATERIALS = 1000;
export const SKIRMISH_SCENARIO_ID = SKIRMISH_MAP.id;

export const SKIRMISH_OPENINGS = deepFreeze({
  arc: {
    headquarters: "arc-command-center-prototype",
    worker: "arc-harvester",
    dropoff: "arc-materials-refinery",
    resource: "materials",
    stockpile: 150,
  },
  circle: {
    headquarters: "circle-heartgrove",
    worker: "circle-cultivator",
    dropoff: "circle-conservatory",
    resource: "lifebloom",
    stockpile: 150,
  },
} satisfies Record<SkirmishFaction, FactionOpening>);

const materialsSiteId = (area: ResourceArea, index: number) =>
  `${area.id}-${index + 1}`;
const lifebloomSiteId = (area: ResourceArea, index: number) =>
  `${area.id}-lifebloom-${index + 1}`;
const areaSiteIds = (area: ResourceArea) => [
  ...area.materialsTiles.map((_, index) => materialsSiteId(area, index)),
  ...area.lifebloomTiles.map((_, index) => lifebloomSiteId(area, index)),
];

export function createSkirmishMaterialsSites({
  resourceAreas,
}: SkirmishMap = SKIRMISH_MAP): MaterialsSite[] {
  return resourceAreas.flatMap((area) =>
    area.materialsTiles.map((tile, index) => ({
      id: materialsSiteId(area, index),
      name: `${area.name} Materials`,
      tile: { ...tile },
      initialMaterials: SITE_MATERIALS,
      remainingMaterials: SITE_MATERIALS,
    })),
  );
}

export function createSkirmishCultivationSites({
  resourceAreas,
}: SkirmishMap = SKIRMISH_MAP): CultivationSite[] {
  return resourceAreas.flatMap((area) =>
    area.lifebloomTiles.map((tile, index) =>
      createCultivationSite(
        lifebloomSiteId(area, index),
        `${area.name} Lifebloom`,
        { ...tile },
      ),
    ),
  );
}

/** The choices that determine a skirmish's opening. */
export type SkirmishChoice = {
  /** Faction by start slot; each slot's owner shares its ID. */
  readonly factions: Readonly<Record<string, string>>;
  readonly playerSlot: string;
  readonly difficulty: Difficulty;
  /** Start slots an AI controls; absent leaves every slot uncontrolled. */
  readonly ai?: readonly AiAssignment[];
};

const isFaction = (faction: string): faction is SkirmishFaction =>
  hasOwn(SKIRMISH_OPENINGS, faction);

/** Why a map cannot assemble these launch choices. */
export function skirmishChoiceError(
  { factions, playerSlot, difficulty, ai }: SkirmishChoice,
  { starts }: SkirmishMap = SKIRMISH_MAP,
): string | undefined {
  for (const { id } of starts)
    if (!hasOwn(factions, id) || !isFaction(factions[id]))
      return `Start slot ${id} has no playable faction.`;
  if (Object.keys(factions).length !== starts.length)
    return "The map has no start slot for an assigned faction.";
  if (!starts.some(({ id }) => id === playerSlot))
    return `The map has no start slot named "${playerSlot}".`;
  if (!isDifficulty(difficulty))
    return "The skirmish has an invalid difficulty.";
  for (const { owner, profileId } of ai ?? []) {
    if (!starts.some(({ id }) => id === owner))
      return `The map has no start slot named "${owner}" for its AI.`;
    if (
      !currentContentPack("base").aiProfiles?.some(({ id }) => id === profileId)
    )
      return `Start slot ${owner} names an unknown AI profile "${profileId}".`;
  }
  if (ai && !isIdList(ai.map(({ owner }) => owner)))
    return "Each start slot can have only one AI controller.";
}

/**
 * Resolves launch choices into a tick-0 scenario. Both resource kinds stay on
 * the map in every assignment, so sites never depend on the matchup.
 */
export function createSkirmishScenario(
  choice: SkirmishChoice,
  skirmishMap: SkirmishMap = SKIRMISH_MAP,
): ScenarioDefinition {
  const error = skirmishChoiceError(choice, skirmishMap);
  if (error) throw new RangeError(error);
  const { factions, playerSlot, difficulty, ai } = choice;
  const slots = skirmishMap.starts.map((start) => {
    const faction = factions[start.id] as SkirmishFaction;
    return { start, faction, opening: SKIRMISH_OPENINGS[faction] };
  });
  const content = currentContentPack("base");
  const map = new TerrainGrid(skirmishMap.terrain);
  const owners = slots.map(({ start, faction }) => ({ id: start.id, faction }));
  const [first, second] = skirmishMap.starts;
  const rivals: [string, string] = [first.id, second.id];
  const relationships: OwnerRelationship[] = [
    { owners: rivals, relationship: "hostile" },
  ];
  return defineScenario({
    id: skirmishMap.id,
    name: "Skirmish",
    content: { id: content.id, version: content.version },
    tileSize: map.tileSize,
    terrainTypeIds: [...map.terrainTypeIds],
    terrain: map.terrainState(),
    owners,
    playerOwner: playerSlot,
    relationships,
    savePolicy: "skirmish",
    emergencyHeadquarters: true,
    ...(ai && { ai }),
    skirmish: {
      owners: rivals,
      qualifyingDefinitionIds: content.actors
        .filter(({ footprint }) => footprint)
        .map(({ id }) => id),
      startingResourceSites: Object.fromEntries(
        skirmishMap.starts.map(({ id, startingResourceAreaId }) => {
          const area = skirmishMap.resourceAreas.find(
            (candidate) => candidate.id === startingResourceAreaId,
          );
          if (!area)
            throw new RangeError(
              `Start slot ${id} has no resource area "${startingResourceAreaId}".`,
            );
          return [id, areaSiteIds(area)];
        }),
      ),
    },
    setup: resolveSetup(
      difficulty,
      { owners, playerOwner: playerSlot, relationships },
      factions,
    ),
    briefing: {
      label: "Skirmish",
      title: "Outlast your rival",
      description:
        "Establish income, build your forces, and destroy every enemy building.",
      goalsHeading: "Win the skirmish",
      goalsNote: "An owner with no completed buildings is eliminated.",
      rules: "Both sides start with one headquarters · Normal costs and timing",
    },
    buildings: slots.map(({ start, faction, opening }) => ({
      actorId: `${start.id}-headquarters`,
      definitionId: opening.headquarters,
      origin: start.headquartersOrigins[faction],
      owner: start.id,
    })),
    stockpiles: slots.map(({ start, opening }) => ({
      resource: opening.resource,
      owners: [start.id],
      amount: opening.stockpile,
    })),
    sites: createSkirmishMaterialsSites(skirmishMap),
    cultivation: { sites: createSkirmishCultivationSites(skirmishMap) },
    loot: [],
  });
}

/**
 * Reads `?skirmish=<west>-<east>&player=<slot>&difficulty=<level>` links, with
 * development `&ai=<slot>:<profile>,...` control. Values stay as written so
 * `skirmishChoiceError` reports mistakes.
 */
export function skirmishLink(
  link: URLSearchParams,
  { starts }: SkirmishMap = SKIRMISH_MAP,
): SkirmishChoice | undefined {
  const matchup = link.get("skirmish")?.split("-");
  if (!matchup) return;
  const ai = link
    .get("ai")
    ?.split(",")
    .map((entry) => {
      const [owner, ...profile] = entry.split(":");
      return { owner: owner!, profileId: profile.join(":") };
    });
  return {
    factions: Object.fromEntries(
      matchup.map((faction, slot) => [starts[slot]?.id ?? slot, faction]),
    ),
    playerSlot: link.get("player") ?? starts[0].id,
    difficulty: (link.get("difficulty") ?? "normal") as Difficulty,
    ...(ai && { ai }),
  };
}
