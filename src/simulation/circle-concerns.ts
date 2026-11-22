// Circle build plan: Lifebloom cultivation, Conservatories, and expansion.
import { compareIds } from "./actor";
import {
  groupSites,
  headquarters,
  hostileBuildings,
  isGrowing,
  isPlacementMemory,
  isRestoring,
  knownDefenders,
  ownBuildings,
  place,
  rosterBuildings,
  stepToward,
  tendGrowth,
  tendingWorkers,
  train,
  usableBuildings,
} from "./ai-planning";
import { visibleHostiles } from "./ai-operations";
import { restartOf } from "./ai-recovery";
import { isPositiveCount } from "./ai-tuning";
import { plannedConcern } from "./director";
import { isCount, isIdList, isNonnegative } from "./validation";
import { distance } from "./world";

import type { Building, PlacementMemory } from "./ai-planning";
import type { IncomeRestartReport } from "./ai-recovery";
import type { CultivationSite } from "./cultivation";
import type { AiConcern, AiConcernContext } from "./director";
import type { TerrainView } from "./terrain";
import type { WorldPosition } from "./world";

type IncomePlan = {
  /** Conservatories while establishing or recovering, and once growing. */
  readonly essentialConservatories: number;
  readonly conservatories: number;
  /** Cultivators while establishing or recovering. */
  readonly essentialWorkers: number;
  /** Cultivators each served site takes. */
  readonly workersPerSite: number;
  /** Sites this near a completed Conservatory are served. */
  readonly serveTiles: number;
  /** A new Conservatory's distance from its site, toward headquarters. */
  readonly siteStepTiles: number;
};

type ExpansionPlan = {
  /** Cultivators the base needs before its first expansion. */
  readonly startWorkers: number;
  /** Further Cultivators each held expansion needs before the next. */
  readonly groveWorkers: number;
  /** Expansions held at once. */
  readonly limit: number;
  /** Sites this near one another form one grove. */
  readonly groveTiles: number;
  /** Known hostiles this near a grove rule it out. */
  readonly enemyTiles: number;
  /** A Conservatory's distance from its grove, toward headquarters. */
  readonly siteStepTiles: number;
};

type ExpansionMemory = PlacementMemory & {
  /** Each expansion's grove, named by its first site ID. */
  groves?: string[];
};

type KnownSite = CultivationSite & { position: WorldPosition };

const conservatoryOf = (context: AiConcernContext) =>
  rosterBuildings(context, (definition) => !!definition.cultivationDropoff)[0];

/** The roster's first Cultivator trained at a headquarters. */
function cultivatorOf(context: AiConcernContext) {
  for (const definition of rosterBuildings(
    context,
    (candidate) => !!candidate.infrastructure,
  )) {
    const worker = definition.production?.unitDefinitionIds
      .map((id) => context.definitions.get(id))
      .find((unit) => unit?.cultivation);
    if (worker) return worker;
  }
}

/** Sighted Lifebloom sites at their last-seen reserves, in ID order. */
function knownSites(
  sites: readonly CultivationSite[],
  terrain: TerrainView,
): KnownSite[] {
  return sites
    .map((site) => ({
      ...site,
      position: terrain.tileCenter(site.tile.x, site.tile.z),
    }))
    .sort((a, b) => compareIds(a.id, b.id));
}

const near = (
  point: WorldPosition,
  buildings: readonly { worldPosition: WorldPosition }[],
  range: number,
) =>
  buildings.some(
    ({ worldPosition }) => distance(point, worldPosition) <= range,
  );

/**
 * Trains Cultivators at Heartgroves, grows Conservatories beside the nearest
 * Lifebloom, and spreads Cultivators across served sites up to the per-site
 * cap. Workers on a Dormant site move to an open site with room, or wait.
 * Unfinished growth without a tender borrows the nearest free Cultivator.
 * Savings return to the pool once the posture's base is staffed.
 */
