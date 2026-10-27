import { nearestTo } from "./actor";
import {
  advanceWorkerRoute,
  routeTarget,
  workerNavigation,
} from "./worker-navigation";
import type { Actor, ActorDefinition, ActorRenderState } from "./actor";
import type { EconomyState, EconomyWorld } from "./economy";

type Ref = Pick<ActorRenderState, "id" | "definitionId" | "owner">;
/** A building, or a prospective one, and the owner it would belong to. */
type GrowthSite = Pick<ActorRenderState, "definitionId" | "owner">;

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
/** Moves the building's tending worker; true once it has arrived. */
export function growthReady(
  building: Actor,
  economy: EconomyState,
  world: EconomyWorld,
) {
  const tenderId = economy.cultivation?.workers.find(
    (worker) => worker.tendingId === building.id,
  )?.actorId;
  const actor = world.actors.find(({ id }) => id === tenderId);
  if (!actor) return false;
  const point =
    routeTarget(actor) ?? workerNavigation(world).entrance(actor, building);
  return (
    !!point &&
    advanceWorkerRoute(actor, point, world, world.map.tileSize * 0.75) ===
      "arrived"
  );
}
/** Completed growth frees its tending worker. */
export function releaseTender(economy: EconomyState, buildingId: string) {
  const worker = economy.cultivation?.workers.find(
    (worker) => worker.tendingId === buildingId,
  );
  if (!worker) return;
  delete worker.tendingId;
  worker.phase = "idle";
}
export function validateGrowthDefinitions(
  definitions: ReadonlyMap<string, ActorDefinition>,
) {
  for (const definition of definitions.values())
    if (
      definition.growth &&
      (!definition.footprint ||
        !definitions.get(definition.growth.workerDefinitionId)?.cultivation ||
        !definitions.get(definition.growth.headquartersDefinitionId)
          ?.infrastructure)
    )
      throw new RangeError(`Invalid growth definition: ${definition.id}.`);
}
