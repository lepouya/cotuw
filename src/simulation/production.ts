import { withinBounds } from "./world";
import type { WorldBounds } from "./world";
import { createActor } from "./actor";
import { secondsToTicks } from "./clock";
import { tileKey } from "./grid";
import { costAmount } from "./resources";
import { canAfford } from "./stockpiles";
import { isCount, isId } from "./validation";
import {
  adjacentTiles,
  isTilePlacedActor,
  mobileActorTiles,
  occupiedTilesFor,
} from "./placement";

import type { Actor, ActorBehavior, ActorDefinition } from "./actor";
import type { TrainUnitCommand } from "./command";
import type { EconomyState, EconomyView } from "./economy";
import type { TileCoord } from "./grid";
import type { OccupancyView } from "./occupancy";
import type { TerrainView } from "./terrain";

export type TrainingReason =
  | "invalid-actor"
  | "used-id"
  | "missing-producer"
  | "unsupported-unit"
  | "exit-blocked"
  | "insufficient-resources"
  | "refinery-occupied"
  | "queue-full"
  | "under-construction"
  | "disconnected";

/** A produced unit leaves, or a Harvester delivers cargo. */
export const BUILDING_ACTIVITY_KINDS = ["exit", "delivery"] as const;
export type BuildingActivityKind = (typeof BUILDING_ACTIVITY_KINDS)[number];

/** Committed activity shared by visual, audio, and future presentation. */
export type BuildingActivity = {
  buildingId: string;
  kind: BuildingActivityKind;
  /** The produced unit or delivering Harvester. */
  actorId?: string;
};

export type TrainingEvaluation =
  | { accepted: true; actor: Actor }
  | { accepted: true; queued: true }
  | { accepted: false; reason: TrainingReason };

/** Units a currently deployed production building can train. */
export function trainableUnitIds(
  actor: Pick<Actor, "definitionId" | "tilePlacement"> | undefined,
  definitions: ReadonlyMap<string, ActorDefinition>,
): readonly string[] {
  return actor && isTilePlacedActor(actor)
    ? (definitions.get(actor.definitionId)?.production?.unitDefinitionIds ?? [])
    : [];
}

export function validateProductionDefinitions(
  definitions: ReadonlyMap<string, ActorDefinition>,
  behaviors: ReadonlyMap<string, ActorBehavior>,
  map?: TerrainView,
): void {
  for (const definition of definitions.values()) {
    if (!definition.production) continue;
    const units = definition.production.unitDefinitionIds;
    if (
      !map ||
      definition.footprint?.layer !== "surface" ||
      units.length === 0 ||
      new Set(units).size !== units.length
    ) {
      throw new RangeError(`Invalid production definition: ${definition.id}.`);
    }
    for (const id of units) {
      const unit = definitions.get(id);
      if (
        !unit?.movement ||
        unit.footprint ||
        !behaviors.get(unit.behaviorId)?.canStandAt
      ) {
        throw new RangeError(`Invalid production unit: ${id}.`);
      }
    }
  }
}

export type ProductionWorld = {
  actors: readonly Actor[];
  usedIds: Pick<ReadonlySet<string>, "has">;
  definitions: ReadonlyMap<string, ActorDefinition>;
  canStandAt: (unit: ActorDefinition, tile: TileCoord) => boolean;
  map?: TerrainView;
  occupancy?: OccupancyView;
  bounds: WorldBounds;
};

/** Checks the staged world, including units trained earlier in the tick. */
export function evaluateTraining(
  command: TrainUnitCommand,
  {
    actors,
    usedIds,
    definitions,
    canStandAt,
    map,
    occupancy,
    bounds,
  }: ProductionWorld,
): TrainingEvaluation {
  const reject = (reason: TrainingReason): TrainingEvaluation => ({
    accepted: false,
    reason,
  });
  if (!isId(command.actorId)) return reject("invalid-actor");
  if (usedIds.has(command.actorId)) return reject("used-id");
  const producer = actors.find(({ id }) => id === command.producerId);
  if (!producer || !isTilePlacedActor(producer))
    return reject("missing-producer");
  if (producer.construction) return reject("under-construction");
  const definition = definitions.get(producer.definitionId)!;
  const unit = definitions.get(command.definitionId);
  if (
    !map ||
    !occupancy ||
    !definition.production?.unitDefinitionIds.includes(command.definitionId) ||
    !unit
  )
    return reject("unsupported-unit");

  const unitTiles = mobileActorTiles(map, actors, "surface");
  const frontX = Math.round(Math.sin(producer.facing));
  const frontZ = Math.round(Math.cos(producer.facing));
  // Prefer the entrance side, then distance to the center, then tile order.
  const front = (tile: TileCoord) => tile.x * frontX + tile.z * frontZ;
  const distance = (tile: TileCoord) => {
    const position = map.tileCenter(tile.x, tile.z);
    return (
      (position.x - producer.worldPosition.x) ** 2 +
      (position.z - producer.worldPosition.z) ** 2
    );
  };
  const tiles = adjacentTiles(map, occupiedTilesFor(producer, definition)).sort(
    (a, b) =>
      front(b) - front(a) ||
      distance(a) - distance(b) ||
      a.z - b.z ||
      a.x - b.x,
  );
  for (const tile of tiles) {
    const position = map.tileCenter(tile.x, tile.z);
    if (
      !withinBounds(position, bounds) ||
      !canStandAt(unit, tile) ||
      occupancy.ownerAt(tile.x, tile.z, "surface") !== undefined ||
      unitTiles.has(tileKey(tile))
    )
      continue;
    return {
      accepted: true,
      actor: createActor({
        id: command.actorId,
        definitionId: unit.id,
        owner: producer.owner,
        worldPosition: position,
        facing: producer.facing,
      }),
    };
  }
  return reject("exit-blocked");
}

