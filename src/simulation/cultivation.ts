import { depositCargo, gatherCargo, validCargoSources } from "./cargo";
import type { CargoSource } from "./cargo";
import { clearCombatOrders, compareIds } from "./actor";
import { secondsToTicks } from "./clock";
import { RESOURCE_SCALE } from "./resources";
import { isCount, isPositive } from "./validation";
import {
  advanceWorkerRoute,
  routeTarget,
  workerNavigation,
} from "./worker-navigation";
import type { Actor, ActorDefinition, DeepReadonly } from "./actor";
import type { EconomyCommand } from "./command";
import type {
  EconomyCommandHooks,
  EconomyReason,
  EconomyState,
  EconomyWorld,
} from "./economy";
import type { TileCoord } from "./grid";
import type { WorldPosition } from "./world";

/** Resource thousandths for a content amount or rate. */
const toUnits = (amount: number) => Math.round(amount * RESOURCE_SCALE);
/** Content values must convert exactly to nonnegative thousandths. */
const exactUnits = (amount: number) =>
  isCount(toUnits(amount)) && toUnits(amount) / RESOURCE_SCALE === amount;
export type CultivationSite = {
  id: string;
  name: string;
  tile: TileCoord;
  capacity: number;
  reserve: number;
  regeneration: number;
  regenerationProgress: number;
  slowBelow: number;
  dormantBelow: number;
  recoverAt: number;
  dormant: boolean;
};
export type CultivatorPhase =
  | "idle"
  | "travelling"
  | "gathering"
  | "returning"
  | "waiting"
  | "blocked"
  | "no-dropoff"
  | "tending";
export type CultivatorState = {
  actorId: string;
  cargo: number;
  cargoSources?: CargoSource[];
  /** Fractional resources already taken from the site's reserve. */
  gatherProgress: number;
  /** Fractional rate remaining below a reserve unit per tick. */
  rateProgress: number;
  siteId?: string;
  tendingId?: string;
  /** The assigned growth has no reachable entrance. */
  tendingBlocked?: true;
  dropoffId?: string;
  phase: CultivatorPhase;
};
export type CultivationState = {
  sites: CultivationSite[];
  workers: CultivatorState[];
};
export function createCultivatorState(actorId: string): CultivatorState {
  return {
    actorId,
    cargo: 0,
    gatherProgress: 0,
    rateProgress: 0,
    phase: "idle",
  };
}
/** Content tuning for new sites, in resource units and units per second. */
export type CultivationSiteTuning = Pick<
  CultivationSite,
  "capacity" | "regeneration" | "slowBelow" | "dormantBelow" | "recoverAt"
>;
/** A full, open site with the given tuning. */
export function createCultivationSite(
  id: string,
  name: string,
  tile: TileCoord,
  tuning: Readonly<CultivationSiteTuning>,
): CultivationSite {
  const capacity = toUnits(tuning.capacity);
  return {
    id,
    name,
    tile: { ...tile },
    capacity,
    reserve: capacity,
    regeneration: toUnits(tuning.regeneration),
    regenerationProgress: 0,
    slowBelow: toUnits(tuning.slowBelow),
    dormantBelow: toUnits(tuning.dormantBelow),
    recoverAt: toUnits(tuning.recoverAt),
    dormant: false,
  };
}
function validSiteTuning(
  tuning: Readonly<CultivationSiteTuning>,
  validAmount: (amount: number) => boolean,
) {
  const { capacity, regeneration, slowBelow, dormantBelow, recoverAt } = tuning;
  return (
    [capacity, regeneration, slowBelow, dormantBelow, recoverAt].every(
      validAmount,
    ) &&
    dormantBelow < slowBelow &&
    slowBelow <= capacity &&
    dormantBelow < recoverAt &&
    recoverAt <= capacity
  );
}

export function validateCultivationSiteTuning(
  tuning: Readonly<CultivationSiteTuning>,
) {
  if (
    !tuning ||
    !validSiteTuning(tuning, exactUnits) ||
    tuning.regeneration <= 0
  )
    throw new RangeError("Invalid cultivation site tuning.");
}

