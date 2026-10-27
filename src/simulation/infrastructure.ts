import { nearestTo } from "./actor";
import { disconnectedBuildings } from "./support";
import { growthReady, releaseTender } from "./growth";
import { isCount, isId } from "./validation";
import type { Actor, ActorDefinition, ActorRenderState } from "./actor";
import type { EconomyState, EconomyWorld } from "./economy";
import type { SupportView } from "./support";

/** A building, or a prospective one, and the owner it would belong to. */
type Building = Pick<ActorRenderState, "definitionId" | "owner"> & {
  id?: string;
};

/** Whether a building's owner may use a headquarters owner's queue. */
export type SharesHeadquarters = (
  headquartersOwner: string,
  buildingOwner: string,
) => boolean;

/** The rules that decide which headquarters may host infrastructure work. */
export type HostingRules = {
  definitions: ReadonlyMap<string, ActorDefinition>;
  sharesHeadquarters: SharesHeadquarters;
  /** Required for work that needs support from its headquarters. */
  support?: SupportView;
};
type EmergencyRules = Pick<HostingRules, "definitions"> & {
  emergencyHeadquarters?: boolean;
};
type AffiliationRules = HostingRules & EmergencyRules;

/** Whether `actor` is a completed headquarters of the building's kind. */
function compatibleHeadquarters(
  actor: ActorRenderState,
  building: Building,
  definitions: ReadonlyMap<string, ActorDefinition>,
) {
  const definition = definitions.get(building.definitionId);
  const headquarters = definitions.get(actor.definitionId);
  return (
    !actor.construction &&
    !!headquarters?.infrastructure &&
    (definition?.growth
      ? actor.definitionId === definition.growth.headquartersDefinitionId
      : headquarters.faction === definition?.faction)
  );
}

/**
 * Whether `actor` can host the building's work. Growth needs no support
 * chain; other construction needs support rooted at that headquarters.
 */
function hostsWork(
  actor: ActorRenderState,
  building: Building,
  { definitions, sharesHeadquarters, support }: HostingRules,
) {
  return (
    compatibleHeadquarters(actor, building, definitions) &&
    sharesHeadquarters(actor.owner, building.owner) &&
    (!!definitions.get(building.definitionId)?.growth ||
      !!support?.nodes
        .find((node) => node.actorId === building.id)
        ?.rootIds.includes(actor.id))
  );
}

/** Eligible headquarters, own or shared by allies, nearest first. */
export function infrastructureHeadquarters(
  building: Building & Pick<ActorRenderState, "worldPosition">,
  actors: readonly ActorRenderState[],
  rules: HostingRules,
) {
  return actors
    .filter((actor) => hostsWork(actor, building, rules))
    .sort(nearestTo(building.worldPosition));
}

/** Owners holding a completed headquarters of their own. */
export function headquarteredOwners(
  actors: readonly ActorRenderState[],
  definitions: ReadonlyMap<string, ActorDefinition>,
) {
  return new Set(
    actors
      .filter(
        (actor) =>
          !actor.construction &&
          definitions.get(actor.definitionId)?.infrastructure,
      )
      .map((actor) => actor.owner),
  );
}

/**
 * Whether the emergency rule lets the building's owner, holding no completed
 * headquarters, run it as a replacement without one.
 */
export const replacesHeadquarters = (
  building: Building,
  headquartered: ReadonlySet<string>,
  { definitions, emergencyHeadquarters }: EmergencyRules,
) =>
  !!emergencyHeadquarters &&
  !!definitions.get(building.definitionId)?.infrastructure &&
  !headquartered.has(building.owner);

/** Keeps eligible base affiliations for completed buildings and paid work. */
export function assignInfrastructure(
  actors: readonly Actor[],
  rules: AffiliationRules,
) {
  const byId = new Map(actors.map((actor) => [actor.id, actor]));
  const headquartered = headquarteredOwners(actors, rules.definitions);
  for (const building of actors) {
    if (!building.tilePlacement) continue;
    const emergency =
      !!building.construction &&
      replacesHeadquarters(building, headquartered, rules);
    const headquarters =
      !building.construction &&
      rules.definitions.get(building.definitionId)?.infrastructure
        ? building
        : byId.get(building.headquartersId ?? "");
    const next = emergency
      ? undefined
      : headquarters && hostsWork(headquarters, building, rules)
        ? headquarters.id
        : infrastructureHeadquarters(building, actors, rules)[0]?.id;
    if (building.headquartersId === next) continue;
    if (next) building.headquartersId = next;
    else delete building.headquartersId;
    if (building.construction) delete building.construction.active;
  }
}

