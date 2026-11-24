// Faction-neutral reading and ordering helpers for director concerns.
import { compareIds, isWorkerDefinition, trainsArmy } from "./actor";
import { secondsToTicks } from "./clock";
import { rotateOffset, tileKey } from "./grid";
import { rosterIncludes } from "./ownership";
import { occupiedTilesFor } from "./placement";
import { costAmount, costResource } from "./resources";
import { isCount, isRecord } from "./validation";
import { clampToBounds, distance, isFinitePosition } from "./world";

import type { ActorDefinition, ActorRenderState } from "./actor";
import type { AiConcernContext } from "./director";
import type { TileCoord } from "./grid";
import type { Resource } from "./resources";
import type { TerrainView } from "./terrain";
import type { WorldPosition } from "./world";

/** Tiles searched around a placement anchor. */
const PLACEMENT_RADIUS = 7;
/** Candidate offsets nearest first; ties keep row-major order. */
const PLACEMENT_OFFSETS: readonly TileCoord[] = Array.from(
  { length: (2 * PLACEMENT_RADIUS + 1) ** 2 },
  (_, index) => ({
    x: (index % (2 * PLACEMENT_RADIUS + 1)) - PLACEMENT_RADIUS,
    z: Math.floor(index / (2 * PLACEMENT_RADIUS + 1)) - PLACEMENT_RADIUS,
  }),
).sort((a, b) => a.x * a.x + a.z * a.z - (b.x * b.x + b.z * b.z));

export type Building = ActorRenderState & {
  tilePlacement: NonNullable<ActorRenderState["tilePlacement"]>;
};

export const definitionOf = (
  context: AiConcernContext,
  actor: Pick<ActorRenderState, "definitionId">,
) => context.definitions.get(actor.definitionId)!;

/** A support provider is free to reposition between assignments. */
export const idleProvider = (actor: ActorRenderState) =>
  !actor.movement && !actor.service && !actor.orders?.length;

/** Own buildings, in ID order, including unfinished ones. */
export const ownBuildings = (
  context: AiConcernContext,
  matches: (definition: ActorDefinition) => boolean,
) =>
  context.view
    .actors()
    .own.filter(
      (actor): actor is Building =>
        !!actor.tilePlacement && matches(definitionOf(context, actor)),
    )
    .sort((a, b) => compareIds(a.id, b.id));

/** Buildings the owner's roster offers, in content order. */
export const rosterBuildings = (
  context: AiConcernContext,
  matches: (definition: ActorDefinition) => boolean,
) =>
  [...context.definitions.values()].filter(
    (definition) =>
      !!definition.footprint &&
      rosterIncludes(context.view.faction, definition) &&
      matches(definition),
  );

/** The first completed headquarters by ID. */
export const headquarters = (context: AiConcernContext) =>
  ownBuildings(context, (definition) => !!definition.infrastructure).find(
    (building) => !building.construction,
  );

/** Not cut off from support. Plans count offline buildings as lost. */
export const isOnline = (context: AiConcernContext, building: Building) =>
  !context.view.offlineIds().has(building.id);

/** Completed and supported, so it can produce or receive deliveries. */
export const isUsable = (context: AiConcernContext, building: Building) =>
  !building.construction && isOnline(context, building);

/** Own usable buildings, in ID order. */
export const usableBuildings = (
  context: AiConcernContext,
  matches: (definition: ActorDefinition) => boolean,
) =>
  ownBuildings(context, matches).filter((building) =>
    isUsable(context, building),
  );

/** Buildings that only extend support. */
export const isRelay = (definition: ActorDefinition) =>
  !!definition.support &&
  !definition.support.root &&
  !definition.infrastructure &&
  !definition.production &&
  !definition.refinery &&
  !definition.cultivationDropoff &&
  !definition.weapon;

/** Armed buildings. */
export const isStaticDefense = (definition: ActorDefinition) =>
  !!definition.footprint && !!definition.weapon;

/** Postures that build only the essential base, before growing it. */
export const isRestoring = ({ posture }: Pick<AiConcernContext, "posture">) =>
  posture === "establishing" || posture === "recovering";

/** Postures that take on new sites and producers. */
export const isGrowing = ({ posture }: Pick<AiConcernContext, "posture">) =>
  posture === "developing" || posture === "pressuring";

/** Own completed support nodes linked to a root. */
export const connectedNodes = (context: AiConcernContext) =>
  (context.view.support()?.nodes ?? []).filter(
    (node) =>
      node.owner === context.view.owner && node.complete && node.connected,
  );

