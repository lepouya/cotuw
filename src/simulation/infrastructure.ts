import { healthOf, nearestTo } from "./actor";
import { disconnectedBuildings } from "./support";
import { growthReady, releaseTender } from "./growth";
import { secondsToTicks } from "./clock";
import { applyRepairStep, nextRepairStep } from "./repair";
import {
  compareInfrastructure,
  infrastructureJob,
} from "./infrastructure-queue";
import { stockpileOf } from "./stockpiles";
import { costResource } from "./resources";
import { isCount, isId } from "./validation";
import type { Actor, ActorDefinition, ActorRenderState } from "./actor";
import type { EconomyState, EconomyWorld } from "./economy";
import type { Stockpile } from "./stockpiles";
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
    let next: string | undefined;
    if (emergency) next = undefined;
    else if (headquarters && hostsWork(headquarters, building, rules))
      next = headquarters.id;
    else next = infrastructureHeadquarters(building, actors, rules)[0]?.id;
    if (building.headquartersId === next) continue;
    if (next) building.headquartersId = next;
    else delete building.headquartersId;
    delete infrastructureJob(building)?.active;
  }
}

/**
 * Advances construction and repair through headquarters queues. Eligible active
 * work keeps its slot; blocked work yields it and keeps its queue priority. Work
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
  const definitionOf = (building: Actor) =>
    definitions.get(building.definitionId)!;
  const poolOf = (building: Actor) =>
    stockpileOf(economy, building.owner, costResource(definitionOf(building)));
  /** A replacement headquarters runs without capacity or support. */
  const emergency = (building: Actor) =>
    !!building.construction &&
    replacesHeadquarters(building, headquartered, rules);
  /**
   * Work needs a headquarters. Repair also needs a connection and its next
   * payment; growth needs an arrived tending worker instead of support.
   */
  const ready = (building: Actor) => {
    if (building.repair)
      return (
        !!building.headquartersId &&
        !disconnected.has(building.id) &&
        !building.repair.unaffordable
      );
    if (definitionOf(building).growth)
      return (
        growthReady(building, economy, world) &&
        (!!building.headquartersId || emergency(building))
      );
    return (
      emergency(building) ||
      (!!building.headquartersId && !disconnected.has(building.id))
    );
  };
  const paymentTick =
    (world.tick + 1) % secondsToTicks(1, world.tickSeconds) === 0;
  // Active work keeps its slot; other ties follow queue order.
  const work: Actor[] = [];
  for (const building of actors) {
    const maximum = definitionOf(building).health;
    if (building.repair && healthOf(building, maximum!) === maximum)
      delete building.repair;
    if (infrastructureJob(building)) work.push(building);
  }
  work.sort(
    (a, b) =>
      Number(!!infrastructureJob(b)!.active) -
        Number(!!infrastructureJob(a)!.active) || compareInfrastructure(a, b),
  );
  if (paymentTick)
    for (const building of work) delete building.repair?.unaffordable;
  /** Fills headquarters slots in order; emergency work takes one per owner. */
  const allocate = () => {
    const used = new Map<string, number>();
    const emergencies = new Set<string>();
    const claimSlot = (building: Actor) => {
      const headquarters = byId.get(building.headquartersId ?? "");
      if (!headquarters) {
        if (emergencies.has(building.owner)) return false;
        emergencies.add(building.owner);
        return true;
      }
      const capacity = definitionOf(headquarters).infrastructure!.slots;
      const count = used.get(headquarters.id) ?? 0;
      if (count >= capacity) return false;
      used.set(headquarters.id, count + 1);
      return true;
    };
    return new Set(
      work.filter((building) => ready(building) && claimSlot(building)),
    );
  };
  /** Slotted repairs in payment order. */
  const payments = (selected: ReadonlySet<Actor>) =>
    [...selected]
      .filter((building) => building.repair)
      .sort(compareInfrastructure);
  /** The first slotted repair its shared balance cannot pay for. */
  const unaffordable = (selected: ReadonlySet<Actor>) => {
    const balances = new Map<Stockpile, number>();
    return payments(selected).find((building) => {
      const pool = poolOf(building);
      if (!pool) return true;
      const balance = balances.get(pool) ?? pool.amount;
      const { cost } = nextRepairStep(building, definitionOf(building));
      balances.set(pool, balance - cost);
      return balance < cost;
    });
  };
  let selected = allocate();
  // An unaffordable repair and later ones on its balance pause until the next
  // payment, yielding their slots to other work before anything is charged.
  if (paymentTick)
    for (
      let blocked = unaffordable(selected);
      blocked;
      blocked = unaffordable(selected)
    ) {
      const pool = poolOf(blocked);
      for (const later of work)
        if (
          later.repair &&
          compareInfrastructure(later, blocked) >= 0 &&
          poolOf(later) === pool
        )
          later.repair.unaffordable = true;
      selected = allocate();
    }
  for (const building of work) {
    const job = infrastructureJob(building)!;
    if (selected.has(building)) job.active = true;
    else delete job.active;
  }
  if (paymentTick)
    for (const building of payments(selected)) {
      const definition = definitionOf(building);
      const cost = applyRepairStep(building, definition, economy);
      world.spend?.(building.owner, definition, cost);
    }
  for (const building of selected) {
    const construction = building.construction;
    if (!construction) continue;
    construction.completedTicks += 1;
    if (construction.completedTicks >= construction.totalTicks) {
      delete building.construction;
      if (definitionOf(building).infrastructure)
        building.headquartersId = building.id;
      releaseTender(economy, building.id);
      world.complete?.(building);
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
  const priorities = new Map<string, Set<number>>();
  for (const actor of actors) {
    const priority = infrastructureJob(actor)?.priority;
    if (priority !== undefined) {
      const owned = priorities.get(actor.owner) ?? new Set<number>();
      if (owned.has(priority))
        throw new RangeError("Mission has duplicate infrastructure priority.");
      priorities.set(actor.owner, owned.add(priority));
    }
    if (
      actor.headquartersId !== undefined &&
      (!actor.tilePlacement ||
        !isId(actor.headquartersId) ||
        !actors.some(
          (headquarters) =>
            headquarters.id === actor.headquartersId &&
            compatibleHeadquarters(headquarters, actor, definitions),
        ))
    )
      throw new RangeError("Mission has invalid infrastructure state.");
  }
}
