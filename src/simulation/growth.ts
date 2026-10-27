import { nearestTo } from "./actor";
import { disconnectedBuildings } from "./support";
import {
  advanceWorkerRoute,
  routeTarget,
  workerNavigation,
} from "./worker-navigation";
import { isCount } from "./validation";
import type { Actor, ActorDefinition, ActorRenderState } from "./actor";
import type { EconomyState, EconomyWorld } from "./economy";

type Ref = Pick<ActorRenderState, "id" | "definitionId" | "owner">;
/** A building, or a prospective one, and the owner it would belong to. */
type GrowthSite = Pick<ActorRenderState, "definitionId" | "owner">;

/** Whether a building's owner may use a headquarters owner's queue. */
export type SharesHeadquarters = (
  headquartersOwner: string,
  buildingOwner: string,
) => boolean;

/** Whether `actor` is an operational headquarters that can host `building`. */
const hostsGrowth = (
  actor: ActorRenderState,
  building: GrowthSite,
  definitions: ReadonlyMap<string, ActorDefinition>,
  sharesHeadquarters: SharesHeadquarters,
) =>
  !actor.construction &&
  sharesHeadquarters(actor.owner, building.owner) &&
  actor.definitionId ===
    definitions.get(building.definitionId)?.growth?.headquartersDefinitionId;

/** Eligible headquarters, own or shared by allies, nearest first. */
export function growthHeadquarters(
  building: ActorRenderState,
  actors: readonly ActorRenderState[],
  definitions: ReadonlyMap<string, ActorDefinition>,
  sharesHeadquarters: SharesHeadquarters,
) {
  return actors
    .filter((actor) =>
      hostsGrowth(actor, building, definitions, sharesHeadquarters),
    )
    .sort(nearestTo(building.worldPosition));
}
/** Listed actors of the building's owner and worker type that may tend it. */
export function growthCandidates<T extends Ref>(
  building: GrowthSite,
  workerIds: readonly string[],
  actors: readonly T[],
  definitions: ReadonlyMap<string, ActorDefinition>,
): T[] {
  const workerId = definitions.get(building.definitionId)?.growth
    ?.workerDefinitionId;
  return actors.filter(
    (actor) =>
      workerIds.includes(actor.id) &&
      actor.owner === building.owner &&
      actor.definitionId === workerId,
  );
}
/** The nearest candidate that can reach the building. */
export function growthWorkerFor(
  building: Actor,
  workerIds: readonly string[],
  actors: readonly Actor[],
  world: Pick<EconomyWorld, "definitions" | "behaviors" | "map">,
): Actor | undefined {
  const navigation = workerNavigation(world);
  return growthCandidates(building, workerIds, actors, world.definitions)
    .sort(nearestTo(building.worldPosition))
    .find((actor) => navigation.entrance(actor, building));
}
/** Active eligible work keeps its slot; blocked work retains queue priority. */
export function updateGrowth(economy: EconomyState, world: EconomyWorld) {
  const { actors, definitions } = world;
  const byId = new Map(actors.map((actor) => [actor.id, actor]));
  const disconnected = disconnectedBuildings(world.support());
  const navigation = workerNavigation(world);
  const tenders = new Map(
    (economy.cultivation?.workers ?? []).flatMap((worker) =>
      worker.tendingId ? [[worker.tendingId, worker.actorId] as const] : [],
    ),
  );
  /** Growth needs a headquarters and an arrived tending worker. */
  const ready = (building: Actor) => {
    const construction = building.construction!;
    const definition = definitions.get(building.definitionId)!;
    if (!definition.growth) return !disconnected.has(building.id);
    const current = byId.get(construction.headquartersId ?? "");
    if (
      !current ||
      !hostsGrowth(current, building, definitions, world.sharesHeadquarters)
    ) {
      construction.headquartersId = growthHeadquarters(
        building,
        actors,
        definitions,
        world.sharesHeadquarters,
      )[0]?.id;
      delete construction.active;
    }
    const actor = byId.get(tenders.get(building.id) ?? "");
    if (!actor) return false;
    const point = routeTarget(actor) ?? navigation.entrance(actor, building);
    return (
      !!point &&
      advanceWorkerRoute(actor, point, world, world.map.tileSize * 0.75) ===
        "arrived" &&
      !!construction.headquartersId
    );
  };
  const eligible = new Set(
    actors
      .filter((actor) => actor.construction && ready(actor))
      .map((actor) => actor.id),
  );
  // Work without a headquarters, such as ARC construction until queues per
  // Command Center exist, shares one slot per owner.
  const used = {
    headquarters: new Map<string, number>(),
    owner: new Map<string, number>(),
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
    if (!eligible.has(building.id)) {
      delete construction.active;
      continue;
    }
    const headquarters = byId.get(construction.headquartersId ?? "");
    const [queues, queue] = headquarters
      ? [used.headquarters, headquarters.id]
      : [used.owner, building.owner];
    const capacity = headquarters
      ? (definitions.get(headquarters.definitionId)?.infrastructure?.slots ?? 1)
      : 1;
    const count = queues.get(queue) ?? 0;
    if (count >= capacity) {
      delete construction.active;
      continue;
    }
    queues.set(queue, count + 1);
    construction.active = true;
    construction.completedTicks += 1;
    if (construction.completedTicks >= construction.totalTicks) {
      delete building.construction;
      const worker = economy.cultivation?.workers.find(
        (worker) => worker.tendingId === building.id,
      );
      if (worker) {
        delete worker.tendingId;
        worker.phase = "idle";
      }
    }
  }
}
export function validateGrowthDefinitions(
  definitions: ReadonlyMap<string, ActorDefinition>,
) {
  const invalid = (definition: ActorDefinition) => {
    throw new RangeError(`Invalid growth definition: ${definition.id}.`);
  };
  for (const definition of definitions.values()) {
    if (
      definition.infrastructure &&
      (!definition.footprint ||
        !isCount(definition.infrastructure.slots) ||
        !definition.infrastructure.slots)
    )
      return invalid(definition);
    if (
      definition.growth &&
      (!definition.footprint ||
        !definitions.get(definition.growth.workerDefinitionId)?.cultivation ||
        !definitions.get(definition.growth.headquartersDefinitionId)
          ?.infrastructure)
    )
      return invalid(definition);
  }
}
/** Relationship changes can leave a saved queue ineligible until reassigned. */
export function validateGrowth(
  actors: readonly Actor[],
  definitions: ReadonlyMap<string, ActorDefinition>,
) {
  const invalid = () => {
    throw new RangeError("Mission has invalid growth state.");
  };
  for (const actor of actors) {
    const construction = actor.construction;
    if (!construction) continue;
    if (
      construction.active !== undefined &&
      typeof construction.active !== "boolean"
    )
      return invalid();
    const definition = definitions.get(actor.definitionId)!;
    if (
      construction.headquartersId !== undefined &&
      (!definition.growth ||
        !actors.some(
          (headquarters) =>
            headquarters.id === construction.headquartersId &&
            hostsGrowth(headquarters, actor, definitions, () => true),
        ))
    )
      return invalid();
  }
}
