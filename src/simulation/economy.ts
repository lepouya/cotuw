import { clearCombatOrders, compareIds, healthOf, nearestTo } from "./actor";
import { depositCargo, gatherCargo, validCargoSources } from "./cargo";
import { secondsToTicks } from "./clock";
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
  updateInfrastructure,
  validateInfrastructure,
  validateInfrastructureDefinitions,
} from "./infrastructure";
import { isTilePlacedActor } from "./placement";
import {
  advanceProduction,
  cancelProduction,
  isValidProductionQueue,
  refineryOccupied,
  removeProducer,
} from "./production";
import {
  costAmount,
  definedPrices,
  materialsCost,
  RESOURCE_IDS,
  RESOURCE_SCALE,
} from "./resources";
import { balanceOf, credit, isValidLedger } from "./stockpiles";
import { disconnectedBuildings } from "./support";
import { isCount, isId, isNonnegative, isPositive } from "./validation";
import { advanceWorkerRoute, workerNavigation } from "./worker-navigation";
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
import type { TileCoord } from "./grid";
import type { SharesHeadquarters } from "./infrastructure";
import type { ProductionJob, TrainingEvaluation } from "./production";
import type { Resource } from "./resources";
import type { Ledger, LedgerView, SharesResources } from "./stockpiles";
import type { SupportView } from "./support";
import type { TerrainView } from "./terrain";
import type { WorldPosition } from "./world";

export type MaterialsSite = {
  id: string;
  name: string;
  tile: TileCoord;
  initialMaterials: number;
  remainingMaterials: number;
};
export type ResourceLoot = {
  id: string;
  name: string;
  tile: TileCoord;
  collected: boolean;
} & (
  | { materials: number; lifebloom?: never }
  | { lifebloom: number; materials?: never }
);
const HARVESTER_PHASES = [
  "idle",
  "travelling",
  "gathering",
  "returning",
  "depleted",
  "blocked",
  "unassigned",
] as const;
export type HarvesterState = {
  actorId: string;
  refineryId?: string;
  cargo: number;
  cargoSources?: CargoSource[];
  gatherProgress: number;
  targetSiteId?: string;
  activeSiteId?: string;
  phase: (typeof HARVESTER_PHASES)[number];
  /** Navigation version a blocked Harvester waits to change before retrying. */
  retryNavigationVersion?: number;
};

export function createHarvesterState(
  actorId: string,
  refineryId?: string,
): HarvesterState {
  return {
    actorId,
    ...(refineryId !== undefined && { refineryId }),
    cargo: 0,
    gatherProgress: 0,
    phase: refineryId === undefined ? "unassigned" : "idle",
  };
}
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
  const worker = economy?.harvesters.find(
    (worker) => worker.actorId === actor.id,
  );
  if (!worker) return;
  worker.phase = worker.refineryId ? "idle" : "unassigned";
  delete worker.targetSiteId;
  delete worker.activeSiteId;
  delete worker.retryNavigationVersion;
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
    const gathering = definition.harvesting;
    if (
      gathering &&
      (!definition.movement ||
        !isCount(gathering.capacity) ||
        !isCount(gathering.capacity * RESOURCE_SCALE) ||
        gathering.capacity === 0 ||
        !isPositive(gathering.loadSeconds) ||
        !isCount(gathering.patchRadius))
    )
      throw new RangeError(`Invalid harvesting definition: ${definition.id}.`);
    if (
      definition.refinery &&
      (!definition.production?.unitDefinitionIds.includes(
        definition.refinery.harvesterDefinitionId,
      ) ||
        !definitions.get(definition.refinery.harvesterDefinitionId)?.harvesting)
    )
      throw new RangeError(`Invalid refinery definition: ${definition.id}.`);
  }
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
  for (const site of economy.sites) {
    if (
      !isCount(site.initialMaterials) ||
      site.initialMaterials === 0 ||
      !isCount(site.remainingMaterials) ||
      site.remainingMaterials > site.initialMaterials
    )
      return invalid();
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
  const assigned = new Set<string>();
  const workers = new Set<string>();
  const sourceIds = new Set(economy.sites.map((site) => site.id));
  for (const worker of economy.harvesters) {
    const actor = byId.get(worker?.actorId);
    const gathering = actor && definitions.get(actor.definitionId)?.harvesting;
    if (
      !gathering ||
      workers.has(worker.actorId) ||
      !validCargoSources(worker, worker.cargo * RESOURCE_SCALE, sourceIds) ||
      !isCount(worker.cargo) ||
      worker.cargo > gathering.capacity ||
      !isCount(worker.gatherProgress) ||
      worker.gatherProgress >=
        secondsToTicks(gathering.loadSeconds, tickSeconds) ||
      !HARVESTER_PHASES.includes(worker.phase) ||
      (worker.retryNavigationVersion !== undefined &&
        !isCount(worker.retryNavigationVersion)) ||
      (worker.targetSiteId !== undefined &&
        !sourceIds.has(worker.targetSiteId)) ||
      (worker.activeSiteId !== undefined && !sourceIds.has(worker.activeSiteId))
    )
      return invalid();
    workers.add(worker.actorId);
    if (worker.refineryId !== undefined) {
      const refinery = byId.get(worker.refineryId);
      if (
        !refinery ||
        !isTilePlacedActor(refinery) ||
        refinery.construction !== undefined ||
        refinery.owner !== actor!.owner ||
        definitions.get(refinery.definitionId)?.refinery
          ?.harvesterDefinitionId !== actor!.definitionId ||
        assigned.has(worker.refineryId)
      )
        return invalid();
      assigned.add(worker.refineryId);
    }
  }
  if (
    actors.some(
      (actor) =>
        definitions.get(actor.definitionId)?.harvesting &&
        !workers.has(actor.id),
    ) ||
    !isValidProductionQueue(economy, {
      actors: byId,
      retiredIds,
      definitions,
      tickSeconds,
    })
  )
    return invalid();
}

