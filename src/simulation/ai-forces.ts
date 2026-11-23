// Faction-neutral army training, support providers, and rally points.
import {
  compareIds,
  countByDefinition,
  isArmyUnit,
  isIncomeBuilding,
  isSupportUnit,
} from "./actor";
import {
  armyProducer,
  definitionOf,
  headquarters,
  idleProvider,
  knownDefenders,
  sitesNear,
  stepToward,
  train,
  usableBuildings,
} from "./ai-planning";
import { isPositiveCount, listOf, weightsOf } from "./ai-tuning";
import { plannedConcern } from "./director";
import { economyWorkers } from "./economy";
import { trainableUnitIds } from "./production";
import { isPositive } from "./validation";
import { distance } from "./world";

import type { ActorDefinition } from "./actor";
import type { AiConcernContext } from "./director";
import type { EconomyView } from "./economy";
import type { WorldPosition } from "./world";

type ForcesPlan = {
  /** Outstanding orders per producer, so funds stay available elsewhere. */
  readonly queued: number;
  /** Rally offsets in tiles, by preference. */
  readonly rallyTiles: readonly number[];
  /** Try the home resource site before rallying away from the headquarters. */
  readonly rallyTowardIncome: boolean;
  /** Relative shares of trained army units, by definition ID. */
  readonly mix: Readonly<Record<string, number>>;
  /** The shares once enemy static defenses are known. */
  readonly defendedMix: Readonly<Record<string, number>>;
  /** One provider per this many own units it can service, by definition ID. */
  readonly support: Readonly<Record<string, number>>;
  /** Stationed providers this far from their income building move back. */
  readonly stationTiles: number;
  /** Where worker support waits, measured from its station toward home. */
  readonly stationOffsetTiles: number;
};

/** Own mobile units and queued orders, by definition ID. */
function unitCounts(context: AiConcernContext) {
  return countByDefinition([
    ...context.view.actors().ownMobile.filter(context.view.isMobile),
    ...(context.view.economy()?.production ?? []),
  ]);
}

