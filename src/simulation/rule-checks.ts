import { growthCandidates, growthWorkerFor } from "./growth";
import { tileKey } from "./grid";
import {
  headquarteredOwners,
  infrastructureHeadquarters,
  replacesHeadquarters,
} from "./infrastructure";
import {
  createTilePlacedActor,
  evaluateFootprint,
  isValidTilePlacement,
  occupiedTilesFor,
} from "./placement";
import {
  evaluateTraining,
  productionRejection,
  trainableUnitIds,
} from "./production";
import { canAfford } from "./stockpiles";
import {
  disconnectedBuildings,
  ownedCoverage,
  supportsPosition,
} from "./support";
import { isId } from "./validation";
import { isFinitePosition, withinBounds } from "./world";

import type { Actor, ActorBehavior, ActorDefinition } from "./actor";
import type { TrainUnitCommand } from "./command";
import type { EconomyView } from "./economy";
import type { TileCoord } from "./grid";
import type { OccupancyView } from "./occupancy";
import type { Relations } from "./ownership";
import type {
  ActorPlacement,
  PlacementEvaluation,
  PlacementReason,
} from "./placement";
import type { TrainingEvaluation } from "./production";
import type { SupportView } from "./support";
import type { TerrainView } from "./terrain";
import type { WorldBounds, WorldPosition } from "./world";

/** What paid rules consult; a world without it skips payment and support. */
export type RuleEconomy = {
  view: EconomyView;
  support: SupportView;
  /** Keys of tiles buildings must keep clear. */
  resourceTiles: ReadonlySet<string>;
};

/** Query inputs for either a staged command or an owner's advisory preview. */
export type RuleWorld = {
  actors: readonly Actor[];
  usedIds: Pick<ReadonlySet<string>, "has">;
  occupancy?: OccupancyView;
  behaviors: ReadonlyMap<string, ActorBehavior>;
  /** Keys of tiles under building debris. */
  debris?: ReadonlySet<string>;
  economy?: RuleEconomy;
};

export type RuleChecks = ReturnType<typeof createRuleChecks>;

