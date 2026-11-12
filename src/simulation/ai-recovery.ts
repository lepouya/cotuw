// Faction-neutral reserve and restoration after base losses.
import { compareIds, isIncomeBuilding, isWorkerDefinition } from "./actor";
import {
  armyProducer,
  definitionOf,
  headquarters,
  isOnline,
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

/** The first worker a building trains. */
const workerOf = (context: AiConcernContext, building: ActorDefinition) =>
  building.production?.unitDefinitionIds
    .map((id) => context.definitions.get(id))
    .find((unit) => !!unit && isWorkerDefinition(unit));

/**
 * Reserves income replacement costs and restores a lost headquarters. Income
 * plans own worker training, including replacements. Recovering releases
 * savings to the build plans, and sells buildings when nothing else can pay
 * to restart income. Elsewhere only higher-priority concerns may draw the
 * reserve. Defense outranks recovery until its calm interval ends.
 */
export const recovery: AiConcern = (context) => {
  const intact = isIntact(context);
  if (context.posture === "establishing" || context.posture === "recovering") {
    if (intact) context.requestPosture("developing");
  } else if (!intact) context.requestPosture("recovering");
  if (context.posture === "establishing") {
    context.releaseFunds();
    return;
  }
  const restores = context.posture !== "defending";
  const reserve =
    replaceHeadquarters(context, restores) ?? incomeReserve(context);
  sellForIncome(context);
  context.releaseFunds(
    context.posture !== "recovering" || reserve.urgent
      ? reserve.price
      : undefined,
  );
};

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
    survivors.some(({ worldPosition }) =>
      place(context, terrain, definition, worldPosition),
    );
  return { price: totalPrice([definition]), urgent: true };
}

const trainsWorkers =
  (context: AiConcernContext) => (definition: ActorDefinition) =>
    !!workerOf(context, definition);

/** Income buildings that train their own workers. */
const restartBuildings = (context: AiConcernContext) =>
  rosterBuildings(
    context,
    (definition) =>
      isIncomeBuilding(definition) && trainsWorkers(context)(definition),
  );

/**
 * While income has stopped and the funds cannot restart it, sells the
 * completed building with the largest refund that neither roots the base nor
 * earns. Pending buildings and workers count as restarted.
 */
function sellForIncome(context: AiConcernContext) {
  const [restart] = restartBuildings(context);
  const economy = context.view.economy();
  if (!restart || !economy || !headquarters(context)) return;
  const trainers = new Set(
    usableBuildings(context, trainsWorkers(context)).map(({ id }) => id),
  );
  const staffed =
    economyWorkers(economy).length > 0 ||
    economy.production.some(
      ({ producerId, definitionId }) =>
        trainers.has(producerId) &&
        isWorkerDefinition(context.definitions.get(definitionId)!),
    );
  const earning =
    usableBuildings(context, isIncomeBuilding).length > 0 ||
    ownBuildings(context, isIncomeBuilding).some(
      (building) => !!building.construction && isOnline(context, building),
    );
  const missing = [
    ...(earning ? [] : [restart]),
    ...(staffed ? [] : [workerOf(context, restart)!]),
  ];
  const needed = totalPrice(missing);
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

/**
 * Covers one worker, and a building to train it when none is usable. Where
 * income buildings train the workers, it always covers one of each, since
 * losing them all otherwise leaves no income to rebuild with.
 */
function incomeReserve(context: AiConcernContext): Reserve {
  const [restart] = restartBuildings(context);
  if (restart)
    return { price: totalPrice([restart, workerOf(context, restart)!]) };
  const [trainer] = usableBuildings(context, trainsWorkers(context));
  if (trainer)
    return {
      price: totalPrice([workerOf(context, definitionOf(context, trainer))!]),
    };
  const [building] = rosterBuildings(context, trainsWorkers(context));
  if (!building) return { price: {} };
  const staffed = economyWorkers(context.view.economy()).length > 0;
  return {
    price: totalPrice(
      staffed ? [building] : [building, workerOf(context, building)!],
    ),
  };
}