/** Counts possible service recipients of each kind once per planning turn. */
function recoveryCounts(context: AiConcernContext) {
  const counts = new Map<
    NonNullable<ActorDefinition["recoveryKind"]>,
    number
  >();
  for (const actor of context.view.actors().ownMobile) {
    const definition = definitionOf(context, actor);
    const kind = definition.recoveryKind;
    if (context.view.isMobile(actor) && !isSupportUnit(definition) && kind)
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  return counts;
}

/**
 * The first support provider due at this producer, based on its recipients
 * and the providers already fielded or in production.
 */
function supportDue(
  context: AiConcernContext,
  plan: ForcesPlan,
  trains: readonly string[],
  counts: ReadonlyMap<string, number>,
  recipients: ReturnType<typeof recoveryCounts>,
): ActorDefinition | undefined {
  for (const [id, per] of Object.entries(plan.support)) {
    const provider = trains.includes(id)
      ? context.definitions.get(id)
      : undefined;
    if (!provider?.restoration) continue;
    const units = provider.restoration.targetKinds.reduce(
      (sum, kind) => sum + (recipients.get(kind) ?? 0),
      0,
    );
    if ((counts.get(id) ?? 0) < Math.floor(units / per)) return provider;
  }
}

/** The army unit furthest below its share among all usable producers. */
function nextArmyUnit(
  mix: readonly { unit: ActorDefinition; weight: number }[],
  counts: ReadonlyMap<string, number>,
): ActorDefinition | undefined {
  let next: ActorDefinition | undefined;
  let lowestFill = Infinity;
  for (const { unit, weight } of mix) {
    // The share it would fill with one more, so heavy weights lead.
    const fill = ((counts.get(unit.id) ?? 0) + 1) / weight;
    if (fill >= lowestFill) continue;
    next = unit;
    lowestFill = fill;
  }
  return next;
}

/**
 * Trains toward the profile's mix and support ratios, assigns rally points,
 * and stations worker-servicing providers at income buildings.
 */
export const trainForces = plannedConcern<ForcesPlan>(
  {
    queued: isPositiveCount,
    rallyTiles: listOf(isPositive),
    rallyTowardIncome: (value) => typeof value === "boolean",
    mix: weightsOf(isPositive),
    defendedMix: weightsOf(isPositive),
    support: weightsOf(isPositiveCount),
    stationTiles: isPositive,
    stationOffsetTiles: isPositive,
  },
  (context, plan) => {
    const { terrain } = context;
    const economy = context.view.economy();
    if (!economy || !terrain) return;
    const home = headquarters(context)?.worldPosition;
    const site =
      plan.rallyTowardIncome && home
        ? sitesNear(context, home)[0]?.position
        : undefined;
    const incomeRallies = site
      ? plan.rallyTiles.map((tiles) => stepToward(terrain, site, home, tiles))
      : [];
    const producers = usableBuildings(context, armyProducer(context)).map(
      (building) => ({
        building,
        trains: trainableUnitIds(building, context.definitions),
      }),
    );
    const counts = unitCounts(context);
    const recipients = recoveryCounts(context);
    const defended = knownDefenders(context).some(
      ({ tilePlacement }) => !!tilePlacement,
    );
    const trainable = new Set(producers.flatMap(({ trains }) => trains));
    const mix = Object.entries(defended ? plan.defendedMix : plan.mix).flatMap(
      ([id, weight]) => {
        const unit = trainable.has(id)
          ? context.definitions.get(id)
          : undefined;
        return unit && isArmyUnit(unit) ? [{ unit, weight }] : [];
      },
    );
    for (const { building: producer, trains } of producers) {
      const validRally = (point: WorldPosition) =>
        context.view.evaluateRallyPoint(producer.id, point);
      if (!producer.rallyPoint || !validRally(producer.rallyPoint)) {
        const target =
          incomeRallies.find(validRally) ??
          plan.rallyTiles
            .map((tiles) =>
              stepToward(terrain, producer.worldPosition, home, -tiles),
            )
            .find(validRally);
        if (target)
          context.issue({
            kind: "set-rally-point",
            actorId: producer.id,
            target,
          });
      }
      let queued = economy.production.filter(
        ({ producerId }) => producerId === producer.id,
      ).length;
      while (queued < plan.queued) {
        const unit =
          supportDue(context, plan, trains, counts, recipients) ??
          nextArmyUnit(mix, counts);
        // Leave the funds for the producer that trains the next unit.
        if (
          !unit ||
          !trains.includes(unit.id) ||
          !train(context, producer, unit)
        )
          break;
        counts.set(unit.id, (counts.get(unit.id) ?? 0) + 1);
        queued += 1;
      }
    }
    stationProviders(context, plan, economy);
  },
);

/**
 * Claims providers that service workers but no unit of the army mix, so
 * operations keep the rest, and keeps each near an income building, spread
 * across them in ID order.
 */
function stationProviders(
  context: AiConcernContext,
  plan: ForcesPlan,
  economy: EconomyView,
) {
  const { terrain } = context;
  const workerKinds = new Set(
    economyWorkers(economy).flatMap(({ actorId }) => {
      const worker = context.view.ownActor(actorId);
      return worker ? (definitionOf(context, worker).recoveryKind ?? []) : [];
    }),
  );
  const armyKinds = new Set(
    Object.keys({ ...plan.mix, ...plan.defendedMix }).flatMap(
      (id) => context.definitions.get(id)?.recoveryKind ?? [],
    ),
  );
  const stations = usableBuildings(context, isIncomeBuilding);
  if (!terrain || !stations.length) return;
  const providers = context.view
    .actors()
    .ownMobile.filter((actor) => {
      const kinds = definitionOf(context, actor).restoration?.targetKinds;
      return (
        !!kinds &&
        kinds.some((kind) => workerKinds.has(kind)) &&
        !kinds.some((kind) => armyKinds.has(kind)) &&
        context.claim(actor.id)
      );
    })
    .sort((a, b) => compareIds(a.id, b.id));
  const range = plan.stationTiles * terrain.tileSize;
  const home = headquarters(context)?.worldPosition;
  providers.forEach((provider, index) => {
    const station = stations[index % stations.length]!;
    if (
      !idleProvider(provider) ||
      distance(provider.worldPosition, station.worldPosition) <= range
    )
      return;
    context.issue({
      kind: "move",
      actorId: provider.id,
      target: stepToward(
        terrain,
        station.worldPosition,
        home,
        Math.min(plan.stationOffsetTiles, plan.stationTiles),
      ),
    });
  });
}