export const circleIncome = plannedConcern<IncomePlan>(
  {
    essentialConservatories: isPositiveCount,
    conservatories: isPositiveCount,
    essentialWorkers: isPositiveCount,
    workersPerSite: isPositiveCount,
    serveTiles: isNonnegative,
    siteStepTiles: isNonnegative,
  },
  (context, plan) => {
    const { terrain } = context;
    const economy = context.view.economy();
    const conservatory = conservatoryOf(context);
    const cultivator = cultivatorOf(context);
    if (!economy || !terrain || !conservatory || !cultivator) return;
    tendGrowth(context);
    const conservatories = ownBuildings(
      context,
      (definition) => !!definition.cultivationDropoff,
    );
    const completed = conservatories.filter(
      (building) => !building.construction,
    );
    const range = plan.serveTiles * terrain.tileSize;
    const sites = knownSites(economy.cultivation?.sites ?? [], terrain);
    const served = sites.filter(({ position }) =>
      near(position, completed, range),
    );
    assignCultivators(context, plan, served, completed);
    const workers = economy.cultivation?.workers.length ?? 0;
    const queued = economy.production.filter(
      ({ definitionId }) => definitionId === cultivator.id,
    );
    const capacity = served.length * plan.workersPerSite;
    const wantedWorkers = Math.max(
      1,
      isRestoring(context)
        ? Math.min(capacity, plan.essentialWorkers)
        : capacity,
    );
    if (workers + queued.length < wantedWorkers) {
      const trainer = usableBuildings(
        context,
        (definition) =>
          !!definition.production?.unitDefinitionIds.includes(cultivator.id),
      ).find(({ id }) => !queued.some(({ producerId }) => producerId === id));
      if (trainer) train(context, trainer, cultivator);
    }
    const wanted = isRestoring(context)
      ? plan.essentialConservatories
      : plan.conservatories;
    if (conservatories.length >= wanted) {
      if (workers + queued.length >= wantedWorkers) context.releaseFunds();
      return;
    }
    const home = headquarters(context);
    if (!home || conservatories.some((building) => building.construction))
      return;
    const [target] = sites
      .filter(({ position }) => !near(position, conservatories, range))
      .sort(
        (a, b) =>
          distance(a.position, home.worldPosition) -
            distance(b.position, home.worldPosition) || compareIds(a.id, b.id),
      );
    if (target)
      place(
        context,
        context.memory as PlacementMemory,
        terrain,
        conservatory,
        stepToward(
          terrain,
          target.position,
          home.worldPosition,
          plan.siteStepTiles,
        ),
        {
          accepts: (position) => distance(position, target.position) <= range,
        },
      );
  },
);

/**
 * Sends idle Cultivators, and those on Dormant or unserved sites, to the
 * served site with room that is open, fullest in reserve, and nearest a
 * Conservatory. Workers wait when every open site is full.
 */
function assignCultivators(
  context: AiConcernContext,
  plan: IncomePlan,
  served: readonly KnownSite[],
  conservatories: readonly Building[],
) {
  const tending = tendingWorkers(context);
  const workers = context.view.economy()?.cultivation?.workers ?? [];
  const load = new Map<string, number>();
  for (const { siteId } of workers)
    if (siteId) load.set(siteId, (load.get(siteId) ?? 0) + 1);
  const dropoffGap = (site: KnownSite) =>
    Math.min(
      ...conservatories.map(({ worldPosition }) =>
        distance(worldPosition, site.position),
      ),
    );
  const open = served
    .filter(({ dormant }) => !dormant)
    .sort(
      (a, b) =>
        b.reserve - a.reserve ||
        dropoffGap(a) - dropoffGap(b) ||
        compareIds(a.id, b.id),
    );
  const openIds = new Set(open.map(({ id }) => id));
  const roomFor = (site: KnownSite) =>
    (load.get(site.id) ?? 0) < plan.workersPerSite;
  for (const worker of [...workers].sort((a, b) =>
    compareIds(a.actorId, b.actorId),
  )) {
    if (
      tending.has(worker.actorId) ||
      (worker.siteId && openIds.has(worker.siteId))
    )
      continue;
    const target = open.find(roomFor);
    if (
      !target ||
      !context.issue({
        kind: "gather",
        actorId: worker.actorId,
        siteId: target.id,
      })
    )
      continue;
    if (worker.siteId)
      load.set(worker.siteId, (load.get(worker.siteId) ?? 1) - 1);
    load.set(target.id, (load.get(target.id) ?? 0) + 1);
  }
}

/**
 * A Conservatory and a Cultivator, less whatever survives or is pending.
 * Growing Conservatories count, since income tends them.
 */
export const circleIncomeRestart: IncomeRestartReport = (context) => {
  const economy = context.view.economy();
  const conservatory = conservatoryOf(context);
  const cultivator = cultivatorOf(context);
  if (!economy || !conservatory || !cultivator) return;
  const staffed =
    (economy.cultivation?.workers.length ?? 0) > 0 ||
    economy.production.some(
      ({ definitionId }) => definitionId === cultivator.id,
    );
  const earning =
    ownBuildings(context, (definition) => !!definition.cultivationDropoff)
      .length > 0;
  return restartOf(conservatory, cultivator, { earning, staffed });
};

