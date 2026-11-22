// Faction-neutral static defenses at remote and raided income buildings.
import { compareIds, isIncomeBuilding, nearestTo } from "./actor";
import {
  definitionOf,
  headquarters,
  hostileBuildings,
  isOnline,
  isPlacementMemory,
  isStaticDefense,
  ownBuildings,
  place,
  rosterBuildings,
  stepToward,
  usableBuildings,
} from "./ai-planning";
import { plannedConcern } from "./director";
import { isCount, isIdList, isNonnegative } from "./validation";
import { distance } from "./world";

import type { ActorRenderState } from "./actor";
import type { PlacementMemory } from "./ai-planning";
import type { AiConcernContext } from "./director";
import type { TerrainView } from "./terrain";
import type { WorldPosition } from "./world";

type DefensePlan = {
  /** Distance beyond which income buildings are remote; null uses HQ support. */
  readonly homeTiles: number | null;
  /** Defenses at each remote income building. */
  readonly remote: number;
  /** Defenses at any income building once it or its worker is raided. */
  readonly raided: number;
  /** Own defenses this near an income building guard it. */
  readonly guardTiles: number;
  /** A defense's distance from its income building, toward the enemy. */
  readonly standoffTiles: number;
};

type DefenseMemory = PlacementMemory & {
  /** Income buildings raided while they stood. */
  raided?: string[];
  /** Hits from this tick on are new. */
  checkedTick?: number;
};

/**
 * Income buildings hit since `tick`, or whose worker was. A Harvester names
 * its Refinery. A Cultivator names its drop-off or the nearest Conservatory.
 */
function raidedSince(
  context: AiConcernContext,
  terrain: TerrainView,
  buildings: readonly ActorRenderState[],
  tick: number,
) {
  const economy = context.view.economy();
  const wasHit = (id: string) => (context.view.ownDamageTick(id) ?? -1) >= tick;
  const raided = new Set(
    buildings.filter(({ id }) => wasHit(id)).map(({ id }) => id),
  );
  for (const worker of economy?.harvesters ?? [])
    if (worker.refineryId && wasHit(worker.actorId))
      raided.add(worker.refineryId);
  const sites = new Map(
    (economy?.cultivation?.sites ?? []).map((site) => [site.id, site]),
  );
  const conservatories = buildings.filter(
    (building) =>
      !building.construction &&
      definitionOf(context, building).cultivationDropoff,
  );
  for (const worker of economy?.cultivation?.workers ?? []) {
    if (!wasHit(worker.actorId)) continue;
    if (worker.dropoffId) {
      raided.add(worker.dropoffId);
      continue;
    }
    const site = worker.siteId && sites.get(worker.siteId);
    if (!site) continue;
    const point = terrain.tileCenter(site.tile.x, site.tile.z);
    const [nearest] = [...conservatories].sort(nearestTo(point));
    if (nearest) raided.add(nearest.id);
  }
  return raided;
}

/**
 * Builds defenses at usable remote and raided income buildings, facing the
 * nearest known hostile building. Builds one at a time; savings return to the
 * pool when every site is guarded.
 */
export const incomeDefenses = plannedConcern<DefensePlan>(
  {
    homeTiles: (value) => value === null || isNonnegative(value),
    remote: isCount,
    raided: isCount,
    guardTiles: isNonnegative,
    standoffTiles: isNonnegative,
  },
  (context, plan) => {
    const { terrain, tick } = context;
    if (!terrain) return;
    const memory = context.memory as DefenseMemory;
    const home = headquarters(context);
    const incomeBuildings = ownBuildings(context, isIncomeBuilding);
    const raided = new Set([
      ...(memory.raided ?? []),
      ...raidedSince(
        context,
        terrain,
        incomeBuildings,
        memory.checkedTick ?? 0,
      ),
    ]);
    const kept = incomeBuildings
      .map(({ id }) => id)
      .filter((id) => raided.has(id));
    if (kept.length) memory.raided = kept;
    else delete memory.raided;
    // Planning precedes this tick's combat, so its hits are still to come.
    memory.checkedTick = tick;
    const [defense] = rosterBuildings(context, isStaticDefense);
    if (!home || !defense) return;
    const reach =
      plan.homeTiles === null
        ? (definitionOf(context, home).support?.radius ?? 0)
        : plan.homeTiles * terrain.tileSize;
    const defenses = ownBuildings(context, isStaticDefense).filter((building) =>
      isOnline(context, building),
    );
    const range = plan.guardTiles * terrain.tileSize;
    const site = usableBuildings(context, isIncomeBuilding).find((income) => {
      const wanted = Math.max(
        distance(income.worldPosition, home.worldPosition) > reach
          ? plan.remote
          : 0,
        kept.includes(income.id) ? plan.raided : 0,
      );
      const guards = defenses.filter(
        ({ worldPosition }) =>
          distance(worldPosition, income.worldPosition) <= range,
      ).length;
      return guards < wanted;
    });
    if (!site) {
      context.releaseFunds();
      return;
    }
    if (defenses.some((building) => building.construction)) return;
    place(
      context,
      memory,
      terrain,
      defense,
      stepToward(
        terrain,
        site.worldPosition,
        threatDirection(context, site.worldPosition),
        plan.standoffTiles,
      ),
      {
        accepts: (position) => distance(position, site.worldPosition) <= range,
      },
    );
  },
);

incomeDefenses.validateMemory = (memory) =>
  (memory.raided === undefined || isIdList(memory.raided)) &&
  (memory.checkedTick === undefined || isCount(memory.checkedTick)) &&
  isPlacementMemory(memory);

/** The nearest known hostile building, else the map center. */
function threatDirection(
  context: AiConcernContext,
  point: WorldPosition,
): WorldPosition {
  const [nearest] = hostileBuildings(context).sort(
    (a, b) =>
      distance(a.worldPosition, point) - distance(b.worldPosition, point) ||
      compareIds(a.actorId, b.actorId),
  );
  if (nearest) return nearest.worldPosition;
  const { minX, maxX, minZ, maxZ } = context.terrain!.worldBounds;
  return { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 };
}
