import { clearCombatOrders, compareIds } from "./actor";
import { depositCargo, gatherCargo, validCargoSources } from "./cargo";
import { secondsToTicks } from "./clock";
import { isTilePlacedActor } from "./placement";
import { refineryOccupied } from "./production";
import { materialsCost, RESOURCE_SCALE } from "./resources";
import { balanceOf } from "./stockpiles";
import { isCount, isPositive } from "./validation";
import { advanceWorkerRoute, workerNavigation } from "./worker-navigation";

import type { Actor, ActorDefinition, ActorRenderState } from "./actor";
import type { CargoSource } from "./cargo";
import type { EconomyCommand } from "./command";
import type {
  EconomyReason,
  EconomyState,
  EconomyView,
  EconomyWorld,
} from "./economy";
import type { TileCoord } from "./grid";
import type { WorldPosition } from "./world";

export type MaterialsSite = {
  id: string;
  name: string;
  tile: TileCoord;
  initialMaterials: number;
  remainingMaterials: number;
};
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

export function interruptHarvesting(actor: Actor, economy?: EconomyState) {
  const worker = economy?.harvesters.find(
    (worker) => worker.actorId === actor.id,
  );
  if (!worker) return;
  worker.phase = worker.refineryId ? "idle" : "unassigned";
  delete worker.targetSiteId;
  delete worker.activeSiteId;
  delete worker.retryNavigationVersion;
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

export function applyHarvestingCommand(
  command: EconomyCommand,
  economy: EconomyState,
  actor: Actor | undefined,
  actors: readonly Actor[],
  definitions: ReadonlyMap<string, ActorDefinition>,
): EconomyReason | undefined {
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
 * Drops a lost Harvester and unassigns those of a lost Refinery. Returns
 * workers whose automated movement the loss interrupts.
 */
export function removeHarvestingActor(
  economy: EconomyState,
  actorId: string,
): string[] {
  const interrupted: string[] = [];
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

/** Advances Harvesters in stable actor-ID order against the staged tick. */
export function updateHarvesting(
  economy: EconomyState,
  world: EconomyWorld,
  actorsById: ReadonlyMap<string, Actor>,
  disconnected: ReadonlySet<string>,
) {
  const { definitions, map, tickSeconds } = world;
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
    const refinery = actorsById.get(refineryId);
    return refinery && entrance(actor, refinery);
  };
  for (const worker of [...economy.harvesters].sort((a, b) =>
    compareIds(a.actorId, b.actorId),
  )) {
    const actor = actorsById.get(worker.actorId)!;
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
}

export function validateHarvestingDefinitions(
  definitions: ReadonlyMap<string, ActorDefinition>,
): void {
  for (const definition of definitions.values()) {
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
}

/** Checks saved Materials sites and Harvesters, every one of which an actor needs. */
export function hasValidHarvesting(
  economy: EconomyState,
  actorsById: ReadonlyMap<string, Actor>,
  definitions: ReadonlyMap<string, ActorDefinition>,
  tickSeconds: number,
): boolean {
  if (
    economy.sites.some(
      (site) =>
        !isCount(site.initialMaterials) ||
        site.initialMaterials === 0 ||
        !isCount(site.remainingMaterials) ||
        site.remainingMaterials > site.initialMaterials,
    )
  )
    return false;
  const assigned = new Set<string>();
  const workers = new Set<string>();
  const sourceIds = new Set(economy.sites.map((site) => site.id));
  for (const worker of economy.harvesters) {
    const actor = actorsById.get(worker?.actorId);
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
      return false;
    workers.add(worker.actorId);
    if (worker.refineryId !== undefined) {
      const refinery = actorsById.get(worker.refineryId);
      if (
        !refinery ||
        !isTilePlacedActor(refinery) ||
        refinery.construction !== undefined ||
        refinery.owner !== actor!.owner ||
        definitions.get(refinery.definitionId)?.refinery
          ?.harvesterDefinitionId !== actor!.definitionId ||
        assigned.has(worker.refineryId)
      )
        return false;
      assigned.add(worker.refineryId);
    }
  }
  return ![...actorsById.values()].some(
    (actor) =>
      definitions.get(actor.definitionId)?.harvesting && !workers.has(actor.id),
  );
}
