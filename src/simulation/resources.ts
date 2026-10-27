import type { ActorDefinition } from "./actor";

type ResourceRules = {
  name: string;
  /** The price field an actor definition uses for this resource. */
  cost: (definition: ActorDefinition) => number | undefined;
};
/** Common resources; each definition prices itself in at most one. */
const RESOURCES = {
  materials: {
    name: "Materials",
    cost: (definition) => definition.materialsCost,
  },
  lifebloom: {
    name: "Lifebloom",
    cost: (definition) => definition.lifebloomCost,
  },
} satisfies Record<string, ResourceRules>;
export type Resource = keyof typeof RESOURCES;
export const RESOURCE_IDS = Object.keys(RESOURCES) as Resource[];

/** The prices a definition sets; valid definitions set at most one. */
export const definedPrices = (definition: ActorDefinition) =>
  RESOURCE_IDS.map((id) => RESOURCES[id].cost(definition)).filter(
    (cost) => cost !== undefined,
  );
export const costResource = (definition: ActorDefinition): Resource =>
  RESOURCE_IDS.find((id) => RESOURCES[id].cost(definition) !== undefined) ??
  "materials";
export const costAmount = (definition: ActorDefinition) =>
  RESOURCES[costResource(definition)].cost(definition) ?? 0;
export const resourceName = (resource: Resource) => RESOURCES[resource].name;
export const costCurrency = (definition: ActorDefinition) =>
  resourceName(costResource(definition));
/** A price as players read it, such as "50 Lifebloom". */
export const costLabel = (definition: ActorDefinition) =>
  `${costAmount(definition)} ${costCurrency(definition)}`;
export const materialsCost = (definition: ActorDefinition) =>
  definition.materialsCost ?? 0;

/** The resource that prices a faction's roster; each faction uses one. */
export function factionResource(
  definitions: Iterable<ActorDefinition>,
  faction: string | undefined,
): Resource | undefined {
  for (const definition of definitions)
    if (definition.faction === faction && costAmount(definition) > 0)
      return costResource(definition);
  return undefined;
}
