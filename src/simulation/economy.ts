import { isTileCoord, tileKey } from "./grid";
import {
  adjacentTiles,
  isTilePlacedActor,
  occupiedTilesFor,
} from "./placement";
import { findNavigationPath } from "./navigation";
import { disconnectedBuildings } from "./support";
import { secondsToTicks } from "./clock";
import { isCount } from "./validation";

import type {
  Actor,
  ActorDefinition,
  ActorBehavior,
  ActorRenderState,
  DeepReadonly,
} from "./actor";
import type { TileCoord } from "./grid";
import type { TerrainView } from "./terrain";
import { clearCombatOrders, compareIds, healthOf } from "./actor";
import { playerRelation } from "./faction";
import { distance } from "./world";
import type { WorldPosition } from "./world";
import type { TrainingEvaluation } from "./production";
import type { EconomyCommand } from "./command";
import type { SupportView } from "./support";

export type MaterialsSite = {
  id: string;
  name: string;
  tile: TileCoord;
  initialMaterials: number;
  remainingMaterials: number;
};
export type MaterialsLoot = {
  id: string;
  name: string;
  tile: TileCoord;
  materials: number;
  collected: boolean;
};
export const HARVESTER_PHASES = [
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
export type ProductionJob = {
  actorId: string;
  producerId: string;
  definitionId: string;
  paidMaterials: number;
  completedTicks: number;
  totalTicks: number;
  exitBlocked: boolean;
};
export type EconomyState = {
  materials: number;
  depositedMaterials: number;
  sites: MaterialsSite[];
  loot: MaterialsLoot[];
  harvesters: HarvesterState[];
  production: ProductionJob[];
};
export type EconomyView = DeepReadonly<EconomyState>;
export type EconomyReason =
  | "invalid-harvester"
  | "missing-site"
  | "missing-refinery"
  | "refinery-occupied"
  | "empty-cargo"
  | "missing-order";

/** Outstanding paid orders one producer may hold. */
export const PRODUCTION_QUEUE_LIMIT = 5;

export const materialsCost = (definition: ActorDefinition) =>
  definition.materialsCost ?? 0;

/** Half the construction cost, scaled by remaining health and rounded down. */
export function saleMaterialsRefund(
  actor: Pick<ActorRenderState, "health">,
  definition: ActorDefinition,
): number {
  const max = definition.health ?? 1;
  return Math.floor(
    (materialsCost(definition) * healthOf(actor, max)) / (2 * max),
  );
}

export function validateEconomyDefinitions(
  definitions: ReadonlyMap<string, ActorDefinition>,
): void {
  for (const definition of definitions.values()) {
    if (
      (definition.materialsCost !== undefined &&
        !isCount(definition.materialsCost)) ||
      (definition.trainingSeconds !== undefined &&
        (!Number.isFinite(definition.trainingSeconds) ||
          definition.trainingSeconds < 0))
    )
      throw new RangeError(`Invalid economy definition: ${definition.id}.`);
    if (
      definition.constructionSeconds !== undefined &&
      (!definition.footprint ||
        !Number.isFinite(definition.constructionSeconds) ||
        definition.constructionSeconds < 0)
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
        gathering.capacity === 0 ||
        !Number.isFinite(gathering.loadSeconds) ||
        gathering.loadSeconds <= 0 ||
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
}

/** Validates saved state before any terrain or occupancy is published. */
export function validateEconomyState(
  economy: EconomyState,
  actors: readonly Actor[],
  definitions: ReadonlyMap<string, ActorDefinition>,
  map: TerrainView | undefined,
  tickSeconds: number,
  retiredIds: readonly string[],
): void {
  const invalid = () => {
    throw new RangeError("Mission has invalid economy state.");
  };
  if (
    !map ||
    !economy ||
    !isCount(economy.materials) ||
    !isCount(economy.depositedMaterials) ||
    !Array.isArray(economy.sites) ||
    !Array.isArray(economy.loot) ||
    !Array.isArray(economy.harvesters) ||
    !Array.isArray(economy.production)
  )
    return invalid();
  const validTile = (tile: TileCoord) =>
    isTileCoord(tile) && map.containsTile(tile.x, tile.z);
  const ids = new Set<string>();
  const tiles = new Set<string>();
  for (const site of [...economy.sites, ...economy.loot]) {
    if (
      !site ||
      typeof site.id !== "string" ||
      !site.id ||
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
      !isCount(loot.materials) ||
      loot.materials === 0 ||
      typeof loot.collected !== "boolean"
    )
      return invalid();
  }
  const byId = new Map(actors.map((actor) => [actor.id, actor]));
  const assigned = new Set<string>();
  const workers = new Set<string>();
  for (const worker of economy.harvesters) {
    const actor = byId.get(worker?.actorId);
    const gathering = actor && definitions.get(actor.definitionId)?.harvesting;
    if (
      !gathering ||
      workers.has(worker.actorId) ||
      !isCount(worker.cargo) ||
      worker.cargo > gathering.capacity ||
      !isCount(worker.gatherProgress) ||
      worker.gatherProgress >=
        secondsToTicks(gathering.loadSeconds, tickSeconds) ||
      !HARVESTER_PHASES.includes(worker.phase) ||
      (worker.retryNavigationVersion !== undefined &&
        !isCount(worker.retryNavigationVersion)) ||
      (worker.targetSiteId !== undefined &&
        !economy.sites.some((site) => site.id === worker.targetSiteId)) ||
      (worker.activeSiteId !== undefined &&
        !economy.sites.some((site) => site.id === worker.activeSiteId))
    )
      return invalid();
    workers.add(worker.actorId);
    if (worker.refineryId !== undefined) {
      const refinery = byId.get(worker.refineryId);
      if (
        !refinery ||
        !isTilePlacedActor(refinery) ||
        refinery.construction !== undefined ||
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
    )
  )
    return invalid();
  const jobIds = new Set([...byId.keys(), ...retiredIds]);
  const queues = new Map<string, number>();
  for (const job of economy.production) {
    const producer = byId.get(job?.producerId);
    const unit = job && definitions.get(job.definitionId);
    if (
      !producer ||
      producer.construction !== undefined ||
      !unit ||
      typeof job.actorId !== "string" ||
      !job.actorId ||
      jobIds.has(job.actorId) ||
      !definitions
        .get(producer.definitionId)
        ?.production?.unitDefinitionIds.includes(unit.id) ||
      job.paidMaterials !== materialsCost(unit) ||
      !isCount(job.completedTicks) ||
      job.totalTicks !== secondsToTicks(unit.trainingSeconds, tickSeconds) ||
      job.completedTicks > job.totalTicks ||
      typeof job.exitBlocked !== "boolean"
    )
      return invalid();
    jobIds.add(job.actorId);
    const count = (queues.get(job.producerId) ?? 0) + 1;
    if (count > PRODUCTION_QUEUE_LIMIT) return invalid();
    queues.set(job.producerId, count);
    if (unit.harvesting) {
      if (
        assigned.has(job.producerId) ||
        definitions.get(producer.definitionId)?.refinery
          ?.harvesterDefinitionId !== unit.id
      )
        return invalid();
      assigned.add(job.producerId);
    }
  }
}

export function refineryOccupied(
  economy: Pick<EconomyView, "harvesters" | "production">,
  refineryId: string,
) {
  return (
    economy.harvesters.some((worker) => worker.refineryId === refineryId) ||
    economy.production.some((job) => job.producerId === refineryId)
  );
}

/** Cost of the cheapest Refinery and Harvester pair still needed. */
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

export type EconomyWorld = {
  actors: Actor[];
  playerFaction?: string;
  explored: (tile: TileCoord) => boolean;
  definitions: ReadonlyMap<string, ActorDefinition>;
  behaviors: ReadonlyMap<string, ActorBehavior>;
  map: TerrainView;
  tickSeconds: number;
  move: (actor: Actor, target: WorldPosition) => boolean;
  evaluateSpawn: (job: ProductionJob) => TrainingEvaluation;
  support: () => SupportView;
  spawn: (actor: Actor, producerId: string) => void;
  deliver: (refineryId: string, actorId: string) => void;
};

export function applyEconomyCommand(
  command: EconomyCommand,
  economy: EconomyState,
  actors: Actor[],
  definitions: ReadonlyMap<string, ActorDefinition>,
  retire: (actorId: string) => void,
): EconomyReason | undefined {
  if (command.kind === "cancel-production") {
    const index = economy.production.findIndex(
      (job) => job.actorId === command.actorId,
    );
    if (index < 0) return "missing-order";
    const [job] = economy.production.splice(index, 1);
    economy.materials += job.paidMaterials;
    retire(job.actorId);
    return;
  }
  const worker = economy.harvesters.find(
    (worker) => worker.actorId === command.actorId,
  );
  const actor = actors.find((actor) => actor.id === command.actorId);
  if (!worker || !actor) return "invalid-harvester";
  if (command.kind === "assign-refinery") {
    const refinery = actors.find((actor) => actor.id === command.refineryId);
    if (
      !refinery ||
      refinery.construction !== undefined ||
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
    worker.phase = worker.cargo
      ? "returning"
      : worker.targetSiteId
        ? "travelling"
        : "idle";
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
  return;
}

/**
 * Loss of a producer loses its paid orders, while onboard cargo survives.
 * Returns the Harvesters whose automated movement the loss interrupts.
 */
export function removeEconomyActor(
  economy: EconomyState,
  actorId: string,
  retire: (id: string) => void,
): string[] {
  for (const job of economy.production)
    if (job.producerId === actorId) retire(job.actorId);
  economy.production = economy.production.filter(
    (job) => job.producerId !== actorId,
  );
  economy.harvesters = economy.harvesters.filter(
    (worker) => worker.actorId !== actorId,
  );
  const interrupted: string[] = [];
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
  const { actors, definitions, map, tickSeconds, move } = world;
  let disconnected = disconnectedBuildings(world.support());
  // Paused blueprints yield the slot without losing their queue priority.
  const building = actors.find(
    (actor) => actor.construction && !disconnected.has(actor.id),
  );
  if (building?.construction) {
    building.construction.completedTicks += 1;
    if (
      building.construction.completedTicks === building.construction.totalTicks
    ) {
      delete building.construction;
      disconnected = disconnectedBuildings(world.support());
    }
  }
  const byId = new Map(actors.map((actor) => [actor.id, actor]));
  const producers = [
    ...new Set(economy.production.map((job) => job.producerId)),
  ].sort();
  for (const id of producers) {
    if (disconnected.has(id)) continue;
    const job = economy.production.find((job) => job.producerId === id)!;
    if (job.completedTicks < job.totalTicks) job.completedTicks += 1;
    if (job.completedTicks < job.totalTicks) continue;
    const result = world.evaluateSpawn(job);
    job.exitBlocked = !result.accepted;
    if (!("actor" in result)) continue;
    economy.production.splice(economy.production.indexOf(job), 1);
    if (definitions.get(job.definitionId)?.harvesting) {
      economy.harvesters.push(createHarvesterState(job.actorId, id));
    }
    world.spawn(result.actor, id);
    byId.set(result.actor.id, result.actor);
  }
  const near = (actor: Actor, point: WorldPosition) =>
    distance(actor.worldPosition, point) < map.tileSize * 0.3;
  const reachable = (actor: Actor, target: WorldPosition) => {
    const definition = definitions.get(actor.definitionId)!;
    const grid = world.behaviors
      .get(definition.behaviorId)
      ?.navigationGrid?.(actor, definition);
    return (
      grid &&
      findNavigationPath(grid, actor.worldPosition, target)?.reachedTarget
    );
  };
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
    if (near(actor, target)) {
      delete actor.movement;
      return true;
    }
    if (actor.movement) {
      if (actor.movement.blocked) block(worker);
    } else if (!reachable(actor, target) || !move(actor, target)) {
      block(worker);
    }
    return false;
  };
  /** The nearest reachable tile beside the Refinery. */
  const refineryExit = (actor: Actor, refineryId: string) => {
    const refinery = byId.get(refineryId);
    if (!refinery || !isTilePlacedActor(refinery)) return undefined;
    return adjacentTiles(
      map,
      occupiedTilesFor(refinery, definitions.get(refinery.definitionId)!),
    )
      .map((tile) => ({ tile, point: map.tileCenter(tile.x, tile.z) }))
      .sort(
        (a, b) =>
          distance(actor.worldPosition, a.point) -
            distance(actor.worldPosition, b.point) ||
          a.tile.z - b.tile.z ||
          a.tile.x - b.tile.x,
      )
      .find(({ point }) => reachable(actor, point))?.point;
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
        economy.materials += worker.cargo;
        economy.depositedMaterials += worker.cargo;
        world.deliver(worker.refineryId, worker.actorId);
        worker.cargo = 0;
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
    let site = economy.sites.find(
      (site) =>
        site.id === worker.activeSiteId &&
        site.remainingMaterials > 0 &&
        world.explored(site.tile),
    );
    if (!site) {
      const candidates = economy.sites
        .filter(
          (site) =>
            site.remainingMaterials > 0 &&
            world.explored(site.tile) &&
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
  for (const loot of economy.loot) {
    if (loot.collected) continue;
    const point = map.tileCenter(loot.tile.x, loot.tile.z);
    if (
      !actors.some(
        (actor) =>
          definitions.get(actor.definitionId)?.movement &&
          playerRelation(
            world.playerFaction,
            definitions.get(actor.definitionId)?.faction,
          ) === "own" &&
          near(actor, point),
      )
    )
      continue;
    loot.collected = true;
    economy.materials += loot.materials;
  }
}
