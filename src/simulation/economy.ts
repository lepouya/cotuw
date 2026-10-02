import { isTileCoord, tileKey } from "./grid";
import { isTilePlacedActor, occupiedTilesFor } from "./placement";
import { findNavigationPath } from "./navigation";

import type {
  Actor,
  ActorDefinition,
  ActorBehavior,
  DeepReadonly,
} from "./actor";
import type { TileCoord } from "./grid";
import type { TerrainView } from "./terrain";
import type { WorldPosition } from "./world";
import type { TrainingEvaluation } from "./production";
import type { EconomyCommand } from "./command";

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
export type HarvesterState = {
  actorId: string;
  refineryId?: string;
  cargo: number;
  gatherProgress: number;
  targetSiteId?: string;
  activeSiteId?: string;
  phase:
    | "idle"
    | "travelling"
    | "gathering"
    | "returning"
    | "depleted"
    | "blocked"
    | "unassigned";
  retryNavigationVersion?: number;
};
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

export const materialsCost = (definition: ActorDefinition) =>
  definition.materialsCost ?? 0;
export const trainingTicks = (
  definition: ActorDefinition,
  tickSeconds: number,
) => Math.max(1, Math.ceil((definition.trainingSeconds ?? 0) / tickSeconds));

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
        Math.max(1, Math.ceil(gathering.loadSeconds / tickSeconds)) ||
      ![
        "idle",
        "travelling",
        "gathering",
        "returning",
        "depleted",
        "blocked",
        "unassigned",
      ].includes(worker.phase) ||
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
      !unit ||
      typeof job.actorId !== "string" ||
      !job.actorId ||
      jobIds.has(job.actorId) ||
      !definitions
        .get(producer.definitionId)
        ?.production?.unitDefinitionIds.includes(unit.id) ||
      job.paidMaterials !== materialsCost(unit) ||
      !isCount(job.completedTicks) ||
      job.totalTicks !== trainingTicks(unit, tickSeconds) ||
      job.completedTicks > job.totalTicks ||
      typeof job.exitBlocked !== "boolean"
    )
      return invalid();
    jobIds.add(job.actorId);
    const count = (queues.get(job.producerId) ?? 0) + 1;
    if (count > 5) return invalid();
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

export type EconomyWorld = {
  actors: Actor[];
  definitions: ReadonlyMap<string, ActorDefinition>;
  behaviors: ReadonlyMap<string, ActorBehavior>;
  map: TerrainView;
  tickSeconds: number;
  move: (actor: Actor, target: WorldPosition) => boolean;
  evaluateSpawn: (job: ProductionJob) => TrainingEvaluation;
  spawn: (actor: Actor) => void;
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
  delete worker.activeSiteId;
  delete worker.retryNavigationVersion;
  return;
}

/** Loss of a producer loses its paid orders, while onboard cargo survives. */
export function removeEconomyActor(
  economy: EconomyState,
  actorId: string,
  retire: (id: string) => void,
) {
  for (const job of economy.production.filter(
    (job) => job.producerId === actorId,
  ))
    retire(job.actorId);
  economy.production = economy.production.filter(
    (job) => job.producerId !== actorId,
  );
  economy.harvesters = economy.harvesters.filter(
    (worker) => worker.actorId !== actorId,
  );
  for (const worker of economy.harvesters) {
    if (worker.refineryId !== actorId) continue;
    delete worker.refineryId;
    worker.phase = "unassigned";
  }
}

