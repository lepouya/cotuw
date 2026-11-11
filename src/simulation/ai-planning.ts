// Faction-neutral reading and ordering helpers for director concerns.
import { compareIds, trainsArmy } from "./actor";
import { secondsToTicks } from "./clock";
import { tileKey } from "./grid";
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
/** Checks need an ID; real IDs are spent only on issued orders. */
const PROBE_ID = "ai-probe";

export type Building = ActorRenderState & {
  tilePlacement: NonNullable<ActorRenderState["tilePlacement"]>;
};

export const definitionOf = (
  context: AiConcernContext,
  actor: Pick<ActorRenderState, "definitionId">,
) => context.definitions.get(actor.definitionId)!;

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
 * The valid origin nearest `anchor` whose footprint keeps a clear tile from
 * other buildings and sites, so routes and exits stay open.
 */
export function findPlacement(
  context: AiConcernContext,
  terrain: TerrainView,
  definition: ActorDefinition,
  anchor: WorldPosition,
): TileCoord | undefined {
  const point = clampToBounds(anchor, terrain.worldBounds);
  const center = terrain.tileAtWorldPosition(point.x, point.z);
  const reserved = reservedTiles(context);
  for (const offset of PLACEMENT_OFFSETS) {
    const origin = { x: center.x + offset.x, z: center.z + offset.z };
    const tiles = definition.footprint!.occupiedTiles.map(({ x, z }) => ({
      x: origin.x + x,
      z: origin.z + z,
    }));
    if (
      tiles.some(
        (tile) =>
          !terrain.containsTile(tile.x, tile.z) || reserved.has(tileKey(tile)),
      )
    )
      continue;
    const evaluation = context.view.evaluatePlacement({
      actorId: PROBE_ID,
      definitionId: definition.id,
      origin,
    });
    if (evaluation.accepted) return origin;
  }
}

/** Places a building near `anchor` when funds and a valid site allow. */
export function place(
  context: AiConcernContext,
  terrain: TerrainView,
  definition: ActorDefinition,
  anchor: WorldPosition,
) {
  if (!affords(context, definition)) return false;
  const origin = findPlacement(context, terrain, definition, anchor);
  return (
    !!origin &&
    context.issue({
      kind: "place-actor",
      actorId: context.newActorId(definition.id),
      definitionId: definition.id,
      origin,
    })
  );
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
  const command = {
    kind: "train-unit" as const,
    producerId: producer.id,
    actorId: PROBE_ID,
    definitionId: definition.id,
  };
  if (!context.view.evaluateTraining(command).accepted) return;
  const actorId = context.newActorId(definition.id);
  return context.issue({ ...command, actorId }) ? actorId : undefined;
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
