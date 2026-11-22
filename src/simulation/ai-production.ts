// Faction-neutral army producers, built once income exists.
import { isWorkerDefinition } from "./actor";
import {
  armyProducer,
  headquarters,
  isOnline,
  isPlacementMemory,
  isRestoring,
  ownBuildings,
  place,
  rosterBuildings,
  sitesNear,
  stepToward,
} from "./ai-planning";
import { isPositiveCount } from "./ai-tuning";
import { plannedConcern } from "./director";
import { economyWorkers } from "./economy";
import { isCount, isNonnegative } from "./validation";

import type { PlacementMemory } from "./ai-planning";

type ProductionPlan = {
  readonly essentialProducers: number;
  readonly producers: number;
  /** Income workers needed before building beyond the first producer. */
  readonly fullProductionWorkers: number;
  /** A producer's distance from headquarters, away from the nearest site. */
  readonly siteOffsetTiles: number;
};

/**
 * Builds army producers once income exists, away from the nearest site,
 * cycling through the roster's producer types in content order. Savings
 * return to the pool once the posture's producers exist.
 */
export const production = plannedConcern<ProductionPlan>(
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
    const workers = economyWorkers(economy).length;
    const hasIncome =
      workers > 0 ||
      economy.production.some((job) => {
        const unit = context.definitions.get(job.definitionId);
        return !!unit && isWorkerDefinition(unit);
      });
    // Further producers wait for income, so savings go to growing it.
    const wanted = workers < plan.fullProductionWorkers ? 1 : planned;
    if (producers.length >= wanted) {
      context.releaseFunds();
      return;
    }
    // The type with the fewest producers, earliest in content order.
    const count = (id: string) =>
      producers.filter(({ definitionId }) => definitionId === id).length;
    const [definition] = rosterBuildings(context, army).sort(
      (a, b) => count(a.id) - count(b.id),
    );
    if (
      !definition ||
      !hasIncome ||
      producers.some((producer) => producer.construction)
    )
      return;
    place(
      context,
      context.memory as PlacementMemory,
      terrain,
      definition,
      stepToward(
        terrain,
        home.worldPosition,
        sitesNear(context, home.worldPosition)[0]?.position,
        -plan.siteOffsetTiles,
      ),
    );
  },
);

production.validateMemory = isPlacementMemory;
