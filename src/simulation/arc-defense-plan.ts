// ARC static defenses at remote and raided income sites.
import { compareIds } from "./actor";
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
import type { WorldPosition } from "./world";

type DefensePlan = {
  /** Defenses at each Refinery beyond headquarters support. */
  readonly remote: number;
  /** Defenses at any Refinery once it or its Harvester is raided. */
  readonly raided: number;
  /** Own defenses this near a Refinery guard it. */
  readonly guardTiles: number;
  /** A defense's distance from its Refinery, toward the enemy. */
  readonly standoffTiles: number;
};

type DefenseMemory = PlacementMemory & {
  /** Refineries raided while they stood. */
  raided?: string[];
  /** Hits from this tick on are new. */
  checkedTick?: number;
};

/** Refineries whose building or Harvester took a hostile hit since `tick`. */
function raidedSince(
  context: AiConcernContext,
  refineries: readonly ActorRenderState[],
  tick: number,
) {
  const economy = context.view.economy();
  const wasHit = (id: string) => (context.view.ownDamageTick(id) ?? -1) >= tick;
  const raided = new Set(
    refineries.filter(({ id }) => wasHit(id)).map(({ id }) => id),
  );
  for (const worker of economy?.harvesters ?? [])
    if (worker.refineryId && wasHit(worker.actorId))
      raided.add(worker.refineryId);
  return raided;
}

/**
 * Builds defenses at usable Refineries beyond headquarters support and at
 * raided ones, facing the nearest known hostile building. Builds one at a
 * time; savings return to the pool when every site is guarded.
 */
export const arcDefenses = plannedConcern<DefensePlan>(
  {
    remote: isCount,
    raided: isCount,
    guardTiles: isNonnegative,
    standoffTiles: isNonnegative,
  },
  (context, plan) => {
    const { terrain, tick } = context;
    const memory = context.memory as DefenseMemory;
    const home = headquarters(context);
    const refineries = ownBuildings(
      context,
      (definition) => !!definition.refinery,
    );
    const raided = new Set([
      ...(memory.raided ?? []),
      ...raidedSince(context, refineries, memory.checkedTick ?? 0),
    ]);
    const kept = refineries.map(({ id }) => id).filter((id) => raided.has(id));
    if (kept.length) memory.raided = kept;
    else delete memory.raided;
    // Planning precedes this tick's combat, so its hits are still to come.
    memory.checkedTick = tick;
    const [defense] = rosterBuildings(context, isStaticDefense);
    if (!terrain || !home || !defense) return;
    const reach = definitionOf(context, home).support?.radius ?? 0;
    const defenses = ownBuildings(context, isStaticDefense).filter((building) =>
      isOnline(context, building),
    );
    const range = plan.guardTiles * terrain.tileSize;
    const site = usableBuildings(context, (d) => !!d.refinery).find(
      (refinery) => {
        const wanted = Math.max(
          distance(refinery.worldPosition, home.worldPosition) > reach
            ? plan.remote
            : 0,
          kept.includes(refinery.id) ? plan.raided : 0,
        );
        const guards = defenses.filter(
          ({ worldPosition }) =>
            distance(worldPosition, refinery.worldPosition) <= range,
        ).length;
        return guards < wanted;
      },
    );
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

arcDefenses.validateMemory = (memory) =>
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