/** A paid order; only the first order for each producer advances. */
export type ProductionJob = {
  actorId: string;
  producerId: string;
  definitionId: string;
  paidCost: number;
  completedTicks: number;
  totalTicks: number;
  exitBlocked: boolean;
};

/** Outstanding paid orders one producer may hold. */
export const PRODUCTION_QUEUE_LIMIT = 5;

type Queues = Pick<EconomyView, "harvesters" | "production">;

/** A Refinery holds one Harvester, fielded or paid. */
export function refineryOccupied(economy: Queues, refineryId: string) {
  return (
    economy.harvesters.some((worker) => worker.refineryId === refineryId) ||
    economy.production.some((job) => job.producerId === refineryId)
  );
}

/** Why a paid order cannot join the producer's queue, if anything. */
export function productionRejection(
  economy: EconomyView,
  producer: Pick<Actor, "id" | "owner">,
  unit: ActorDefinition,
): TrainingReason | undefined {
  if (!canAfford(economy, producer.owner, unit))
    return "insufficient-resources";
  if (
    economy.production.filter((job) => job.producerId === producer.id).length >=
    PRODUCTION_QUEUE_LIMIT
  )
    return "queue-full";
  if (unit.harvesting && refineryOccupied(economy, producer.id))
    return "refinery-occupied";
  return undefined;
}

export function createProductionJob(
  { actorId, producerId }: Pick<TrainUnitCommand, "actorId" | "producerId">,
  unit: ActorDefinition,
  paidCost: number,
  tickSeconds: number,
): ProductionJob {
  return {
    actorId,
    producerId,
    definitionId: unit.id,
    paidCost,
    completedTicks: 0,
    totalTicks: secondsToTicks(unit.trainingSeconds, tickSeconds),
    exitBlocked: false,
  };
}

/**
 * Advances each unpaused producer's first order in producer-ID order. A
 * finished order leaves its queue once its unit has an exit; otherwise it
 * waits with `exitBlocked` set.
 */
export function advanceProduction(
  production: ProductionJob[],
  {
    paused,
    evaluateSpawn,
    spawn,
  }: {
    paused: (producerId: string) => boolean;
    evaluateSpawn: (job: ProductionJob) => TrainingEvaluation;
    spawn: (job: ProductionJob, actor: Actor) => void;
  },
) {
  const producers = [...new Set(production.map((job) => job.producerId))];
  for (const id of producers.sort()) {
    if (paused(id)) continue;
    const job = production.find((job) => job.producerId === id)!;
    if (job.completedTicks < job.totalTicks) job.completedTicks += 1;
    if (job.completedTicks < job.totalTicks) continue;
    const result = evaluateSpawn(job);
    job.exitBlocked = !result.accepted;
    if (!("actor" in result)) continue;
    production.splice(production.indexOf(job), 1);
    spawn(job, result.actor);
  }
}

/** Removes a cancelled order and returns it for its refund. */
export function cancelProduction(
  production: ProductionJob[],
  actorId: string,
): ProductionJob | undefined {
  const index = production.findIndex((job) => job.actorId === actorId);
  return index < 0 ? undefined : production.splice(index, 1)[0];
}

/** A lost producer loses its paid orders without refunds. */
export function removeProducer(
  economy: Pick<EconomyState, "production">,
  producerId: string,
  retire: (actorId: string) => void,
) {
  for (const job of economy.production)
    if (job.producerId === producerId) retire(job.actorId);
  economy.production = economy.production.filter(
    (job) => job.producerId !== producerId,
  );
}

/**
 * Whether saved orders match their producers, costs, and timings, and each
 * reserves an ID no actor, retired actor, or other order uses.
 */
export function isValidProductionQueue(
  economy: Queues,
  {
    actors,
    retiredIds,
    definitions,
    tickSeconds,
  }: {
    actors: ReadonlyMap<string, Actor>;
    retiredIds: readonly string[];
    definitions: ReadonlyMap<string, ActorDefinition>;
    tickSeconds: number;
  },
): boolean {
  const ids = new Set([...actors.keys(), ...retiredIds]);
  const queues = new Map<string, number>();
  const refineries = new Set(
    economy.harvesters.flatMap(({ refineryId }) => refineryId ?? []),
  );
  for (const job of economy.production) {
    const producer = actors.get(job?.producerId);
    const unit = job && definitions.get(job.definitionId);
    const trains = producer && definitions.get(producer.definitionId);
    if (
      !producer ||
      producer.construction !== undefined ||
      !unit ||
      !isId(job.actorId) ||
      ids.has(job.actorId) ||
      !trains?.production?.unitDefinitionIds.includes(unit.id) ||
      job.paidCost !== costAmount(unit) ||
      !isCount(job.completedTicks) ||
      job.totalTicks !== secondsToTicks(unit.trainingSeconds, tickSeconds) ||
      job.completedTicks > job.totalTicks ||
      typeof job.exitBlocked !== "boolean"
    )
      return false;
    ids.add(job.actorId);
    const count = (queues.get(job.producerId) ?? 0) + 1;
    if (count > PRODUCTION_QUEUE_LIMIT) return false;
    queues.set(job.producerId, count);
    if (unit.harvesting) {
      if (
        refineries.has(job.producerId) ||
        trains.refinery?.harvesterDefinitionId !== unit.id
      )
        return false;
      refineries.add(job.producerId);
    }
  }
  return true;
}
