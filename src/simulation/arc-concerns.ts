// ARC build plan: Materials income and army producers.
import { compareIds } from "./actor";
import {
  affords,
  armyProducer,
  definitionOf,
  harvesterOf,
  headquarters,
  isOnline,
  isPlacementMemory,
  isRestoring,
  isUsable,
  ownBuildings,
  place,
  rosterBuildings,
  stepToward,
  train,
} from "./ai-planning";
import { isPositiveCount } from "./ai-tuning";
import { arcDefenses } from "./arc-defense-plan";
import { arcExpansion } from "./arc-expansion-plan";
import { plannedConcern } from "./director";
import { refineryOccupied } from "./production";
import { isCount, isNonnegative } from "./validation";
import { distance } from "./world";

import type { PlacementMemory } from "./ai-planning";
import type { AiConcern, AiConcernContext } from "./director";
import type { TerrainView } from "./terrain";
import type { WorldPosition } from "./world";

/** Counts while establishing or recovering, and once the base is growing. */
type IncomePlan = {
  readonly essentialRefineries: number;
  readonly refineries: number;
  /** A new Refinery's distance from its deposit, toward headquarters. */
  readonly siteStepTiles: number;
};
type ProductionPlan = {
  readonly essentialProducers: number;
  readonly producers: number;
  /** Income workers needed before building beyond the first producer. */
  readonly fullProductionWorkers: number;
  /** A producer's distance from headquarters, away from the deposit. */
  readonly siteOffsetTiles: number;
};

/**
 * Sighted sites last seen with Materials, nearest to `point` first. Gather
 * orders need explored sites, so unscouted deposits wait for scouting.
 */
function sitesNear(
  context: AiConcernContext,
  terrain: TerrainView,
  point: WorldPosition,
) {
  return (context.view.economy()?.sites ?? [])
    .filter((site) => site.remainingMaterials > 0)
    .map((site) => ({
      site,
      position: terrain.tileCenter(site.tile.x, site.tile.z),
    }))
    .sort(
      (a, b) =>
        distance(point, a.position) - distance(point, b.position) ||
        compareIds(a.site.id, b.site.id),
    );
}

/**
 * Builds Refineries beside known Materials, staffs each with a Harvester, and
 * keeps Harvesters gathering. Savings return to the pool once every usable
 * Refinery is staffed and the posture's Refinery count is met.
 */
export const arcIncome = plannedConcern<IncomePlan>(
  {
    essentialRefineries: isPositiveCount,
    refineries: isPositiveCount,
    siteStepTiles: isNonnegative,
  },
  (context, plan) => {
    const { terrain } = context;
    const economy = context.view.economy();
    if (!economy || !terrain) return;
    const refineries = ownBuildings(
      context,
      (definition) => !!definition.refinery,
    ).filter((refinery) => isOnline(context, refinery));
    // Planning reads committed state, so reserve assignments within this turn.
    const occupied = new Set(
      refineries
        .filter(({ id }) => refineryOccupied(economy, id))
        .map(({ id }) => id),
    );
    let unstaffed = false;
    for (const worker of [...economy.harvesters].sort((a, b) =>
      compareIds(a.actorId, b.actorId),
    )) {
      if (!refineries.some(({ id }) => id === worker.refineryId)) {
        const open = refineries.find(
          (refinery) =>
            isUsable(context, refinery) && !occupied.has(refinery.id),
        );
        if (
          open &&
          context.issue({
            kind: "assign-refinery",
            actorId: worker.actorId,
            refineryId: open.id,
          })
        )
          occupied.add(open.id);
        else unstaffed = true;
      } else if (worker.phase === "idle" || worker.phase === "depleted") {
        const refinery = refineries.find(({ id }) => id === worker.refineryId);
        const [nearest] = refinery
          ? sitesNear(context, terrain, refinery.worldPosition)
          : [];
        if (nearest)
          context.issue({
            kind: "gather",
            actorId: worker.actorId,
            siteId: nearest.site.id,
          });
      }
    }
    for (const refinery of refineries)
      if (
        isUsable(context, refinery) &&
        !occupied.has(refinery.id) &&
        train(
          context,
          refinery,
          harvesterOf(context, definitionOf(context, refinery)),
        )
      )
        occupied.add(refinery.id);
    const wanted = isRestoring(context)
      ? plan.essentialRefineries
      : plan.refineries;
    if (
      refineries.length >= wanted &&
      refineries.every((refinery) => occupied.has(refinery.id))
    ) {
      context.releaseFunds();
      return;
    }
    const home = headquarters(context);
    const [definition] = rosterBuildings(context, (d) => !!d.refinery);
    if (
      !home ||
      !definition ||
      refineries.length >= wanted ||
      refineries.some((refinery) => refinery.construction) ||
      // Wait until the Refinery can also be staffed, unless a Harvester waits.
      !affords(
        context,
        definition,
        ...(unstaffed ? [] : [harvesterOf(context, definition)]),
      )
    )
      return;
    const [target] = sitesNear(context, terrain, home.worldPosition);
    if (target)
      place(
        context,
        context.memory as PlacementMemory,
        terrain,
        definition,
        stepToward(
          terrain,
          target.position,
          home.worldPosition,
          plan.siteStepTiles,
        ),
      );
  },
);

/**
 * Builds army producers once income exists, away from the Materials. Savings
 * return to the pool once the posture's producers exist.
 */
export const arcProduction = plannedConcern<ProductionPlan>(
  {
    essentialProducers: isPositiveCount,
    producers: isPositiveCount,
    fullProductionWorkers: isCount,
    siteOffsetTiles: isNonnegative,
  },
  (context, plan) => {
    const { terrain } = context;
    const economy = context.view.economy();
    const home = headquarters(context);
    if (!economy || !home || !terrain) return;
    const army = armyProducer(context);
    const producers = ownBuildings(context, army).filter((producer) =>
      isOnline(context, producer),
    );
    const planned = isRestoring(context)
      ? plan.essentialProducers
      : plan.producers;
    if (producers.length >= planned) {
      context.releaseFunds();
      return;
    }
    const hasIncome =
      economy.harvesters.length > 0 ||
      economy.production.some(
        (job) => context.definitions.get(job.definitionId)?.harvesting,
      );
    // Further producers wait for income, so savings go to growing it.
    const wanted =
      economy.harvesters.length < plan.fullProductionWorkers ? 1 : planned;
    if (producers.length >= wanted) {
      context.releaseFunds();
      return;
    }
    const [definition] = rosterBuildings(context, army);
    if (
      !definition ||
      !hasIncome ||
      producers.some((producer) => producer.construction)
    )
      return;
    const [site] = sitesNear(context, terrain, home.worldPosition);
    place(
      context,
      context.memory as PlacementMemory,
      terrain,
      definition,
      stepToward(
        terrain,
        home.worldPosition,
        site?.position,
        -plan.siteOffsetTiles,
      ),
    );
  },
);

arcIncome.validateMemory = isPlacementMemory;
arcProduction.validateMemory = isPlacementMemory;

export const ARC_CONCERNS: ReadonlyMap<string, AiConcern> = new Map([
  ["arc-defenses", arcDefenses],
  ["arc-expansion", arcExpansion],
  ["arc-income", arcIncome],
  ["arc-production", arcProduction],
]);
