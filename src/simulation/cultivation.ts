import { clearCombatOrders, compareIds, nearestTo } from "./actor";
import { secondsToTicks } from "./clock";
import { isCount, isPositive } from "./validation";
import {
  advanceWorkerRoute,
  routeTarget,
  workerNavigation,
} from "./worker-navigation";
import type { Actor, ActorDefinition, DeepReadonly } from "./actor";
import type { EconomyCommand } from "./command";
import type { EconomyReason, EconomyState, EconomyWorld } from "./economy";
import type { TileCoord } from "./grid";

/** Reserve and fractional gathered resources use integer thousandths. */
export const CULTIVATION_SCALE = 1000;
const rateUnits = (rate: number) => Math.round(rate * CULTIVATION_SCALE);
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
export const CULTIVATOR_PHASES = [
  "idle",
  "travelling",
  "gathering",
  "returning",
  "waiting",
  "blocked",
  "no-dropoff",
  "tending",
] as const;
export type CultivatorState = {
  actorId: string;
  cargo: number;
  /** Fractional resources already taken from the site's reserve. */
  gatherProgress: number;
  /** Fractional rate remaining below a reserve unit per tick. */
  rateProgress: number;
  siteId?: string;
  tendingId?: string;
  dropoffId?: string;
  phase: (typeof CULTIVATOR_PHASES)[number];
};
export type CultivationState = {
  lifebloom: number;
  depositedLifebloom: number;
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
export function createCultivationSite(
  id: string,
  name: string,
  tile: TileCoord,
): CultivationSite {
  return {
    id,
    name,
    tile,
    capacity: 100000,
    reserve: 100000,
    regeneration: 1000,
    regenerationProgress: 0,
    slowBelow: 60000,
    dormantBelow: 10000,
    recoverAt: 60000,
    dormant: false,
  };
}
export function cultivationEfficiency(
  site: DeepReadonly<CultivationSite>,
): number {
  return site.dormant
    ? 0
    : site.reserve >= site.slowBelow
      ? 1
      : 0.5 +
        (0.5 * Math.max(0, site.reserve - site.dormantBelow)) /
          (site.slowBelow - site.dormantBelow);
}
export function cultivationStatus(site: DeepReadonly<CultivationSite>) {
  return site.dormant
    ? "Dormant"
    : site.reserve < site.slowBelow
      ? "Strained"
      : "Healthy";
}
export function interruptCultivation(actor: Actor, economy?: EconomyState) {
  const worker = economy?.cultivation?.workers.find(
    (worker) => worker.actorId === actor.id,
  );
  if (!worker) return;
  delete worker.siteId;
  delete worker.tendingId;
  delete worker.dropoffId;
  worker.phase = "idle";
}
export function applyCultivationCommand(
  command: EconomyCommand,
  economy: EconomyState,
  actors: Actor[],
  definitions: ReadonlyMap<string, ActorDefinition>,
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
    interruptCultivation(actor, economy);
    worker.tendingId = building.id;
    worker.phase = "tending";
  } else if (command.kind === "gather") {
    if (!economy.cultivation!.sites.some((site) => site.id === command.siteId))
      return "missing-site";
    interruptCultivation(actor, economy);
    worker.siteId = command.siteId;
    worker.phase = worker.cargo ? "returning" : "travelling";
  } else if (command.kind === "return-cargo") {
    if (!worker.cargo) return "empty-cargo";
    delete worker.tendingId;
    delete worker.dropoffId;
    worker.phase = "returning";
  } else return "invalid-cultivator";
  delete actor.movement;
  clearCombatOrders(actor);
}

