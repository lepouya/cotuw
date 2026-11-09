import { healthOf, nearestTo } from "./actor";
import {
  applyCultivationCommand,
  createCultivatorState,
  interruptCultivation,
  updateCultivation,
  validateCultivation,
  validateCultivationDefinitions,
} from "./cultivation";
import { isTileCoord, tileKey } from "./grid";
import { validateGrowthDefinitions } from "./growth";
import {
  applyHarvestingCommand,
  createHarvesterState,
  hasValidHarvesting,
  interruptHarvesting,
  removeHarvestingActor,
  updateHarvesting,
  validateHarvestingDefinitions,
} from "./harvesting";
import {
  updateInfrastructure,
  validateInfrastructure,
  validateInfrastructureDefinitions,
} from "./infrastructure";
import {
  advanceProduction,
  cancelProduction,
  isValidProductionQueue,
  removeProducer,
} from "./production";
import { costAmount, definedPrices, RESOURCE_IDS } from "./resources";
import { balanceOf, credit, isValidLedger } from "./stockpiles";
import { disconnectedBuildings } from "./support";
import { isCount, isId, isNonnegative } from "./validation";
import { distance } from "./world";

import type {
  Actor,
  ActorBehavior,
  ActorDefinition,
  ActorRenderState,
  DeepReadonly,
} from "./actor";
import type { CargoSource } from "./cargo";
import type { EconomyCommand } from "./command";
import type { CultivationState } from "./cultivation";
import type { HarvesterState, MaterialsSite } from "./harvesting";
import type { TileCoord } from "./grid";
import type { SharesHeadquarters } from "./infrastructure";
import type { ProductionJob, TrainingEvaluation } from "./production";
import type { Resource } from "./resources";
import type { Ledger, LedgerView, SharesResources } from "./stockpiles";
import type { SupportView } from "./support";
import type { TerrainView } from "./terrain";
import type { WorldPosition } from "./world";

export type ResourceLoot = {
  id: string;
  name: string;
  tile: TileCoord;
  collected: boolean;
} & (
  | { materials: number; lifebloom?: never }
  | { lifebloom: number; materials?: never }
);
/** Adds the worker state a new actor's definition requires, if any. */
export function enrollWorker(
  economy: EconomyState,
  actorId: string,
  definition: ActorDefinition,
  refineryId?: string,
) {
  if (definition.cultivation && !economy.cultivation)
    throw new RangeError("Mission has no cultivation state for this worker.");
  if (definition.harvesting)
    economy.harvesters.push(createHarvesterState(actorId, refineryId));
  if (definition.cultivation)
    economy.cultivation!.workers.push(createCultivatorState(actorId));
}
export type EconomyState = Ledger & {
  cultivation?: CultivationState;
  sites: MaterialsSite[];
  loot: ResourceLoot[];
  harvesters: HarvesterState[];
  production: ProductionJob[];
};
export type EconomyView = DeepReadonly<EconomyState>;
export const economyWorkers = (economy: EconomyView | undefined) => [
  ...(economy?.harvesters ?? []),
  ...(economy?.cultivation?.workers ?? []),
];
export const economySites = (economy: EconomyView | undefined) => [
  ...(economy?.sites ?? []),
  ...(economy?.cultivation?.sites ?? []),
];
/**
 * One owner's balances, income, workers, and production, with every site and
 * loot cache. Fields are listed explicitly so new state stays private until
 * classified here.
 */
export function economyForOwner(
  economy: EconomyView,
  owner: string,
  ownsActor: (actorId: string) => boolean,
): EconomyView {
  return {
    stockpiles: economy.stockpiles.filter(({ owners }) =>
      owners.includes(owner),
    ),
    deposited: economy.deposited.filter((income) => income.owner === owner),
    sites: economy.sites,
    loot: economy.loot,
    harvesters: economy.harvesters.filter(({ actorId }) => ownsActor(actorId)),
    production: economy.production.filter(({ producerId }) =>
      ownsActor(producerId),
    ),
    ...(economy.cultivation && {
      cultivation: {
        sites: economy.cultivation.sites,
        workers: economy.cultivation.workers.filter(({ actorId }) =>
          ownsActor(actorId),
        ),
      },
    }),
  };
}
/** Sites that can still be gathered; renewable sites always can. */
export const activeSites = (economy: EconomyView | undefined) => [
  ...(economy?.sites ?? []).filter((site) => site.remainingMaterials > 0),
  ...(economy?.cultivation?.sites ?? []),
];

