import {
  clearCombatOrders,
  compareIds,
  healthOf,
  insideRouteBounds,
  isSupportUnit,
  nearestTo,
  RECOVERY_KINDS,
  restoreHealth,
} from "./actor";
import { followRoute, isRouteRetryState } from "./automatic-movement";
import {
  distance,
  facingToward,
  isPositionWithin,
  samePosition,
} from "./world";
import {
  isCount,
  isId,
  isIdList,
  isOneOf,
  isPositive,
  isRecord,
} from "./validation";
import type {
  Actor,
  ActorDefinition,
  ActorRenderState,
  Restoration,
  RouteBounds,
} from "./actor";
import type { WorldBounds, WorldPosition } from "./world";

export type ServiceReason =
  | "invalid-provider"
  | "invalid-service-target"
  | "undamaged"
  | "target-busy"
  | "out-of-range";

type Definitions = ReadonlyMap<string, ActorDefinition>;

export type ServiceActivity = { providerId: string; targetId: string };

/** Current work from committed state; pursuit and blocked orders are silent. */
export function activeUnitServices(
  actors: readonly ActorRenderState[],
  definitions: Definitions,
): ServiceActivity[] {
  const byId = new Map(actors.map((actor) => [actor.id, actor]));
  return actors.flatMap((provider) => {
    const order = provider.service;
    const target = order && byId.get(order.targetId);
    return target &&
      !provider.movement &&
      !order.blocked &&
      canService(provider, target, definitions) &&
      distance(provider.worldPosition, target.worldPosition) <=
        serviceReach(provider, target, definitions)
      ? [{ providerId: provider.id, targetId: target.id }]
      : [];
  });
}

/** Whether a surviving unit can receive this provider's service. */
function serviceable(
  provider: ActorRenderState,
  target: ActorRenderState,
  definitions: Definitions,
): boolean {
  const restoration = definitions.get(provider.definitionId)?.restoration;
  const kind = definitions.get(target.definitionId)?.recoveryKind;
  return (
    !!restoration &&
    !!kind &&
    restoration.targetKinds.includes(kind) &&
    target.id !== provider.id &&
    target.owner === provider.owner &&
    target.occupancyLayer === provider.occupancyLayer
  );
}

const damaged = (target: ActorRenderState, definitions: Definitions) => {
  const maximum = definitions.get(target.definitionId)?.health;
  return !!maximum && healthOf(target, maximum) < maximum;
};

/** Pursuit stays within this circle around where service began. */
const pursuitBounds = (
  origin: WorldPosition,
  restoration: Restoration,
): RouteBounds => ({ center: origin, radius: restoration.pursuitRadius });

/** Admission preserves the provider's current order on rejection. */
export function serviceRejection(
  provider: ActorRenderState | undefined,
  target: ActorRenderState | undefined,
  definitions: Definitions,
  actors: readonly ActorRenderState[],
): ServiceReason | undefined {
  const restoration =
    provider && definitions.get(provider.definitionId)?.restoration;
  if (!provider || !restoration) return "invalid-provider";
  if (!target || !serviceable(provider, target, definitions))
    return "invalid-service-target";
  if (!damaged(target, definitions)) return "undamaged";
  if (
    actors.some(
      (actor) =>
        actor.id !== provider.id && actor.service?.targetId === target.id,
    )
  )
    return "target-busy";
  if (
    distance(provider.worldPosition, target.worldPosition) >
    restoration.pursuitRadius
  )
    return "out-of-range";
  return undefined;
}

/** Restoration reaches from the provider's center to the target's edge. */
const serviceReach = (
  provider: ActorRenderState,
  target: ActorRenderState,
  definitions: Definitions,
) =>
  definitions.get(provider.definitionId)!.restoration!.range +
  (definitions.get(target.definitionId)!.movement?.radius ?? 0);

/** Whether the target needs recovery this provider can supply. */
const canService = (
  provider: ActorRenderState,
  target: ActorRenderState,
  definitions: Definitions,
) => serviceable(provider, target, definitions) && damaged(target, definitions);

/**
 * The nearest selected provider admitted to a manual priority, else the
 * nearest one that serves the target, whose rejection explains why.
 */
export function serviceProvider(
  target: ActorRenderState,
  candidates: readonly ActorRenderState[],
  definitions: Definitions,
  actors: readonly ActorRenderState[],
): ActorRenderState | undefined {
  const able = candidates
    .filter((provider) => canService(provider, target, definitions))
    .sort(nearestTo(target.worldPosition));
  return (
    able.find(
      (provider) => !serviceRejection(provider, target, definitions, actors),
    ) ?? able[0]
  );
}

function forgetServiceExclusion(provider: Actor, targetId: string) {
  if (!provider.serviceExcluded) return;
  provider.serviceExcluded = provider.serviceExcluded.filter(
    (entry) => entry.targetId !== targetId,
  );
  if (!provider.serviceExcluded.length) delete provider.serviceExcluded;
}