/** The worker trained by a Materials Refinery. */
export const harvesterOf = (
  context: AiConcernContext,
  refinery: ActorDefinition,
) => context.definitions.get(refinery.refinery!.harvesterDefinitionId)!;

/**
 * Sighted sites the given workers, by default the roster's, can gather, at
 * their last-seen state, nearest to `point` first. Exhausted Materials sites
 * are left out; renewable sites never run out. Gather orders need explored
 * sites, so unscouted sites wait for scouting.
 */
export function sitesNear(
  context: AiConcernContext,
  point: WorldPosition,
  workers: readonly ActorDefinition[] = [
    ...context.definitions.values(),
  ].filter(
    (definition) =>
      rosterIncludes(context.view.faction, definition) &&
      isWorkerDefinition(definition),
  ),
) {
  const economy = context.view.economy();
  const located = ({ id, tile }: { id: string; tile: TileCoord }) => ({
    id,
    position: context.terrain!.tileCenter(tile.x, tile.z),
  });
  return [
    ...(workers.some(({ harvesting }) => harvesting)
      ? (economy?.sites ?? [])
          .filter((site) => site.remainingMaterials > 0)
          .map(located)
      : []),
    ...(workers.some(({ cultivation }) => cultivation)
      ? (economy?.cultivation?.sites ?? []).map(located)
      : []),
  ].sort(
    (a, b) =>
      distance(point, a.position) - distance(point, b.position) ||
      compareIds(a.id, b.id),
  );
}

/**
 * Groups sites by authored location, joining sites this many tiles apart, so
 * sightings cannot change a group. Each group keeps ID order and is named by
 * its first site.
 */
export function groupSites<T extends { id: string; tile: TileCoord }>(
  locations: readonly T[],
  tiles: number,
): T[][] {
  const groups: T[][] = [];
  for (const site of [...locations].sort((a, b) => compareIds(a.id, b.id))) {
    const near = groups.filter((group) =>
      group.some(
        ({ tile }) =>
          Math.max(
            Math.abs(tile.x - site.tile.x),
            Math.abs(tile.z - site.tile.z),
          ) <= tiles,
      ),
    );
    const [first, ...rest] = near;
    if (!first) groups.push([site]);
    else {
      first.push(site, ...rest.flat());
      for (const merged of rest) groups.splice(groups.indexOf(merged), 1);
    }
  }
  return groups.map((group) => group.sort((a, b) => compareIds(a.id, b.id)));
}

/** Known hostile buildings, in ID order. */
export const hostileBuildings = (context: AiConcernContext) =>
  context.view.knowledge.observations.actors.filter(
    (sighting) =>
      !!sighting.tilePlacement &&
      context.view.relationTo(sighting) === "hostile",
  );

/** Known armed hostile buildings and recently reported armed units. */
export const knownDefenders = (context: AiConcernContext) =>
  context.view.knowledge.observations.actors.filter(
    (sighting) =>
      (!!sighting.tilePlacement || !isStaleReport(context, sighting.tick)) &&
      context.view.relationTo(sighting) === "hostile" &&
      !!context.definitions.get(sighting.definitionId)?.weapon,
  );

/** Matches definitions that train army units. */
export const armyProducer =
  (context: AiConcernContext) => (definition: ActorDefinition) =>
    trainsArmy(definition, context.definitions);

/** The listed prices added together, by resource. */
export function totalPrice(definitions: readonly ActorDefinition[]) {
  const owed: Partial<Record<Resource, number>> = {};
  for (const definition of definitions) {
    const resource = costResource(definition);
    owed[resource] = (owed[resource] ?? 0) + costAmount(definition);
  }
  return owed;
}

/** Whether the concern's funds cover every listed price together. */
export const affords = (
  context: AiConcernContext,
  ...definitions: ActorDefinition[]
) =>
  Object.entries(totalPrice(definitions)).every(
    ([resource, amount]) => context.funds(resource as Resource) >= amount,
  );

/** Tiles under shown buildings and sites, with a one-tile margin for routes. */
function reservedTiles(context: AiConcernContext) {
  const reserved = new Set<string>();
  const reserve = ({ x, z }: TileCoord) => {
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++)
        reserved.add(tileKey({ x: x + dx, z: z + dz }));
  };
  for (const { id, definitionId, tilePlacement } of context.view.actors()
    .placed)
    if (tilePlacement)
      occupiedTilesFor(
        { id, definitionId, tilePlacement },
        definitionOf(context, { definitionId }),
      ).forEach(reserve);
  for (const site of context.view.knowledge.sites) reserve(site.tile);
  return reserved;
}

