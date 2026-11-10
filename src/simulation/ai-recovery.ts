// Faction-neutral reserve and restoration after base losses.
import { isIncomeBuilding, isWorkerDefinition } from "./actor";
import {
  armyProducer,
  definitionOf,
  headquarters,
  ownBuildings,
  place,
  rosterBuildings,
  totalPrice,
  usableBuildings,
} from "./ai-planning";
import { economyWorkers } from "./economy";

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
 * savings to the build plans; elsewhere only higher-priority concerns may
 * draw the reserve. Defense owns its exit timing.
 */
export const recovery: AiConcern = (context) => {
  const intact = isIntact(context);
  if (context.posture === "establishing" || context.posture === "recovering") {
    if (intact) context.requestPosture("developing");
  } else if (!intact && context.posture !== "defending")
    context.requestPosture("recovering");
  if (context.posture === "establishing") {
    context.releaseFunds();
    return;
  }
  const restores = context.posture !== "defending";
  const reserve =
    replaceHeadquarters(context, restores) ?? incomeReserve(context);
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

/** Covers one worker, and a building to train it when none is usable. */
function incomeReserve(context: AiConcernContext): Reserve {
  const trainsWorkers = (definition: ActorDefinition) =>
    !!workerOf(context, definition);
  const [trainer] = usableBuildings(context, trainsWorkers);
  if (trainer)
    return {
      price: totalPrice([workerOf(context, definitionOf(context, trainer))!]),
    };
  const [building] = rosterBuildings(context, trainsWorkers);
  if (!building) return { price: {} };
  const staffed = economyWorkers(context.view.economy()).length > 0;
  return {
    price: totalPrice(
      staffed ? [building] : [building, workerOf(context, building)!],
    ),
  };
}