export function cultivationEfficiency(
  site: DeepReadonly<CultivationSite>,
): number {
  if (site.dormant) return 0;
  if (site.reserve >= site.slowBelow) return 1;
  // Falls linearly from full speed to half speed at the dormancy threshold.
  return (
    0.5 +
    (0.5 * Math.max(0, site.reserve - site.dormantBelow)) /
      (site.slowBelow - site.dormantBelow)
  );
}
export function cultivationStatus(site: DeepReadonly<CultivationSite>) {
  if (site.dormant) return "Dormant";
  return site.reserve < site.slowBelow ? "Strained" : "Healthy";
}
/** Sites with a Cultivator assigned, including workers waiting out dormancy. */
export const workedSiteIds = (
  workers: readonly Pick<CultivatorState, "siteId">[],
) => new Set(workers.flatMap(({ siteId }) => siteId ?? []));
function clearTending(worker: CultivatorState) {
  delete worker.tendingId;
  delete worker.tendingBlocked;
}

/** Ends assigned work while leaving cargo on board. */
export function stopCultivation(worker: CultivatorState) {
  delete worker.siteId;
  clearTending(worker);
  delete worker.dropoffId;
  worker.phase = "idle";
}

function startDelivery(worker: CultivatorState) {
  clearTending(worker);
  delete worker.dropoffId;
  worker.phase = "returning";
}

/** Includes assignment routes that could not start a movement order. */
export function cultivationRouteBlocked(
  worker: Pick<CultivatorState, "phase" | "tendingBlocked">,
  movement?: { readonly blocked?: boolean },
) {
  return (
    worker.phase === "blocked" ||
    (worker.phase === "tending" &&
      (!!worker.tendingBlocked || !!movement?.blocked))
  );
}

export function interruptCultivation(actor: Actor, economy?: EconomyState) {
  const worker = economy?.cultivation?.workers.find(
    (worker) => worker.actorId === actor.id,
  );
  if (worker) stopCultivation(worker);
}

/** Removes a worker or releases assignments to a lost building. */
export function removeCultivationActor(
  state: CultivationState,
  actorId: string,
) {
  const interrupted: string[] = [];
  state.workers = state.workers.filter((worker) => worker.actorId !== actorId);
  for (const worker of state.workers) {
    if (worker.tendingId === actorId) {
      stopCultivation(worker);
      interrupted.push(worker.actorId);
    } else if (worker.dropoffId === actorId) {
      startDelivery(worker);
      interrupted.push(worker.actorId);
    }
  }
  return interrupted;
}

export function applyCultivationCommand(
  command: EconomyCommand,
  economy: EconomyState,
  actors: Actor[],
  definitions: ReadonlyMap<string, ActorDefinition>,
  reaches: EconomyCommandHooks["reaches"],
): EconomyReason | undefined {
  const actor = actors.find((actor) => actor.id === command.actorId);
  const worker = economy.cultivation?.workers.find(
    (worker) => worker.actorId === command.actorId,
  );
  if (!actor || !worker) return "invalid-cultivator";
  if (command.kind === "tend") {
    const building = actors.find((actor) => actor.id === command.buildingId);
    const growth = building && definitions.get(building.definitionId)?.growth;
    if (
      !building?.construction ||
      !growth ||
      growth.workerDefinitionId !== actor.definitionId ||
      building.owner !== actor.owner
    )
      return "invalid-growth";
    const prior = economy.cultivation!.workers.find(
      (other) =>
        other.actorId !== worker.actorId && other.tendingId === building.id,
    );
    if (prior) return "tender-occupied";
    if (!reaches(actor, building)) return "unreachable-growth";
    stopCultivation(worker);
    worker.tendingId = building.id;
    worker.phase = "tending";
  } else if (command.kind === "gather") {
    if (!economy.cultivation!.sites.some((site) => site.id === command.siteId))
      return "missing-site";
    stopCultivation(worker);
    worker.siteId = command.siteId;
    worker.phase = worker.cargo ? "returning" : "travelling";
  } else if (command.kind === "return-cargo") {
    if (!worker.cargo) return "empty-cargo";
    startDelivery(worker);
  } else return "invalid-cultivator";
  delete actor.movement;
  clearCombatOrders(actor);
}