/** Workers whose gathering capability accepts this site. */
export function workersForSite(
  economy: EconomyView | undefined,
  siteId: string | undefined,
) {
  if (economy?.sites.some((site) => site.id === siteId))
    return economy.harvesters;
  if (economy?.cultivation?.sites.some((site) => site.id === siteId))
    return economy.cultivation.workers;
  return [];
}
/** Explicit actor orders stop automatic work while retaining onboard cargo. */
export function interruptWorker(actor: Actor, economy?: EconomyState) {
  interruptCultivation(actor, economy);
  interruptHarvesting(actor, economy);
}

/** Automatic work owns the actor until it ends or is explicitly replaced. */
export function workerHasOrder(
  economy: EconomyView | undefined,
  actorId: string,
) {
  const cultivator = economy?.cultivation?.workers.find(
    (worker) => worker.actorId === actorId,
  );
  if (cultivator)
    return !!(
      cultivator.siteId ||
      cultivator.tendingId ||
      cultivator.dropoffId ||
      cultivator.phase === "returning" ||
      cultivator.phase === "no-dropoff"
    );
  return !!economy?.harvesters.some(
    (worker) =>
      worker.actorId === actorId &&
      ["travelling", "gathering", "returning"].includes(worker.phase),
  );
}
/** Workers gathering, or tending growth that holds an active slot. */
export function workingWorkerIds(
  economy: EconomyView | undefined,
  actors: readonly ActorRenderState[],
) {
  const growth = new Set(
    actors
      .filter((actor) => actor.construction?.active)
      .map((actor) => actor.id),
  );
  return new Set(
    economyWorkers(economy)
      .filter(
        (worker) =>
          worker.phase === "gathering" ||
          ("tendingId" in worker &&
            worker.tendingId &&
            growth.has(worker.tendingId)),
      )
      .map((worker) => worker.actorId),
  );
}

export type EconomyReason =
  | "invalid-harvester"
  | "missing-site"
  | "missing-refinery"
  | "refinery-occupied"
  | "empty-cargo"
  | "missing-order"
  | "invalid-cultivator"
  | "invalid-growth"
  | "tender-occupied";

export const lootResource = (loot: Readonly<ResourceLoot>): Resource =>
  RESOURCE_IDS.find((id) => loot[id] !== undefined)!;
export const lootAmount = (loot: Readonly<ResourceLoot>): number =>
  loot[lootResource(loot)]!;
/** Owners without a stockpile of loot's resource, such as wildlife, skip it. */
export const collectsLoot = (
  ledger: LedgerView,
  owner: string,
  loot: Readonly<ResourceLoot>,
) =>
  !loot.collected && balanceOf(ledger, owner, lootResource(loot)) !== undefined;

/** Half the construction cost, scaled by remaining health and rounded down. */
export function saleRefund(
  actor: Pick<ActorRenderState, "health">,
  definition: ActorDefinition,
): number {
  const max = definition.health ?? 1;
  return Math.floor(
    (costAmount(definition) * healthOf(actor, max)) / (2 * max),
  );
}