/** Regenerate once, then allocate shared reserves in stable worker-ID order. */
export function updateCultivation(
  state: CultivationState,
  world: EconomyWorld,
) {
  const { actors, definitions, map, tickSeconds } = world;
  const perSecond = secondsToTicks(1, tickSeconds);
  const navigation = workerNavigation(world);
  for (const site of state.sites) {
    site.regenerationProgress += site.regeneration;
    const regenerated = Math.floor(site.regenerationProgress / perSecond);
    site.regenerationProgress %= perSecond;
    site.reserve = Math.min(site.capacity, site.reserve + regenerated);
    if (site.dormant && site.reserve >= site.recoverAt) site.dormant = false;
  }
  const route = (
    actor: Actor,
    worker: CultivatorState,
    point: { x: number; z: number },
  ) => {
    const result = advanceWorkerRoute(actor, point, world, map.tileSize * 0.75);
    if (result === "blocked") worker.phase = "blocked";
    // A successful retry resumes the trip; returning sets its own phase.
    else if (worker.phase === "blocked") worker.phase = "travelling";
    return result === "arrived";
  };
  const byId = new Map(actors.map((actor) => [actor.id, actor]));
  for (const worker of [...state.workers].sort((a, b) =>
    compareIds(a.actorId, b.actorId),
  )) {
    const actor = byId.get(worker.actorId)!;
    const definition = definitions.get(actor.definitionId)!;
    if (worker.tendingId || worker.phase === "idle") continue;
    const site = state.sites.find((site) => site.id === worker.siteId);
    // Full or stranded cargo goes home before more gathering.
    if (
      worker.cargo >= definition.cultivation!.capacity ||
      (site?.dormant && worker.cargo)
    )
      worker.phase = "returning";
    if (
      ["returning", "no-dropoff"].includes(worker.phase) ||
      (worker.dropoffId && worker.phase === "blocked")
    ) {
      // An unblocked route keeps its drop-off without rescanning.
      const current = routeTarget(actor);
      let destination =
        worker.dropoffId && current
          ? { id: worker.dropoffId, point: current }
          : undefined;
      if (!destination) {
        const candidates = actors
          .filter(
            (building) =>
              !building.construction &&
              definitions.get(building.definitionId)?.cultivationDropoff &&
              building.owner === actor.owner,
          )
          .sort(nearestTo(actor.worldPosition));
        for (const building of candidates) {
          const point = navigation.entrance(actor, building);
          if (point) {
            destination = { id: building.id, point };
            break;
          }
        }
      }
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
        state.lifebloom += worker.cargo;
        state.depositedLifebloom += worker.cargo;
        world.deliver(destination.id, worker.actorId);
        worker.cargo = 0;
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
      rateUnits(definition.cultivation!.rate) *
      Math.round(cultivationEfficiency(site) * CULTIVATION_SCALE);
    const available = Math.floor(
      worker.rateProgress / (perSecond * CULTIVATION_SCALE),
    );
    worker.rateProgress %= perSecond * CULTIVATION_SCALE;
    const amount = Math.min(
      available,
      site.reserve - site.dormantBelow,
      (definition.cultivation!.capacity - worker.cargo) * CULTIVATION_SCALE -
        worker.gatherProgress,
    );
    site.reserve -= amount;
    worker.gatherProgress += amount;
    worker.cargo += Math.floor(worker.gatherProgress / CULTIVATION_SCALE);
    worker.gatherProgress %= CULTIVATION_SCALE;
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
        !isCount(definition.cultivation.capacity) ||
        !definition.cultivation.capacity ||
        !isPositive(definition.cultivation.rate) ||
        !isCount(rateUnits(definition.cultivation.rate) * CULTIVATION_SCALE) ||
        Math.abs(
          definition.cultivation.rate * CULTIVATION_SCALE -
            rateUnits(definition.cultivation.rate),
        ) > 1e-6)
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
  if (
    !isCount(state.lifebloom) ||
    !isCount(state.depositedLifebloom) ||
    !Array.isArray(state.workers)
  )
    return invalid();
  for (const site of state.sites) {
    if (
      ![
        site.capacity,
        site.reserve,
        site.regeneration,
        site.regenerationProgress,
        site.slowBelow,
        site.dormantBelow,
        site.recoverAt,
      ].every(isCount) ||
      site.regenerationProgress >= secondsToTicks(1, tickSeconds) ||
      !site.capacity ||
      site.reserve > site.capacity ||
      site.dormantBelow >= site.slowBelow ||
      site.slowBelow > site.capacity ||
      site.recoverAt <= site.dormantBelow ||
      site.recoverAt > site.capacity ||
      typeof site.dormant !== "boolean" ||
      (site.dormant && site.reserve >= site.recoverAt) ||
      (!site.dormant && site.reserve < site.dormantBelow)
    )
      return invalid();
  }
  const byId = new Map(actors.map((actor) => [actor.id, actor]));
  const workers = new Set<string>();
  const tended = new Set<string>();
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
      !isCount(worker.cargo) ||
      worker.cargo > definition.capacity ||
      !isCount(worker.gatherProgress) ||
      worker.gatherProgress >= CULTIVATION_SCALE ||
      !isCount(worker.rateProgress) ||
      worker.rateProgress >=
        secondsToTicks(1, tickSeconds) * CULTIVATION_SCALE ||
      (!!worker.tendingId &&
        (worker.siteId !== undefined || worker.dropoffId !== undefined)) ||
      !CULTIVATOR_PHASES.includes(worker.phase) ||
      (worker.siteId !== undefined &&
        !state.sites.some(({ id }) => id === worker.siteId)) ||
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
      !!worker.tendingId !== (worker.phase === "tending")
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