/** Regenerate once, then allocate shared reserves in stable worker-ID order. */
export function updateCultivation(economy: EconomyState, world: EconomyWorld) {
  const state = economy.cultivation!;
  const { actors, definitions, map, tickSeconds } = world;
  const perSecond = secondsToTicks(1, tickSeconds);
  const navigation = workerNavigation(world);
  for (const site of state.sites) {
    // Keep the per-tick remainder separate from the full regeneration rate.
    site.regenerationProgress += site.regeneration % perSecond;
    const regenerated =
      Math.floor(site.regeneration / perSecond) +
      Math.floor(site.regenerationProgress / perSecond);
    site.regenerationProgress %= perSecond;
    site.reserve += Math.min(site.capacity - site.reserve, regenerated);
    if (site.dormant && site.reserve >= site.recoverAt) site.dormant = false;
  }
  const route = (
    actor: Actor,
    worker: CultivatorState,
    point: WorldPosition,
  ) => {
    const result = advanceWorkerRoute(actor, point, world, map.tileSize * 0.75);
    if (result === "blocked") worker.phase = "blocked";
    // A successful retry resumes the trip; returning sets its own phase.
    else if (worker.phase === "blocked") worker.phase = "travelling";
    return result === "arrived";
  };
  const dropoffsByOwner = new Map<string, Actor[]>();
  const dropoffsFor = (owner: string) => {
    let dropoffs = dropoffsByOwner.get(owner);
    if (!dropoffs) {
      dropoffs = actors
        .filter(
          (building) =>
            building.owner === owner &&
            !building.construction &&
            definitions.get(building.definitionId)?.cultivationDropoff,
        )
        .sort((a, b) => compareIds(a.id, b.id));
      dropoffsByOwner.set(owner, dropoffs);
    }
    return dropoffs;
  };
  const byId = new Map(actors.map((actor) => [actor.id, actor]));
  for (const worker of [...state.workers].sort((a, b) =>
    compareIds(a.actorId, b.actorId),
  )) {
    const actor = byId.get(worker.actorId)!;
    const { capacity, rate } = definitions.get(
      actor.definitionId,
    )!.cultivation!;
    if (worker.tendingId || worker.phase === "idle") continue;
    const site = state.sites.find((site) => site.id === worker.siteId);
    // Full or stranded cargo goes home before more gathering.
    if (worker.cargo >= capacity || (site?.dormant && worker.cargo))
      worker.phase = "returning";
    if (
      ["returning", "no-dropoff"].includes(worker.phase) ||
      (worker.dropoffId && worker.phase === "blocked")
    ) {
      // An unblocked route keeps its drop-off without rescanning.
      const current = routeTarget(actor);
      const destination =
        worker.dropoffId && current
          ? { id: worker.dropoffId, point: current }
          : navigation.nearestEntrance(actor, dropoffsFor(actor.owner));
      if (!destination) {
        delete actor.movement;
        delete worker.dropoffId;
        worker.phase = "no-dropoff";
        continue;
      }
      if (worker.dropoffId !== destination.id) delete actor.movement;
      worker.dropoffId = destination.id;
      worker.phase = "returning";
      if (route(actor, worker, destination.point)) {
        depositCargo(
          economy,
          world,
          actor.owner,
          "lifebloom",
          worker,
          destination.id,
        );
        delete worker.dropoffId;
        worker.phase = site ? "travelling" : "idle";
      }
      continue;
    }
    if (!site) {
      worker.phase = "idle";
      continue;
    }
    const point = map.tileCenter(site.tile.x, site.tile.z);
    if (!route(actor, worker, point)) continue;
    if (site.dormant) {
      worker.phase = "waiting";
      continue;
    }
    worker.phase = "gathering";
    worker.rateProgress +=
      toUnits(rate) * Math.round(cultivationEfficiency(site) * RESOURCE_SCALE);
    const available = Math.floor(
      worker.rateProgress / (perSecond * RESOURCE_SCALE),
    );
    worker.rateProgress %= perSecond * RESOURCE_SCALE;
    const amount = Math.min(
      available,
      site.reserve - site.dormantBelow,
      (capacity - worker.cargo) * RESOURCE_SCALE - worker.gatherProgress,
    );
    site.reserve -= amount;
    gatherCargo(worker, site.id, amount);
    worker.gatherProgress += amount;
    worker.cargo += Math.floor(worker.gatherProgress / RESOURCE_SCALE);
    worker.gatherProgress %= RESOURCE_SCALE;
    if (site.reserve <= site.dormantBelow) site.dormant = true;
  }
}

export function validateCultivationDefinitions(
  definitions: ReadonlyMap<string, ActorDefinition>,
) {
  const invalid = (definition: ActorDefinition) => {
    throw new RangeError(`Invalid cultivation definition: ${definition.id}.`);
  };
  for (const definition of definitions.values()) {
    if (
      definition.cultivation &&
      (!definition.movement ||
        !isCount(definition.cultivation.capacity * RESOURCE_SCALE) ||
        !isCount(definition.cultivation.capacity) ||
        !definition.cultivation.capacity ||
        !isPositive(definition.cultivation.rate) ||
        !exactUnits(definition.cultivation.rate) ||
        // Per-tick rate progress scales the rate again by efficiency.
        !isCount(toUnits(definition.cultivation.rate) * RESOURCE_SCALE))
    )
      return invalid(definition);
    if (
      definition.cultivationDropoff !== undefined &&
      (typeof definition.cultivationDropoff !== "boolean" ||
        !definition.footprint)
    )
      return invalid(definition);
  }
}