export function validateEconomyDefinitions(
  definitions: ReadonlyMap<string, ActorDefinition>,
): void {
  for (const definition of definitions.values()) {
    const priced = definedPrices(definition);
    if (
      priced.length > 1 ||
      !priced.every(isCount) ||
      (definition.trainingSeconds !== undefined &&
        !isNonnegative(definition.trainingSeconds))
    )
      throw new RangeError(`Invalid economy definition: ${definition.id}.`);
    if (
      definition.constructionSeconds !== undefined &&
      (!definition.footprint || !isNonnegative(definition.constructionSeconds))
    )
      throw new RangeError(
        `Invalid construction definition: ${definition.id}.`,
      );
    for (const id of definition.production?.unitDefinitionIds ?? []) {
      if (
        definitions.get(id)?.harvesting &&
        definition.refinery?.harvesterDefinitionId !== id
      )
        throw new RangeError(
          `Harvester production needs a Refinery: ${definition.id}.`,
        );
    }
  }
  validateHarvestingDefinitions(definitions);
  validateCultivationDefinitions(definitions);
  validateInfrastructureDefinitions(definitions);
  validateGrowthDefinitions(definitions);
}

/** Validates saved state before any terrain or occupancy is published. */
export function validateEconomyState(
  economy: EconomyState,
  {
    actors,
    definitions,
    map,
    tickSeconds,
    retiredIds,
    owners,
    sharesResources,
  }: {
    actors: readonly Actor[];
    definitions: ReadonlyMap<string, ActorDefinition>;
    map: TerrainView | undefined;
    tickSeconds: number;
    retiredIds: readonly string[];
    owners: ReadonlySet<string>;
    sharesResources: SharesResources;
  },
): void {
  const invalid = () => {
    throw new RangeError("Mission has invalid economy state.");
  };
  if (
    !map ||
    !economy ||
    !isValidLedger(economy, owners, sharesResources) ||
    !Array.isArray(economy.sites) ||
    !Array.isArray(economy.loot) ||
    !Array.isArray(economy.harvesters) ||
    !Array.isArray(economy.production) ||
    (economy.cultivation && !Array.isArray(economy.cultivation.sites))
  )
    return invalid();
  const validTile = (tile: TileCoord) =>
    isTileCoord(tile) && map.containsTile(tile.x, tile.z);
  const ids = new Set<string>();
  const tiles = new Set<string>();
  for (const site of [...economySites(economy), ...economy.loot]) {
    if (
      !site ||
      !isId(site.id) ||
      typeof site.name !== "string" ||
      !validTile(site.tile) ||
      ids.has(site.id) ||
      tiles.has(tileKey(site.tile))
    )
      return invalid();
    ids.add(site.id);
    tiles.add(tileKey(site.tile));
  }
  for (const loot of economy.loot) {
    if (
      RESOURCE_IDS.filter((id) => loot[id] !== undefined).length !== 1 ||
      !isCount(lootAmount(loot)) ||
      lootAmount(loot) === 0 ||
      !economy.stockpiles.some(
        ({ resource }) => resource === lootResource(loot),
      ) ||
      typeof loot.collected !== "boolean"
    )
      return invalid();
  }
  validateCultivation(economy, actors, definitions, tickSeconds);
  validateInfrastructure(actors, definitions);
  const byId = new Map(actors.map((actor) => [actor.id, actor]));
  if (
    !hasValidHarvesting(economy, byId, definitions, tickSeconds) ||
    !isValidProductionQueue(economy, {
      actors: byId,
      retiredIds,
      definitions,
      tickSeconds,
    })
  )
    return invalid();
}

export type EconomyWorld = {
  actors: Actor[];
  /** Whether a building's owner may use a headquarters owner's queue. */
  sharesHeadquarters: SharesHeadquarters;
  /** Whether an owner without a headquarters may run one replacement job. */
  emergencyHeadquarters: boolean;
  /** Whether a worker's owner knows a resource site's tile. */
  knowsTile: (owner: string, tile: TileCoord) => boolean;
  /** Last-seen yield, or undefined if the site has never been observed. */
  knownMaterials: (
    owner: string,
    site: Readonly<MaterialsSite>,
  ) => number | undefined;
  definitions: ReadonlyMap<string, ActorDefinition>;
  behaviors: ReadonlyMap<string, ActorBehavior>;
  map: TerrainView;
  tickSeconds: number;
  move: (actor: Actor, target: WorldPosition) => boolean;
  evaluateSpawn: (job: ProductionJob) => TrainingEvaluation;
  support: () => SupportView;
  spawn: (actor: Actor, producerId: string) => void;
  deliver: (refineryId: string, actorId: string) => void;
  income?: (
    owner: string,
    resource: Resource,
    amount: number,
    sources: readonly CargoSource[],
  ) => void;
  complete?: (actor: Actor) => void;
};

