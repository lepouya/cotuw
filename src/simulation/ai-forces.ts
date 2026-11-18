// Faction-neutral army training, support providers, and rally points.
import {
  compareIds,
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
  stepToward,
  train,
  usableBuildings,
} from "./ai-planning";
import { isPositiveCount, listOf, weightsOf } from "./ai-tuning";
import { plannedConcern } from "./director";
import { economyWorkers } from "./economy";
import { isPositive } from "./validation";
import { distance } from "./world";

import type { ActorDefinition } from "./actor";
import type { Building } from "./ai-planning";
import type { AiConcernContext } from "./director";
import type { EconomyView } from "./economy";

type ForcesPlan = {
  /** Outstanding orders per producer, so funds stay available elsewhere. */
  readonly queued: number;
  /** Tiles from a producer's center to its rally point, by preference. */
  readonly rallyTiles: readonly number[];
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
  const counts = new Map<string, number>();
  const add = (definitionId: string) =>
    counts.set(definitionId, (counts.get(definitionId) ?? 0) + 1);
  for (const actor of context.view.actors().ownMobile)
    if (context.view.isMobile(actor)) add(actor.definitionId);
  for (const { definitionId } of context.view.economy()?.production ?? [])
    add(definitionId);
  return counts;
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
 * The next unit for `producer`: a support provider its units need, else the
 * army unit furthest below its share of the current mix.
 */
function nextUnit(
  context: AiConcernContext,
  plan: ForcesPlan,
  producer: Building,
  counts: ReadonlyMap<string, number>,
  recipients: ReturnType<typeof recoveryCounts>,
  defended: boolean,
): ActorDefinition | undefined {
  const trains = new Set(
    definitionOf(context, producer).production!.unitDefinitionIds,
  );
  const trainable = (id: string) =>
    trains.has(id) ? context.definitions.get(id) : undefined;
  for (const [id, per] of Object.entries(plan.support)) {
    const provider = trainable(id);
    if (!provider?.restoration) continue;
    const units = provider.restoration.targetKinds.reduce(
      (sum, kind) => sum + (recipients.get(kind) ?? 0),
      0,
    );
    if ((counts.get(id) ?? 0) < Math.floor(units / per)) return provider;
  }
  let next: ActorDefinition | undefined;
  let lowestFill = Infinity;
  for (const [id, weight] of Object.entries(
    defended ? plan.defendedMix : plan.mix,
  )) {
    const unit = trainable(id);
    if (!unit || !isArmyUnit(unit)) continue;
    // The share it would fill with one more, so heavy weights lead.
    const fill = ((counts.get(id) ?? 0) + 1) / weight;
    if (fill >= lowestFill) continue;
    next = unit;
    lowestFill = fill;
  }
  return next;
}

/**
 * Keeps each usable army producer training toward the profile's mix and
 * support ratios, keeps a valid rally point away from the headquarters, and
 * stations worker-servicing providers at income buildings. Any faction can
 * use it.
 */
export const trainForces = plannedConcern<ForcesPlan>(
  {
    queued: isPositiveCount,
    rallyTiles: listOf(isPositive),
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
    const home = headquarters(context);
    const producers = usableBuildings(context, armyProducer(context));
    const counts = unitCounts(context);
    const recipients = recoveryCounts(context);
    const defended = knownDefenders(context).some(
      ({ tilePlacement }) => !!tilePlacement,
    );
    for (const producer of producers) {
      if (
        !producer.rallyPoint ||
        !context.view.evaluateRallyPoint(producer.id, producer.rallyPoint)
      ) {
        const target = plan.rallyTiles
          .map((tiles) =>
            stepToward(
              terrain,
              producer.worldPosition,
              home?.worldPosition,
              -tiles,
            ),
          )
          .find((point) => context.view.evaluateRallyPoint(producer.id, point));
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
        const unit = nextUnit(
          context,
          plan,
          producer,
          counts,
          recipients,
          defended,
        );
        if (!unit || !train(context, producer, unit)) break;
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