/** Replaces the provider's current order with service from where it stands. */
export function startService(
  provider: Actor,
  targetId: string,
  manual = false,
) {
  clearCombatOrders(provider);
  delete provider.movement;
  delete provider.serviceResumeTick;
  if (manual) forgetServiceExclusion(provider, targetId);
  provider.service = {
    targetId,
    origin: { ...provider.worldPosition },
    ...(manual && { manual: true }),
  };
}

/** Contact correction keeps servicing providers inside their pursuit bounds. */
export function serviceAllows(
  actor: Actor,
  definition: ActorDefinition,
  point: WorldPosition,
): boolean {
  return (
    !actor.service ||
    insideRouteBounds(
      pursuitBounds(actor.service.origin, definition.restoration!),
      point,
    )
  );
}

export function validateRestorationDefinition(definition: ActorDefinition) {
  const { recoveryKind, restoration } = definition;
  if (
    recoveryKind !== undefined &&
    (!isOneOf(RECOVERY_KINDS, recoveryKind) ||
      !definition.movement ||
      !definition.health ||
      !!definition.footprint)
  )
    throw new RangeError(
      `Actor definition ${definition.id} has an invalid recovery kind.`,
    );
  if (restoration === undefined) return;
  const kinds = isRecord(restoration) ? restoration.targetKinds : undefined;
  if (
    !isIdList(kinds) ||
    !kinds.length ||
    !kinds.every((kind) => isOneOf(RECOVERY_KINDS, kind)) ||
    !definition.movement ||
    !!definition.footprint ||
    !!definition.weapon ||
    !!definition.harvesting ||
    !!definition.cultivation ||
    !isPositive(restoration.range) ||
    !isPositive(restoration.acquisitionRadius) ||
    !isPositive(restoration.pursuitRadius) ||
    !isPositive(restoration.healthPerSecond) ||
    restoration.range > restoration.acquisitionRadius ||
    restoration.acquisitionRadius > restoration.pursuitRadius
  )
    throw new RangeError(
      `Actor definition ${definition.id} has invalid restoration rules.`,
    );
}

export function validateServiceActor(
  actor: Actor,
  definition: ActorDefinition,
  bounds: WorldBounds,
  tick: number,
) {
  const point = (value: unknown) => isPositionWithin(value, bounds);
  const { service, serviceExcluded: excluded, serviceResumeTick } = actor;
  if (
    (service !== undefined ||
      excluded !== undefined ||
      serviceResumeTick !== undefined) &&
    !isSupportUnit(definition)
  )
    throw new RangeError(`Actor ${actor.id} cannot provide unit support.`);
  if (
    service !== undefined &&
    (!isRecord(service) ||
      !isId(service.targetId) ||
      service.targetId === actor.id ||
      !point(service.origin) ||
      (service.manual !== undefined && service.manual !== true) ||
      !isRouteRetryState(service, bounds))
  )
    throw new RangeError(`Actor ${actor.id} has invalid service state.`);
  if (service) {
    const movement = actor.movement;
    const routeBounds = movement?.bounds;
    if (
      !serviceAllows(actor, definition, actor.worldPosition) ||
      !!actor.attackMove ||
      serviceResumeTick !== undefined ||
      (service.blocked !== undefined && movement !== undefined) ||
      (movement !== undefined &&
        (!routeBounds ||
          !samePosition(routeBounds.center, service.origin) ||
          routeBounds.radius !== definition.restoration!.pursuitRadius))
    )
      throw new RangeError(
        `Actor ${actor.id} has conflicting service orders or route bounds.`,
      );
  }
  if (
    excluded !== undefined &&
    (!Array.isArray(excluded) ||
      !excluded.length ||
      !Array.from(excluded).every(
        (entry) =>
          isRecord(entry) &&
          isId(entry.targetId) &&
          entry.targetId !== actor.id &&
          point(entry.origin),
      ) ||
      new Set(excluded.map(({ targetId }) => targetId)).size !==
        excluded.length)
  )
    throw new RangeError(`Actor ${actor.id} has invalid service exclusions.`);
  if (
    serviceResumeTick !== undefined &&
    (!isCount(serviceResumeTick) || serviceResumeTick > tick + 1)
  )
    throw new RangeError(`Actor ${actor.id} has invalid service timing.`);
}

