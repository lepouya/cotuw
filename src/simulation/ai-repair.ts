// Faction-neutral building repair through headquarters infrastructure.
import { compareIds, healthOf, isIncomeBuilding } from "./actor";
import {
  armyProducer,
  definitionOf,
  headquarters,
  isOnline,
  ownBuildings,
} from "./ai-planning";
import { isShare } from "./ai-tuning";
import { plannedConcern } from "./director";
import { repairCharge } from "./repair";
import { costResource } from "./resources";

import type { ActorDefinition } from "./actor";
import type { Building } from "./ai-planning";
import type { AiConcernContext } from "./director";
import type { Resource } from "./resources";

type RepairPlan = {
  /** Buildings below this share of their health are repaired. */
  readonly healthShare: number;
};

/** Repair order: headquarters, producers, income, defenses, then the rest. */
function rank(context: AiConcernContext, definition: ActorDefinition) {
  if (definition.infrastructure) return 0;
  if (armyProducer(context)(definition)) return 1;
  if (isIncomeBuilding(definition)) return 2;
  if (definition.weapon) return 3;
  return 4;
}

const healthShareOf = (context: AiConcernContext, building: Building) => {
  const maximum = definitionOf(context, building).health!;
  return healthOf(building, maximum) / maximum;
};

/**
 * Repairs one damaged building at a time in every posture, most important
 * first, once its funds cover the job. A repair yields when construction
 * waits on the same headquarters.
 */
export const repair = plannedConcern<RepairPlan>(
  { healthShare: isShare },
  (context, plan) => {
    if (!context.view.economy() || !headquarters(context)) return;
    const buildings = ownBuildings(context, () => true).filter((building) =>
      isOnline(context, building),
    );
    const construction = buildings.filter((building) => building.construction);
    const repairs = buildings.filter((building) => building.repair);
    if (construction.length || repairs.length) {
      const waiting = new Set(
        construction
          .filter((building) => !building.construction!.active)
          .map((building) => building.headquartersId),
      );
      const reserve: Partial<Record<Resource, number>> = {};
      for (const building of repairs) {
        const job = building.repair!;
        if (
          job.active &&
          waiting.has(building.headquartersId) &&
          context.issue({ kind: "cancel-repair", actorId: building.id })
        )
          continue;
        const definition = definitionOf(context, building);
        const resource = costResource(definition);
        const remaining =
          repairCharge(job.missingHealth, definition) - job.paidCost;
        reserve[resource] = (reserve[resource] ?? 0) + remaining;
      }
      context.releaseFunds(reserve);
      return;
    }
    const [next] = buildings
      .filter(
        (candidate) =>
          definitionOf(context, candidate).health &&
          healthShareOf(context, candidate) < plan.healthShare,
      )
      .sort(
        (a, b) =>
          rank(context, definitionOf(context, a)) -
            rank(context, definitionOf(context, b)) ||
          healthShareOf(context, a) - healthShareOf(context, b) ||
          compareIds(a.id, b.id),
      );
    if (!next) {
      context.releaseFunds();
      return;
    }
    const definition = definitionOf(context, next);
    const resource = costResource(definition);
    const price = repairCharge(
      definition.health! - healthOf(next, definition.health!),
      definition,
    );
    // Repair pays over time, so reserve its balance across planning rounds.
    if (
      context.funds(resource) >= price &&
      context.issue({ kind: "repair", actorId: next.id })
    )
      context.releaseFunds({ [resource]: price });
  },
);