function validAssignment({
  phase,
  siteId,
  dropoffId,
  tendingId,
  cargo,
}: CultivatorState) {
  if ((tendingId !== undefined) !== (phase === "tending")) return false;
  switch (phase) {
    case "idle":
    case "tending":
      return siteId === undefined && dropoffId === undefined;
    case "travelling":
    case "gathering":
    case "waiting":
      return siteId !== undefined && dropoffId === undefined;
    case "returning":
      return cargo > 0;
    case "no-dropoff":
      return cargo > 0 && dropoffId === undefined;
    case "blocked":
      return dropoffId === undefined ? siteId !== undefined : cargo > 0;
  }
  // Unknown phases from a hand-edited file.
  return false;
}

/** Site identity and tiles are validated with the other economy sites. */
export function validateCultivation(
  economy: EconomyState,
  actors: readonly Actor[],
  definitions: ReadonlyMap<string, ActorDefinition>,
  tickSeconds: number,
) {
  const invalid = () => {
    throw new RangeError("Mission has invalid cultivation state.");
  };
  const state = economy.cultivation;
  if (!state) {
    if (
      actors.some((actor) => definitions.get(actor.definitionId)?.cultivation)
    )
      return invalid();
    return;
  }
  if (!Array.isArray(state.workers)) return invalid();
  for (const site of state.sites) {
    if (
      !validSiteTuning(site, isCount) ||
      !isCount(site.reserve) ||
      site.reserve > site.capacity ||
      !isCount(site.regenerationProgress) ||
      site.regenerationProgress >= secondsToTicks(1, tickSeconds) ||
      typeof site.dormant !== "boolean" ||
      (site.dormant && site.reserve >= site.recoverAt) ||
      (!site.dormant && site.reserve < site.dormantBelow)
    )
      return invalid();
  }
  const byId = new Map(actors.map((actor) => [actor.id, actor]));
  const workers = new Set<string>();
  const tended = new Set<string>();
  const sourceIds = new Set(state.sites.map((site) => site.id));
  for (const worker of state.workers) {
    const actor = byId.get(worker?.actorId);
    const tending = byId.get(worker?.tendingId ?? "");
    const dropoff = byId.get(worker?.dropoffId ?? "");
    const definition =
      actor && definitions.get(actor.definitionId)?.cultivation;
    if (
      !actor ||
      !definition ||
      workers.has(worker.actorId) ||
      !validCargoSources(
        worker,
        worker.cargo * RESOURCE_SCALE + worker.gatherProgress,
        sourceIds,
      ) ||
      !isCount(worker.cargo) ||
      worker.cargo * RESOURCE_SCALE + worker.gatherProgress >
        definition.capacity * RESOURCE_SCALE ||
      !isCount(worker.gatherProgress) ||
      worker.gatherProgress >= RESOURCE_SCALE ||
      !isCount(worker.rateProgress) ||
      worker.rateProgress >= secondsToTicks(1, tickSeconds) * RESOURCE_SCALE ||
      !validAssignment(worker) ||
      (worker.siteId !== undefined && !sourceIds.has(worker.siteId)) ||
      (worker.dropoffId !== undefined &&
        (!dropoff ||
          dropoff.construction !== undefined ||
          dropoff.owner !== actor.owner ||
          !definitions.get(dropoff.definitionId)?.cultivationDropoff)) ||
      (worker.tendingId !== undefined &&
        (!tending?.construction ||
          tending.owner !== actor.owner ||
          tended.has(tending.id) ||
          definitions.get(tending.definitionId)?.growth?.workerDefinitionId !==
            actor.definitionId)) ||
      (worker.tendingBlocked !== undefined &&
        (worker.tendingBlocked !== true || !tending))
    )
      return invalid();
    workers.add(worker.actorId);
    if (tending) tended.add(tending.id);
  }
  if (
    actors.some(
      (actor) =>
        definitions.get(actor.definitionId)?.cultivation &&
        !workers.has(actor.id),
    )
  )
    return invalid();
}
