import { isArmyUnit, trainsArmy } from "./actor";
import {
  definitionOf,
  headquarters,
  isUsable,
  ownBuildings,
  stepToward,
  train,
} from "./ai-planning";
import { defense } from "./ai-defense";
import { offense } from "./ai-offense";
import { scouting } from "./ai-scouting";
import { ARC_CONCERNS } from "./arc-concerns";

import type { AiConcern } from "./director";

/** Outstanding orders per producer, so funds stay available elsewhere. */
const QUEUED_FORCES = 2;
/** Tiles from a producer's center to its rally point, by preference. */
const RALLY_TILES = [5, 3];

/**
 * Keeps each usable army producer training its first army unit, and keeps a
 * valid rally point away from the headquarters. Any faction can use it.
 */
export const trainForces: AiConcern = (context) => {
  const { terrain } = context;
  const economy = context.view.economy();
  if (!economy || !terrain) return;
  const home = headquarters(context);
  const producers = ownBuildings(context, (definition) =>
    trainsArmy(definition, context.definitions),
  ).filter((producer) => isUsable(context, producer));
  for (const producer of producers) {
    if (
      !producer.rallyPoint ||
      !context.view.evaluateRallyPoint(producer.id, producer.rallyPoint)
    ) {
      const target = RALLY_TILES.map((tiles) =>
        stepToward(
          terrain,
          producer.worldPosition,
          home?.worldPosition,
          -tiles,
        ),
      ).find((point) => context.view.evaluateRallyPoint(producer.id, point));
      if (target)
        context.issue({
          kind: "set-rally-point",
          actorId: producer.id,
          target,
        });
    }
    const unit = definitionOf(context, producer)
      .production!.unitDefinitionIds.map((id) => context.definitions.get(id))
      .find((definition) => !!definition && isArmyUnit(definition));
    let queued = economy.production.filter(
      ({ producerId }) => producerId === producer.id,
    ).length;
    while (unit && queued < QUEUED_FORCES && train(context, producer, unit))
      queued += 1;
  }
};

/** The concerns content-pack AI profiles may name. */
export const BUILT_IN_AI_CONCERNS: ReadonlyMap<string, AiConcern> = new Map([
  ...ARC_CONCERNS,
  ["defense", defense],
  ["forces", trainForces],
  ["offense", offense],
  ["scouting", scouting],
]);