/** Combat resolves deaths first; surviving units recover before movement. */
export function updateUnitSupport(world: {
  actors: Actor[];
  definitions: Definitions;
  tick: number;
  tickSeconds: number;
  navigationVersion: number;
  move: (actor: Actor, point: WorldPosition, bounds: RouteBounds) => boolean;
  destination: (
    actor: Actor,
    point: WorldPosition,
    bounds: RouteBounds,
  ) => WorldPosition | undefined;
}) {
  const { actors, definitions } = world;
  const providers = actors
    .filter((actor) => isSupportUnit(definitions.get(actor.definitionId)!))
    .sort((a, b) => compareIds(a.id, b.id));
  if (!providers.length) return;
  const byId = new Map(actors.map((actor) => [actor.id, actor]));
  const rulesOf = (provider: Actor) =>
    definitions.get(provider.definitionId)!.restoration!;
  const end = (provider: Actor) => {
    delete provider.service;
    delete provider.movement;
  };
  // Release invalid claims before any provider acquires a new target.
  for (const provider of providers) {
    const rules = rulesOf(provider);
    if (provider.serviceExcluded) {
      provider.serviceExcluded = provider.serviceExcluded.filter(
        ({ targetId, origin }) => {
          const target = byId.get(targetId);
          return (
            !!target &&
            damaged(target, definitions) &&
            distance(origin, target.worldPosition) > rules.acquisitionRadius
          );
        },
      );
      if (!provider.serviceExcluded.length) delete provider.serviceExcluded;
    }
    const order = provider.service;
    if (!order) continue;
    const target = byId.get(order.targetId);
    if (!target || !canService(provider, target, definitions)) {
      end(provider);
      continue;
    }
    if (distance(order.origin, target.worldPosition) > rules.pursuitRadius) {
      const excluded = (provider.serviceExcluded ??= []);
      if (!excluded.some(({ targetId }) => targetId === target.id))
        excluded.push({ targetId: target.id, origin: { ...order.origin } });
      end(provider);
    }
  }
  const claimed = new Set(
    providers.flatMap((actor) =>
      actor.service ? [actor.service.targetId] : [],
    ),
  );
  for (const provider of providers) {
    const rules = rulesOf(provider);
    if (provider.serviceResumeTick !== undefined) {
      if (world.tick < provider.serviceResumeTick) continue;
      delete provider.serviceResumeTick;
    }
    if (!provider.service) {
      if (provider.movement || provider.attackMove || provider.orders) continue;
      const target = actors
        .filter(
          (target) =>
            !claimed.has(target.id) &&
            canService(provider, target, definitions) &&
            !provider.serviceExcluded?.some(
              ({ targetId }) => targetId === target.id,
            ) &&
            distance(provider.worldPosition, target.worldPosition) <=
              rules.acquisitionRadius,
        )
        .sort(nearestTo(provider.worldPosition))[0];
      if (!target) continue;
      startService(provider, target.id);
      claimed.add(target.id);
    }
    const order = provider.service!;
    const target = byId.get(order.targetId)!;
    const targetDefinition = definitions.get(target.definitionId)!;
    const reach = serviceReach(provider, target, definitions);
    if (distance(provider.worldPosition, target.worldPosition) <= reach) {
      delete provider.movement;
      delete order.blocked;
      provider.facing = facingToward(
        provider.worldPosition,
        target.worldPosition,
      );
      if (
        restoreHealth(
          target,
          targetDefinition.health!,
          rules.healthPerSecond * world.tickSeconds,
        )
      ) {
        end(provider);
        // Next-tick damage must not preserve a completed recovery's exclusion.
        for (const other of providers) forgetServiceExclusion(other, target.id);
      }
      continue;
    }
    const bounds = pursuitBounds(order.origin, rules);
    followRoute(provider, target.worldPosition, order, {
      navigationVersion: world.navigationVersion,
      // A route must end within reach, or service waits as blocked.
      move: (actor, goal) => {
        const point = world.destination(actor, goal, bounds);
        return (
          !!point &&
          insideRouteBounds(bounds, point) &&
          distance(point, goal) <= reach &&
          world.move(actor, goal, bounds)
        );
      },
    });
  }
}

/** Saved claims stay exclusive and reference known units, including losses. */
export function validateServiceReferences(
  actors: readonly Actor[],
  retiredIds: readonly string[],
  definitions: Definitions,
) {
  const byId = new Map(actors.map((actor) => [actor.id, actor]));
  const known = new Set([...byId.keys(), ...retiredIds]);
  const claimed = new Set<string>();
  for (const provider of actors) {
    for (const entry of provider.serviceExcluded ?? [])
      if (!known.has(entry.targetId))
        throw new RangeError(
          `Actor ${provider.id} excludes an unknown service target.`,
        );
    const order = provider.service;
    if (!order) continue;
    const target = byId.get(order.targetId);
    if (
      !known.has(order.targetId) ||
      claimed.has(order.targetId) ||
      (target && !serviceable(provider, target, definitions))
    )
      throw new RangeError(
        `Actor ${provider.id} has an invalid service target.`,
      );
    claimed.add(order.targetId);
  }
}