/** Cheapest Refinery and Harvester pair the owner of `actors` still needs. */
export function harvestingRecoveryCost(
  economy: Pick<EconomyView, "harvesters" | "production">,
  actors: readonly ActorRenderState[],
  definitions: ReadonlyMap<string, ActorDefinition>,
): number {
  let cost = Infinity;
  for (const definition of definitions.values()) {
    if (!definition.refinery) continue;
    const available = actors.some(
      (actor) =>
        actor.definitionId === definition.id &&
        !actor.construction &&
        !refineryOccupied(economy, actor.id),
    );
    cost = Math.min(
      cost,
      (available ? 0 : materialsCost(definition)) +
        materialsCost(
          definitions.get(definition.refinery.harvesterDefinitionId)!,
        ),
    );
  }
  return cost;
}

/**
 * Whether an owner has no Harvester, fielded or paid, and too few Materials
 * for the cheapest way to field one.
 */
export function harvestingStalled(
  economy: EconomyView,
  owner: string,
  actors: readonly ActorRenderState[],
  definitions: ReadonlyMap<string, ActorDefinition>,
) {
  const ownedActors = actors.filter((actor) => actor.owner === owner);
  const owned = new Set(ownedActors.map((actor) => actor.id));
  return (
    !economy.harvesters.some((worker) => owned.has(worker.actorId)) &&
    !economy.production.some(
      (job) =>
        owned.has(job.producerId) &&
        definitions.get(job.definitionId)?.harvesting,
    ) &&
    (balanceOf(economy, owner, "materials") ?? 0) <
      harvestingRecoveryCost(economy, ownedActors, definitions)
  );
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
  const worker = economy.harvesters.find(
    (worker) => worker.actorId === command.actorId,
  );
  if (!worker || !actor) return "invalid-harvester";
  if (command.kind === "assign-refinery") {
    const refinery = actors.find((actor) => actor.id === command.refineryId);
    if (
      !refinery ||
      refinery.construction !== undefined ||
      refinery.owner !== actor.owner ||
      definitions.get(refinery.definitionId)?.refinery
        ?.harvesterDefinitionId !== actor.definitionId
    )
      return "missing-refinery";
    if (
      worker.refineryId !== refinery.id &&
      refineryOccupied(economy, refinery.id)
    )
      return "refinery-occupied";
    worker.refineryId = refinery.id;
    if (worker.cargo) worker.phase = "returning";
    else worker.phase = worker.targetSiteId ? "travelling" : "idle";
  } else if (command.kind === "gather") {
    if (!economy.sites.some((site) => site.id === command.siteId))
      return "missing-site";
    if (!worker.refineryId) return "missing-refinery";
    worker.targetSiteId = command.siteId;
    worker.phase = worker.cargo ? "returning" : "travelling";
  } else {
    if (!worker.refineryId) return "missing-refinery";
    if (!worker.cargo) return "empty-cargo";
    worker.phase = "returning";
  }
  delete actor.movement;
  clearCombatOrders(actor);
  delete worker.activeSiteId;
  delete worker.retryNavigationVersion;
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
  economy.harvesters = economy.harvesters.filter(
    (worker) => worker.actorId !== actorId,
  );
  for (const worker of economy.harvesters) {
    if (worker.refineryId !== actorId) continue;
    // Idle Harvesters keep manual movement.
    if (worker.phase !== "idle") interrupted.push(worker.actorId);
    delete worker.refineryId;
    worker.phase = "unassigned";
  }
  return interrupted;
}