/**
 * The turn of the owner's headquarters, or else its earliest building. New
 * buildings and their candidate order share it, so owners on rotated starts
 * place identically relative to their base.
 */
function baseQuarterTurns(context: AiConcernContext) {
  const base = headquarters(context) ?? ownBuildings(context, () => true)[0];
  return base?.tilePlacement.quarterTurns ?? 0;
}

type PlacementSearch = {
  /** Prefer sites nearest this point within the search around the anchor. */
  toward?: WorldPosition;
  /** Restrict the site by the building's actual center. */
  accepts?: (position: WorldPosition) => boolean;
  /** Workers that may tend worker-grown buildings. */
  workerIds?: readonly string[];
};

/**
 * The valid origin nearest `anchor` whose footprint keeps a clear tile from
 * other buildings and sites, so routes and exits stay open. With `toward`,
 * it is instead the valid origin around `anchor` nearest that point.
 */
export function findPlacement(
  context: AiConcernContext,
  terrain: TerrainView,
  definition: ActorDefinition,
  anchor: WorldPosition,
  actorId: string,
  { toward, accepts, workerIds }: PlacementSearch = {},
) {
  const point = clampToBounds(anchor, terrain.worldBounds);
  const center = terrain.tileAtWorldPosition(point.x, point.z);
  const reserved = reservedTiles(context);
  const quarterTurns = baseQuarterTurns(context);
  const originFor = (offset: TileCoord) => {
    const { x, z } = rotateOffset(offset, quarterTurns);
    return { x: center.x + x, z: center.z + z };
  };
  const origins = PLACEMENT_OFFSETS.map(originFor);
  if (toward) {
    const goal = terrain.tileAtWorldPosition(toward.x, toward.z);
    const gap = ({ x, z }: TileCoord) => (x - goal.x) ** 2 + (z - goal.z) ** 2;
    origins.sort((a, b) => gap(a) - gap(b));
  }
  const offsets = definition.footprint!.occupiedTiles.map((offset) =>
    rotateOffset(offset, quarterTurns),
  );
  for (const origin of origins) {
    if (
      offsets.some(({ x, z }) => {
        const tile = { x: origin.x + x, z: origin.z + z };
        return (
          !terrain.containsTile(tile.x, tile.z) || reserved.has(tileKey(tile))
        );
      })
    )
      continue;
    const evaluation = context.view.evaluatePlacement({
      actorId,
      definitionId: definition.id,
      origin,
      quarterTurns,
      ...(workerIds && { workerIds: [...workerIds] }),
    });
    if (
      evaluation.accepted &&
      (!accepts || accepts(evaluation.actor.worldPosition))
    )
      return { origin, quarterTurns, workerId: evaluation.workerId };
  }
}

/** Workers tending now or queued to start tending this tick. */
export function tendingWorkers(context: AiConcernContext) {
  const tending = new Set(
    (context.view.economy()?.cultivation?.workers ?? []).flatMap(
      ({ actorId, tendingId }) => (tendingId ? [actorId] : []),
    ),
  );
  for (const command of context.issuedCommands) {
    if (command.kind === "tend") tending.add(command.actorId);
    if (command.kind === "place-actor")
      for (const id of command.workerIds ?? []) tending.add(id);
  }
  return tending;
}

/** Own workers that can grow `building` and are not tending, in ID order. */
function freeTenders(
  context: AiConcernContext,
  building: ActorDefinition,
): string[] {
  const tending = tendingWorkers(context);
  return context.view
    .actors()
    .ownMobile.filter(
      ({ id, definitionId }) =>
        definitionId === building.growth?.workerDefinitionId &&
        !tending.has(id),
    )
    .map(({ id }) => id)
    .sort(compareIds);
}

/**
 * Gives each own unfinished growth without a tender the nearest free worker
 * that can reach it, in building ID order.
 */
export function tendGrowth(context: AiConcernContext) {
  const workers = context.view.economy()?.cultivation?.workers ?? [];
  const tended = new Set(workers.flatMap(({ tendingId }) => tendingId ?? []));
  for (const building of ownBuildings(
    context,
    (definition) => !!definition.growth,
  )) {
    if (!building.construction || tended.has(building.id)) continue;
    const workerId = context.view.tendWorker(
      building.id,
      freeTenders(context, definitionOf(context, building)),
    );
    if (workerId)
      context.issue({
        kind: "tend",
        actorId: workerId,
        buildingId: building.id,
      });
  }
}

