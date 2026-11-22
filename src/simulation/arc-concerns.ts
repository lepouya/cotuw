// ARC build plan: Materials income.
import { compareIds } from "./actor";
import {
  affords,
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
  sitesNear,
  stepToward,
  train,
  usableBuildings,
} from "./ai-planning";
import { isPositiveCount } from "./ai-tuning";
import { restartOf } from "./ai-recovery";
import { arcExpansion } from "./arc-expansion-plan";
import { plannedConcern } from "./director";
import { refineryOccupied } from "./production";
import { isNonnegative } from "./validation";

import type { PlacementMemory } from "./ai-planning";
import type { IncomeRestartReport } from "./ai-recovery";

import type { AiConcern } from "./director";

/** Counts while establishing or recovering, and once the base is growing. */
type IncomePlan = {
  readonly essentialRefineries: number;
  readonly refineries: number;
  /** A new Refinery's distance from its deposit, toward headquarters. */
  readonly siteStepTiles: number;
};
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
          ? sitesNear(context, refinery.worldPosition, [
              harvesterOf(context, definitionOf(context, refinery)),
            ])
          : [];
        if (nearest)
          context.issue({
            kind: "gather",
            actorId: worker.actorId,
            siteId: nearest.id,
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
    const [target] = sitesNear(context, home.worldPosition, [
      harvesterOf(context, definition),
    ]);
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

/** A Refinery and its Harvester, less whatever survives or is pending. */
export const arcIncomeRestart: IncomeRestartReport = (context) => {
  const economy = context.view.economy();
  const [refinery] = rosterBuildings(context, (d) => !!d.refinery);
  if (!economy || !refinery) return;
  const harvester = harvesterOf(context, refinery);
  // Workers queued at an offline Refinery wait until support returns.
  const trainers = new Set(
    usableBuildings(context, (d) => !!d.refinery).map(({ id }) => id),
  );
  const staffed =
    economy.harvesters.length > 0 ||
    economy.production.some(
      ({ producerId, definitionId }) =>
        trainers.has(producerId) && definitionId === harvester.id,
    );
  // Supported Refineries earn now or once their construction completes.
  const earning = ownBuildings(context, (d) => !!d.refinery).some((building) =>
    isOnline(context, building),
  );
  return restartOf(refinery, harvester, { earning, staffed });
};

arcIncome.validateMemory = isPlacementMemory;

export const ARC_CONCERNS: ReadonlyMap<string, AiConcern> = new Map([
  ["arc-expansion", arcExpansion],
  ["arc-income", arcIncome],
]);