/** Shared rules; callers supply the world their operation may consult. */
export function createRuleChecks({
  definitions,
  map,
  bounds,
  knowsTile,
  relations,
  emergencyHeadquarters,
  validateActor,
}: {
  definitions: ReadonlyMap<string, ActorDefinition>;
  map?: TerrainView;
  bounds: WorldBounds;
  knowsTile: (owner: string, tile: TileCoord) => boolean;
  /** Read per check, since relationships change during a mission. */
  relations: () => Pick<Relations, "sharesHeadquarters" | "sharesSupport">;
  emergencyHeadquarters?: boolean;
  validateActor: (actor: Actor) => void;
}) {
  const canStandAt = (
    behaviors: RuleWorld["behaviors"],
    unit: ActorDefinition,
    tile: TileCoord,
  ) => behaviors.get(unit.behaviorId)!.canStandAt!(unit, tile);

  const placement = (
    request: ActorPlacement,
    owner: string,
    { actors, usedIds, occupancy, behaviors, debris, economy }: RuleWorld,
  ): PlacementEvaluation => {
    const reject = (
      reason: PlacementReason,
      tiles: TileCoord[] = [],
    ): PlacementEvaluation => ({ accepted: false, reason, tiles });
    const { actorId, definitionId, origin, quarterTurns = 0 } = request;
    if (
      !map ||
      !occupancy ||
      !isId(actorId) ||
      !isValidTilePlacement({ origin, quarterTurns })
    )
      return reject("invalid-actor");
    if (usedIds.has(actorId)) return reject("used-id");
    const definition = definitions.get(definitionId);
    if (!definition) return reject("unknown-definition");
    if (!definition.footprint) return reject("not-placeable");

    const actor = createTilePlacedActor(map, definition, request, owner);
    const tiles = occupiedTilesFor(actor, definition);
    const covers = (keys: ReadonlySet<string>) =>
      tiles.some((tile) => keys.has(tileKey(tile)));
    if (tiles.some((tile) => !map.containsTile(tile.x, tile.z)))
      return reject("out-of-bounds", tiles);
    // Answers before occupancy, which would reveal what stands on unknown tiles.
    if (tiles.some((tile) => !knowsTile(owner, tile)))
      return reject("unexplored", tiles);
    const evaluation = evaluateFootprint(
      map,
      occupancy,
      actor,
      definition,
      actors,
    );
    if (!evaluation.accepted) return evaluation;
    if (debris && covers(debris)) return reject("debris", tiles);

    let workerId: string | undefined;
    if (economy) {
      if (!canAfford(economy.view, owner, definition))
        return reject("insufficient-resources", tiles);
      if (covers(economy.resourceTiles)) return reject("resource-site", tiles);
      const { sharesHeadquarters, sharesSupport } = relations();
      // An owner without a headquarters may place a replacement.
      const emergency = replacesHeadquarters(
        actor,
        headquarteredOwners(actors, definitions),
        { definitions, emergencyHeadquarters },
      );
      if (definition.growth) {
        if (
          !emergency &&
          !infrastructureHeadquarters(actor, actors, {
            definitions,
            sharesHeadquarters,
          }).length
        )
          return reject("missing-headquarters", tiles);
        const workerIds = request.workerIds ?? [];
        if (!growthCandidates(actor, workerIds, actors, definitions).length)
          return reject("missing-worker", tiles);
        workerId = growthWorkerFor(actor, workerIds, actors, {
          definitions,
          behaviors,
          map,
        })?.id;
        if (!workerId) return reject("unreachable-growth", tiles);
      }
      const recipient = { owner, faction: definition.faction };
      if (
        definition.support &&
        !supportsPosition(
          economy.support,
          actor.worldPosition,
          recipient,
          sharesSupport,
        ) &&
        // A replacement may use a disconnected owned building's radius.
        !(
          emergency &&
          ownedCoverage(economy.support, actor.worldPosition, recipient)
        )
      )
        return reject("outside-support", tiles);
    }
    try {
      validateActor(actor);
    } catch {
      return reject("invalid-actor", tiles);
    }
    return workerId ? { ...evaluation, workerId } : evaluation;
  };

  const training = (
    command: TrainUnitCommand,
    { actors, usedIds, occupancy, behaviors, economy }: RuleWorld,
  ): TrainingEvaluation => {
    if (
      economy &&
      disconnectedBuildings(economy.support).has(command.producerId)
    )
      return { accepted: false, reason: "disconnected" };
    const evaluation = evaluateTraining(command, {
      actors,
      usedIds,
      definitions,
      canStandAt: (unit, tile) => canStandAt(behaviors, unit, tile),
      map,
      occupancy,
      bounds,
    });
    if (
      economy &&
      (evaluation.accepted || evaluation.reason === "exit-blocked")
    ) {
      const reason = productionRejection(
        economy.view,
        actors.find(({ id }) => id === command.producerId)!,
        definitions.get(command.definitionId)!,
      );
      return reason
        ? { accepted: false, reason }
        : { accepted: true, queued: true };
    }
    if (evaluation.accepted && "actor" in evaluation) {
      try {
        validateActor(evaluation.actor);
      } catch {
        return { accepted: false, reason: "invalid-actor" };
      }
    }
    return evaluation;
  };

  const rallyPoint = (
    producer: Actor | undefined,
    target: WorldPosition,
    { occupancy, behaviors }: Pick<RuleWorld, "occupancy" | "behaviors">,
  ) => {
    const unitIds = trainableUnitIds(producer, definitions);
    if (
      !map ||
      !occupancy ||
      !producer ||
      !unitIds.length ||
      !target ||
      !isFinitePosition(target) ||
      !withinBounds(target, bounds)
    )
      return false;
    const tile = map.tileAtWorldPosition(target.x, target.z);
    return (
      knowsTile(producer.owner, tile) &&
      occupancy.ownerAt(tile.x, tile.z, "surface") === undefined &&
      unitIds.every((id) => canStandAt(behaviors, definitions.get(id)!, tile))
    );
  };

  const tendWorker = (
    buildingId: string,
    workerIds: readonly string[],
    { actors, behaviors, economy }: RuleWorld,
  ) => {
    const building = actors.find(({ id }) => id === buildingId);
    if (
      !map ||
      !building?.construction ||
      !definitions.get(building.definitionId)?.growth ||
      economy?.view.cultivation?.workers.some(
        (worker) => worker.tendingId === buildingId,
      )
    )
      return undefined;
    return growthWorkerFor(building, workerIds, actors, {
      definitions,
      behaviors,
      map,
    })?.id;
  };

  return { placement, training, rallyPoint, tendWorker };
}