/** Advances work in stable actor-ID order against the staged tick. */
export function updateEconomy(
  economy: EconomyState,
  world: EconomyWorld,
): void {
  const { actors, definitions, map, tickSeconds, move } = world;
  const byId = new Map(actors.map((actor) => [actor.id, actor]));
  const producers = [
    ...new Set(economy.production.map((job) => job.producerId)),
  ].sort();
  for (const id of producers) {
    const job = economy.production.find((job) => job.producerId === id)!;
    if (job.completedTicks < job.totalTicks) job.completedTicks += 1;
    if (job.completedTicks < job.totalTicks) continue;
    const result = world.evaluateSpawn(job);
    job.exitBlocked = !result.accepted;
    if (!result.accepted || !("actor" in result)) continue;
    economy.production.splice(economy.production.indexOf(job), 1);
    if (definitions.get(job.definitionId)?.harvesting) {
      economy.harvesters.push({
        actorId: job.actorId,
        refineryId: id,
        cargo: 0,
        gatherProgress: 0,
        phase: "idle",
      });
    }
    world.spawn(result.actor);
    byId.set(result.actor.id, result.actor);
  }
  const near = (actor: Actor, point: WorldPosition) =>
    Math.hypot(
      actor.worldPosition.x - point.x,
      actor.worldPosition.z - point.z,
    ) <
    map.tileSize * 0.3;
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
  const routeTo = (
    actor: Actor,
    worker: HarvesterState,
    target: WorldPosition,
  ) => {
    if (near(actor, target)) {
      delete actor.movement;
      return true;
    }
    if (actor.movement) return false;
    if (!reachable(actor, target) || !move(actor, target)) {
      worker.phase = "blocked";
      worker.retryNavigationVersion = map.navigationChanges.version;
    }
    return false;
  };
  for (const worker of [...economy.harvesters].sort((a, b) =>
    a.actorId < b.actorId ? -1 : a.actorId > b.actorId ? 1 : 0,
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
      delete actor.movement;
    }
    if (worker.phase === "returning") {
      if (actor.movement) {
        if (actor.movement.blocked) {
          worker.phase = "blocked";
          worker.retryNavigationVersion = map.navigationChanges.version;
        }
        continue;
      }
      const refinery = byId.get(worker.refineryId)!;
      if (!isTilePlacedActor(refinery)) continue;
      const occupied = occupiedTilesFor(
        refinery,
        definitions.get(refinery.definitionId)!,
      );
      const keys = new Set(occupied.map(tileKey));
      const exits = new Map<string, TileCoord>();
      for (const tile of occupied)
        for (const offset of [
          { x: 0, z: 1 },
          { x: 1, z: 0 },
          { x: 0, z: -1 },
          { x: -1, z: 0 },
        ]) {
          const next = { x: tile.x + offset.x, z: tile.z + offset.z };
          if (map.containsTile(next.x, next.z) && !keys.has(tileKey(next)))
            exits.set(tileKey(next), next);
        }
      const distance = (tile: TileCoord) => {
        const point = map.tileCenter(tile.x, tile.z);
        return Math.hypot(
          actor.worldPosition.x - point.x,
          actor.worldPosition.z - point.z,
        );
      };
      const destination = [...exits.values()]
        .sort((a, b) => distance(a) - distance(b) || a.z - b.z || a.x - b.x)
        .map((tile) => map.tileCenter(tile.x, tile.z))
        .find((point) => reachable(actor, point));
      if (!destination) {
        worker.phase = "blocked";
        worker.retryNavigationVersion = map.navigationChanges.version;
      } else if (routeTo(actor, worker, destination)) {
        economy.materials += worker.cargo;
        economy.depositedMaterials += worker.cargo;
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
      (site) => site.id === worker.activeSiteId && site.remainingMaterials > 0,
    );
    if (!site) {
      const candidates = economy.sites
        .filter(
          (site) =>
            site.remainingMaterials > 0 &&
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
      if (!site) {
        worker.phase = candidates.length
          ? "blocked"
          : worker.cargo
            ? "returning"
            : "depleted";
        worker.retryNavigationVersion = map.navigationChanges.version;
        delete actor.movement;
        continue;
      }
      worker.activeSiteId = site.id;
      worker.phase = "travelling";
      delete actor.movement;
    }
    const point = map.tileCenter(site.tile.x, site.tile.z);
    if (!routeTo(actor, worker, point)) continue;
    worker.phase = "gathering";
    const loadTicks = Math.max(
      1,
      Math.ceil(gathering.loadSeconds / tickSeconds),
    );
    worker.gatherProgress += gathering.capacity;
    while (
      worker.gatherProgress >= loadTicks &&
      site.remainingMaterials > 0 &&
      worker.cargo < gathering.capacity
    ) {
      worker.gatherProgress -= loadTicks;
      site.remainingMaterials -= 1;
      worker.cargo += 1;
    }
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
          definitions.get(actor.definitionId)?.movement && near(actor, point),
      )
    )
      continue;
    loot.collected = true;
    economy.materials += loot.materials;
  }
}

function isCount(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}