/** Advances work in stable actor-ID order against the staged tick. */
export function updateEconomy(
  economy: EconomyState,
  world: EconomyWorld,
): void {
  const { actors, definitions, map, tickSeconds } = world;
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
  const { reachable, entrance } = workerNavigation(world);
  const block = (worker: HarvesterState) => {
    worker.phase = "blocked";
    worker.retryNavigationVersion = map.navigationChanges.version;
  };
  /** Whether the actor has arrived; otherwise keeps or starts its route. */
  const routeTo = (
    actor: Actor,
    worker: HarvesterState,
    target: WorldPosition,
  ) => {
    const result = advanceWorkerRoute(actor, target, world, map.tileSize * 0.3);
    if (result === "blocked") block(worker);
    return result === "arrived";
  };
  const refineryExit = (actor: Actor, refineryId: string) => {
    const refinery = byId.get(refineryId);
    return refinery && entrance(actor, refinery);
  };
  for (const worker of [...economy.harvesters].sort((a, b) =>
    compareIds(a.actorId, b.actorId),
  )) {
    const actor = byId.get(worker.actorId)!;
    const gathering = definitions.get(actor.definitionId)!.harvesting!;
    if (!worker.refineryId) {
      worker.phase = "unassigned";
      continue;
    }
    if (worker.phase === "idle" || worker.phase === "depleted") continue;
    if (worker.phase === "blocked") {
      if (worker.retryNavigationVersion === map.navigationChanges.version)
        continue;
      worker.phase = worker.cargo ? "returning" : "travelling";
      delete worker.retryNavigationVersion;
      delete actor.movement;
    }
    if (worker.phase === "returning") {
      // Automated routes are the only movement while returning.
      const destination =
        actor.movement?.target ?? refineryExit(actor, worker.refineryId);
      if (!destination) {
        block(worker);
      } else if (routeTo(actor, worker, destination)) {
        if (disconnected.has(worker.refineryId)) continue;
        depositCargo(
          economy,
          world,
          actor.owner,
          "materials",
          worker,
          worker.refineryId,
        );
        worker.phase = worker.targetSiteId ? "travelling" : "idle";
        delete worker.activeSiteId;
      }
      continue;
    }
    const target = economy.sites.find(
      (site) => site.id === worker.targetSiteId,
    );
    if (!target) {
      worker.phase = "idle";
      continue;
    }
    // Unknown yields can be investigated; unseen depletion cannot end a route.
    const available = (site: MaterialsSite) =>
      world.knowsTile(actor.owner, site.tile) &&
      world.knownMaterials(actor.owner, site) !== 0;
    let site = economy.sites.find(
      (site) => site.id === worker.activeSiteId && available(site),
    );
    if (!site) {
      const candidates = economy.sites
        .filter(
          (site) =>
            available(site) &&
            Math.abs(site.tile.x - target.tile.x) <= gathering.patchRadius &&
            Math.abs(site.tile.z - target.tile.z) <= gathering.patchRadius,
        )
        .sort(
          (a, b) =>
            Math.hypot(a.tile.x - target.tile.x, a.tile.z - target.tile.z) -
              Math.hypot(b.tile.x - target.tile.x, b.tile.z - target.tile.z) ||
            a.tile.z - b.tile.z ||
            a.tile.x - b.tile.x,
        );
      site = candidates.find((site) =>
        reachable(actor, map.tileCenter(site.tile.x, site.tile.z)),
      );
      delete actor.movement;
      if (!site) {
        if (candidates.length) block(worker);
        else worker.phase = worker.cargo ? "returning" : "depleted";
        continue;
      }
      worker.activeSiteId = site.id;
      worker.phase = "travelling";
    }
    const point = map.tileCenter(site.tile.x, site.tile.z);
    if (!routeTo(actor, worker, point)) continue;
    worker.phase = "gathering";
    const loadTicks = secondsToTicks(gathering.loadSeconds, tickSeconds);
    worker.gatherProgress += gathering.capacity;
    // Large cargo values must not add one loop iteration per Material.
    const collected = Math.min(
      Math.floor(worker.gatherProgress / loadTicks),
      site.remainingMaterials,
      gathering.capacity - worker.cargo,
    );
    worker.gatherProgress -= collected * loadTicks;
    site.remainingMaterials -= collected;
    gatherCargo(worker, site.id, collected * RESOURCE_SCALE);
    worker.cargo += collected;
    if (worker.cargo === gathering.capacity) {
      worker.gatherProgress = 0;
      worker.phase = "returning";
      delete worker.activeSiteId;
    } else if (site.remainingMaterials === 0) {
      worker.gatherProgress %= loadTicks;
      delete worker.activeSiteId;
    }
  }
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