export type EconomyCommandHooks = {
  retire: (actorId: string) => void;
  /** Returns a cancelled job's payment to its owner. */
  refund: (owner: string, definition: ActorDefinition, amount: number) => void;
};

export function applyEconomyCommand(
  command: EconomyCommand,
  economy: EconomyState,
  actors: Actor[],
  definitions: ReadonlyMap<string, ActorDefinition>,
  { retire, refund }: EconomyCommandHooks,
): EconomyReason | undefined {
  if (command.kind === "cancel-production") {
    const job = cancelProduction(economy.production, command.actorId);
    if (!job) return "missing-order";
    const producer = actors.find((actor) => actor.id === job.producerId)!;
    refund(producer.owner, definitions.get(job.definitionId)!, job.paidCost);
    retire(job.actorId);
    return;
  }
  const actor = actors.find((actor) => actor.id === command.actorId);
  if (
    command.kind === "tend" ||
    (actor && definitions.get(actor.definitionId)?.cultivation)
  )
    return applyCultivationCommand(command, economy, actors, definitions);
  return applyHarvestingCommand(command, economy, actor, actors, definitions);
}

/**
 * Loss of a producer loses its paid orders, while onboard cargo survives.
 * Returns workers whose automated movement the loss interrupts.
 */
export function removeEconomyActor(
  economy: EconomyState,
  actorId: string,
  retire: (id: string) => void,
): string[] {
  const interrupted: string[] = [];
  removeProducer(economy, actorId, retire);
  if (economy.cultivation) {
    economy.cultivation.workers = economy.cultivation.workers.filter(
      (worker) => worker.actorId !== actorId,
    );
    for (const worker of economy.cultivation.workers) {
      if (worker.tendingId === actorId) {
        interrupted.push(worker.actorId);
        delete worker.tendingId;
        worker.phase = "idle";
      }
      if (worker.dropoffId === actorId) {
        interrupted.push(worker.actorId);
        delete worker.dropoffId;
        worker.phase = "returning";
      }
    }
  }
  interrupted.push(...removeHarvestingActor(economy, actorId));
  return interrupted;
}

/** Advances work in stable actor-ID order against the staged tick. */
export function updateEconomy(
  economy: EconomyState,
  world: EconomyWorld,
): void {
  const { actors, definitions, map } = world;
  if (economy.cultivation) updateCultivation(economy, world);
  updateInfrastructure(economy, world);
  const disconnected = disconnectedBuildings(world.support());
  const byId = new Map(actors.map((actor) => [actor.id, actor]));
  advanceProduction(economy.production, {
    paused: (id) => disconnected.has(id),
    evaluateSpawn: world.evaluateSpawn,
    spawn: ({ actorId, definitionId, producerId }, actor) => {
      enrollWorker(
        economy,
        actorId,
        definitions.get(definitionId)!,
        producerId,
      );
      world.spawn(actor, producerId);
      byId.set(actor.id, actor);
    },
  });
  updateHarvesting(economy, world, byId, disconnected);
  const near = (actor: Actor, point: WorldPosition) =>
    distance(actor.worldPosition, point) < map.tileSize * 0.3;
  for (const loot of economy.loot) {
    if (loot.collected) continue;
    const point = map.tileCenter(loot.tile.x, loot.tile.z);
    const collector = actors
      .filter(
        (actor) =>
          definitions.get(actor.definitionId)?.movement &&
          collectsLoot(economy, actor.owner, loot) &&
          near(actor, point),
      )
      .sort(nearestTo(point))[0];
    if (!collector) continue;
    loot.collected = true;
    credit(economy, collector.owner, lootResource(loot), lootAmount(loot));
  }
}