/** When a concern may next search for a building site. */
export type PlacementMemory = { placementRetryTick?: number };

export const isPlacementMemory = (memory: Record<string, unknown>) =>
  memory.placementRetryTick === undefined || isCount(memory.placementRetryTick);

/**
 * Places a building at the first of `anchors` with a valid site when funds
 * allow. Each search scans every candidate, so a placement that finds no site
 * or is refused waits the profile's `placementRetrySeconds`.
 */
export function place(
  context: AiConcernContext,
  memory: PlacementMemory,
  terrain: TerrainView,
  definition: ActorDefinition,
  anchors: WorldPosition | readonly WorldPosition[],
  search?: PlacementSearch,
) {
  if (!affords(context, definition)) return false;
  if (memory.placementRetryTick !== undefined) {
    if (context.tick < memory.placementRetryTick) return false;
    delete memory.placementRetryTick;
  }
  const workerIds = definition.growth
    ? freeTenders(context, definition)
    : undefined;
  if (workerIds && !workerIds.length) return false;
  const actorId = context.newActorId(definition.id);
  for (const anchor of Array.isArray(anchors) ? anchors : [anchors]) {
    const placement = findPlacement(
      context,
      terrain,
      definition,
      anchor,
      actorId,
      { ...search, workerIds },
    );
    if (!placement) continue;
    const { origin, quarterTurns, workerId } = placement;
    if (
      context.issue({
        kind: "place-actor",
        actorId,
        definitionId: definition.id,
        origin,
        ...(quarterTurns && { quarterTurns }),
        ...(workerId && { workerIds: [workerId] }),
      })
    )
      return true;
    break;
  }
  memory.placementRetryTick =
    context.tick +
    secondsToTicks(context.tuning.placementRetrySeconds, context.tickSeconds);
  return false;
}

/**
 * Queues one unit when funds allow and the producer accepts it. Returns the
 * queued unit's ID.
 */
export function train(
  context: AiConcernContext,
  producer: Building,
  definition: ActorDefinition,
): string | undefined {
  if (!affords(context, definition)) return;
  const actorId = context.newActorId(definition.id);
  const command = {
    kind: "train-unit" as const,
    producerId: producer.id,
    actorId,
    definitionId: definition.id,
  };
  if (!context.view.evaluateTraining(command).accepted) return;
  return context.issue(command) ? actorId : undefined;
}

/**
 * A point `tiles` from `from` toward `to`; negative steps lead away. Without
 * `to`, it steps along +z.
 */
export function stepToward(
  terrain: TerrainView,
  from: WorldPosition,
  to: WorldPosition | undefined,
  tiles: number,
): WorldPosition {
  const dx = (to?.x ?? from.x) - from.x;
  const dz = (to?.z ?? from.z + 1) - from.z;
  const length = Math.hypot(dx, dz) || 1;
  const reach = tiles * terrain.tileSize;
  return {
    x: from.x + (dx / length) * reach,
    z: from.z + (dz / length) * reach,
  };
}

/** A place a concern skips for a while, and when it began. */
export type Avoided = WorldPosition & { tick: number };

export const isAvoidedList = (value: unknown) =>
  value === undefined ||
  (Array.isArray(value) &&
    value.every(
      (entry) =>
        isRecord(entry) && isCount(entry.tick) && isFinitePosition(entry),
    ));

/** The entries younger than `lifetime` ticks. */
export const recentAvoided = (
  entries: readonly Avoided[] | undefined,
  tick: number,
  lifetime: number,
) => (entries ?? []).filter((entry) => tick - entry.tick < lifetime);

export const isAvoided = (
  entries: readonly Avoided[],
  position: WorldPosition,
  range: number,
) => entries.some((entry) => distance(entry, position) <= range);

/** The ticks after which a report is stale. */
export const staleReportTicks = (context: AiConcernContext) =>
  secondsToTicks(context.tuning.staleReportSeconds, context.tickSeconds);

/** Whether a report from `tick` is stale; a missing report always is. */
export const isStaleReport = (
  context: AiConcernContext,
  tick: number | undefined,
) => tick === undefined || context.tick - tick >= staleReportTicks(context);