/**
 * Grows Conservatories at further groves while the base is growing, once the
 * Cultivators fill the groves already held. Regrows a held grove's lost
 * Conservatory in every posture that lists it unless enemies threaten the
 * grove, which then drops it. Grows one at a time; savings return to the pool
 * when nothing is wanted.
 */
export const circleExpansion = plannedConcern<ExpansionPlan>(
  {
    startWorkers: isPositiveCount,
    groveWorkers: isCount,
    limit: isPositiveCount,
    groveTiles: isNonnegative,
    enemyTiles: isNonnegative,
    siteStepTiles: isNonnegative,
  },
  (context, plan) => {
    const { terrain } = context;
    const memory = context.memory as ExpansionMemory;
    const economy = context.view.economy();
    const home = headquarters(context);
    const conservatory = conservatoryOf(context);
    if (!terrain || !economy || !home || !conservatory) return;
    const groves = groupSites(
      context.view.knowledge.sites.filter(
        ({ resource }) => resource === "lifebloom",
      ),
      plan.groveTiles,
    ).map((sites) => ({
      id: sites[0]!.id,
      positions: sites.map(({ tile }) => terrain.tileCenter(tile.x, tile.z)),
    }));
    type Grove = (typeof groves)[number];
    const conservatories = ownBuildings(
      context,
      (definition) => !!definition.cultivationDropoff,
    );
    // Each Conservatory belongs to its nearest grove, which it takes.
    const groveOf = (point: WorldPosition) =>
      [...groves].sort(
        (a, b) =>
          groveGap(a.positions, point) - groveGap(b.positions, point) ||
          compareIds(a.id, b.id),
      )[0];
    const takenIds = new Set(
      conservatories.flatMap(
        ({ worldPosition }) => groveOf(worldPosition)?.id ?? [],
      ),
    );
    const taken = (grove: Grove) => takenIds.has(grove.id);
    const enemyRange = plan.enemyTiles * terrain.tileSize;
    const within =
      (positions: readonly { worldPosition: WorldPosition }[]) =>
      (grove: Grove) =>
        grove.positions.some((position) =>
          near(position, positions, enemyRange),
        );
    const buildings = hostileBuildings(context);
    // New groves avoid any known enemy; held ones wait out present threats.
    const contested = within([...buildings, ...knownDefenders(context)]);
    const threatened = within([...buildings, ...visibleHostiles(context)]);
    const byId = new Map(groves.map((grove) => [grove.id, grove]));
    const held = (memory.groves ?? []).filter((id) => {
      const grove = byId.get(id);
      return !!grove && (taken(grove) || !threatened(grove));
    });
    let target = held
      .map((id) => byId.get(id)!)
      .find((grove) => !taken(grove) && !threatened(grove));
    const workers = economy.cultivation?.workers.length ?? 0;
    if (
      !target &&
      held.length < plan.limit &&
      isGrowing(context) &&
      workers >= plan.startWorkers + held.length * plan.groveWorkers
    ) {
      target = groves
        .filter((grove) => !taken(grove) && !contested(grove))
        .sort(
          (a, b) =>
            groveGap(a.positions, home.worldPosition) -
              groveGap(b.positions, home.worldPosition) ||
            compareIds(a.id, b.id),
        )[0];
      if (target) held.push(target.id);
    }
    if (held.length) memory.groves = held;
    else delete memory.groves;
    if (!target) {
      context.releaseFunds();
      return;
    }
    if (conservatories.some((building) => building.construction)) return;
    const [nearest] = [...target.positions].sort(
      (a, b) =>
        distance(a, home.worldPosition) - distance(b, home.worldPosition),
    );
    place(
      context,
      memory,
      terrain,
      conservatory,
      stepToward(terrain, nearest!, home.worldPosition, plan.siteStepTiles),
      { accepts: (position) => groveOf(position) === target },
    );
  },
);

/** The distance from `point` to a grove's nearest site. */
const groveGap = (positions: readonly WorldPosition[], point: WorldPosition) =>
  Math.min(...positions.map((position) => distance(position, point)));

circleIncome.validateMemory = isPlacementMemory;
circleExpansion.validateMemory = (memory) =>
  (memory.groves === undefined || isIdList(memory.groves)) &&
  isPlacementMemory(memory);

export const CIRCLE_CONCERNS: ReadonlyMap<string, AiConcern> = new Map([
  ["circle-expansion", circleExpansion],
  ["circle-income", circleIncome],
]);