/**
 * Advances construction through headquarters queues. Active eligible work
 * keeps its slot; blocked work yields it and keeps its queue priority. Work
 * keeps its headquarters while eligible, otherwise joins the nearest eligible
 * one without its slot, or pauses until one is available.
 */
export function updateInfrastructure(
  economy: EconomyState,
  world: EconomyWorld,
) {
  const { actors, definitions } = world;
  const byId = new Map(actors.map((actor) => [actor.id, actor]));
  const support = world.support();
  const disconnected = disconnectedBuildings(support);
  const rules = {
    definitions,
    sharesHeadquarters: world.sharesHeadquarters,
    support,
    emergencyHeadquarters: world.emergencyHeadquarters,
  };
  assignInfrastructure(actors, rules);
  const headquartered = headquarteredOwners(actors, definitions);
  /** A replacement headquarters runs without capacity or support. */
  const emergency = (building: Actor) =>
    replacesHeadquarters(building, headquartered, rules);
  /** Work needs a headquarters; growth also needs an arrived tending worker. */
  const ready = (building: Actor) => {
    if (definitions.get(building.definitionId)!.growth)
      return (
        growthReady(building, economy, world) &&
        (!!building.headquartersId || emergency(building))
      );
    return (
      emergency(building) ||
      (!!building.headquartersId && !disconnected.has(building.id))
    );
  };
  const eligible = new Set(
    actors
      .filter((actor) => actor.construction && ready(actor))
      .map((actor) => actor.id),
  );
  const used = new Map<string, number>();
  const emergencies = new Set<string>();
  /** Takes a slot from the job's headquarters, or its owner's emergency job. */
  const claimSlot = (building: Actor) => {
    const headquarters = byId.get(building.headquartersId ?? "");
    if (!headquarters) {
      if (emergencies.has(building.owner)) return false;
      emergencies.add(building.owner);
      return true;
    }
    const capacity = definitions.get(headquarters.definitionId)!.infrastructure!
      .slots;
    const count = used.get(headquarters.id) ?? 0;
    if (count >= capacity) return false;
    used.set(headquarters.id, count + 1);
    return true;
  };
  // Stable sort: active work first, then authored order.
  const work = actors
    .filter((actor) => actor.construction)
    .sort(
      (a, b) =>
        Number(!!b.construction!.active) - Number(!!a.construction!.active),
    );
  for (const building of work) {
    const construction = building.construction!;
    if (!eligible.has(building.id) || !claimSlot(building)) {
      delete construction.active;
      continue;
    }
    construction.active = true;
    construction.completedTicks += 1;
    if (construction.completedTicks >= construction.totalTicks) {
      delete building.construction;
      if (definitions.get(building.definitionId)!.infrastructure)
        building.headquartersId = building.id;
      releaseTender(economy, building.id);
    }
  }
}

export function validateInfrastructureDefinitions(
  definitions: ReadonlyMap<string, ActorDefinition>,
) {
  for (const definition of definitions.values())
    if (
      definition.infrastructure &&
      (!definition.footprint ||
        !isCount(definition.infrastructure.slots) ||
        !definition.infrastructure.slots)
    )
      throw new RangeError(
        `Invalid infrastructure definition: ${definition.id}.`,
      );
}

/** Relationship changes can leave a saved queue ineligible until reassigned. */
export function validateInfrastructure(
  actors: readonly Actor[],
  definitions: ReadonlyMap<string, ActorDefinition>,
) {
  for (const actor of actors) {
    const construction = actor.construction;
    if (
      (construction?.active !== undefined &&
        typeof construction.active !== "boolean") ||
      (actor.headquartersId !== undefined &&
        (!actor.tilePlacement ||
          !isId(actor.headquartersId) ||
          !actors.some(
            (headquarters) =>
              headquarters.id === actor.headquartersId &&
              compatibleHeadquarters(headquarters, actor, definitions),
          )))
    )
      throw new RangeError("Mission has invalid infrastructure state.");
  }
}
