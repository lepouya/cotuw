import { withinBounds } from "./world";
import type { WorldBounds } from "./world";
import { createActor } from "./actor";
import { tileKey } from "./grid";
import { isId } from "./validation";
import {
  adjacentTiles,
  isTilePlacedActor,
  mobileActorTiles,
  occupiedTilesFor,
} from "./placement";

import type { Actor, ActorBehavior, ActorDefinition } from "./actor";
import type { TrainUnitCommand } from "./command";
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
  usedIds: ReadonlySet<string>;
  definitions: ReadonlyMap<string, ActorDefinition>;
  canStandAt: (unit: ActorDefinition, tile: TileCoord) => boolean;
  map?: TerrainView;
  occupancy?: OccupancyView;
  bounds: WorldBounds;
};

/** Checks the staged tick's world, including units trained earlier that tick. */
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
