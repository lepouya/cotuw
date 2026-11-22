// Faction-neutral reserve and restoration after base losses.
import { compareIds, isIncomeBuilding } from "./actor";
import {
  armyProducer,
  definitionOf,
  headquarters,
  isPlacementMemory,
  ownBuildings,
  place,
  rosterBuildings,
  totalPrice,
  usableBuildings,
} from "./ai-planning";
import { economyWorkers, saleRefund } from "./economy";
import { costResource } from "./resources";
import { balanceOf } from "./stockpiles";

import type { ActorDefinition } from "./actor";
import type { PlacementMemory } from "./ai-planning";
import type { AiConcern, AiConcernContext } from "./director";
import type { Resource } from "./resources";

type Reserve = {
  price: Partial<Record<Resource, number>>;
  /** Kept even while recovering, because the build plans cannot use it. */
  urgent?: boolean;
};

/** Whether the base can root its network, earn income, and train an army. */
const isIntact = (context: AiConcernContext) =>
  !!headquarters(context) &&
  economyWorkers(context.view.economy()).length > 0 &&
  usableBuildings(context, isIncomeBuilding).length > 0 &&
  usableBuildings(context, armyProducer(context)).length > 0;

/**
 * A faction income plan's report of what restarting its income costs. Pending
 * buildings and workers count as restarted.
 */
export type IncomeRestart = {
  /** Restarting income from nothing. */
  readonly reserve: Price;
  /** What restarting needs from the current state. */
  readonly needed: Price;
};
export type IncomeRestartReport = (
  context: AiConcernContext,
) => IncomeRestart | undefined;

type Price = Partial<Record<Resource, number>>;

/** Restarting with `building` and `worker`, less what already earns or works. */
export const restartOf = (
  building: ActorDefinition,
  worker: ActorDefinition,
  { earning, staffed }: { earning: boolean; staffed: boolean },
): IncomeRestart => ({
  reserve: totalPrice([building, worker]),
  needed: totalPrice([
    ...(earning ? [] : [building]),
    ...(staffed ? [] : [worker]),
  ]),
});

/**
 * Reserves the faction income plan's restart price and restores a lost
 * headquarters. Income plans own worker training, including replacements.
 * Recovering releases savings to the build plans, and sells buildings when
 * nothing else can pay to restart income. Elsewhere only higher-priority
 * concerns may draw the reserve. Defense outranks recovery until its calm
 * interval ends.
 */
export const recoveryFor = (
  restarts: ReadonlyMap<string, IncomeRestartReport>,
): AiConcern => {
  const concern: AiConcern = (context) => {
    const restart =
      context.view.faction === undefined
        ? undefined
        : restarts.get(context.view.faction)?.(context);
    planRecovery(context, restart);
  };
  concern.validateMemory = isPlacementMemory;
  return concern;
};

function planRecovery(
  context: AiConcernContext,
  restart: IncomeRestart | undefined,
) {
  const intact = isIntact(context);
  if (context.posture === "establishing" || context.posture === "recovering") {
    if (intact) context.requestPosture("developing");
  } else if (!intact) context.requestPosture("recovering");
  if (context.posture === "establishing") {
    context.releaseFunds();
    return;
  }
  const restores = context.posture !== "defending";
  const reserve = replaceHeadquarters(context, restores) ?? {
    price: restart?.reserve ?? {},
  };
  if (restart) sellForIncome(context, restart.needed);
  context.releaseFunds(
    context.posture !== "recovering" || reserve.urgent
      ? reserve.price
      : undefined,
  );
}

/**
 * Without a completed headquarters, places one beside the first surviving
 * building with room, which the emergency rule allows while disconnected.
 */
function replaceHeadquarters(
  context: AiConcernContext,
  restores: boolean,
): Reserve | undefined {
  const { terrain } = context;
  if (!terrain || headquarters(context)) return;
  const [definition] = rosterBuildings(
    context,
    (candidate) => !!candidate.infrastructure,
  );
  const buildings = ownBuildings(context, () => true);
  const survivors = buildings.filter((building) => !building.construction);
  if (!definition || !survivors.length) return;
  const underway = buildings.some(
    (building) =>
      building.construction && definitionOf(context, building).infrastructure,
  );
  if (restores && !underway)
    place(
      context,
      context.memory as PlacementMemory,
      terrain,
      definition,
      survivors.map(({ worldPosition }) => worldPosition),
    );
  return { price: totalPrice([definition]), urgent: true };
}

/**
 * While income has stopped and the funds cannot pay what restarting it
 * `needed`, sells the completed building with the largest refund that neither
 * roots the base nor earns.
 */
function sellForIncome(context: AiConcernContext, needed: Price) {
  const economy = context.view.economy();
  if (!economy || !headquarters(context)) return;
  // A sale depends on the owner's shortfall, not this concern's allocation.
  const funds = (resource: Resource) =>
    balanceOf(economy, context.view.owner, resource) ?? 0;
  if (
    Object.entries(needed).every(
      ([resource, amount]) => funds(resource as Resource) >= amount,
    )
  )
    return;
  const [sale] = ownBuildings(
    context,
    (definition) => !definition.infrastructure && !isIncomeBuilding(definition),
  )
    .flatMap((building) => {
      const definition = definitionOf(context, building);
      const resource = costResource(definition);
      const refund = saleRefund(building, definition);
      return !building.construction &&
        refund > 0 &&
        (needed[resource] ?? 0) > funds(resource)
        ? [{ id: building.id, refund }]
        : [];
    })
    .sort((a, b) => b.refund - a.refund || compareIds(a.id, b.id));
  if (sale) context.issue({ kind: "sell-actor", actorId: sale.id });
}
