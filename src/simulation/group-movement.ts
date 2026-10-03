import { resolveNavigationDestination, segmentCost } from "./navigation";
import { isTilePlacedActor } from "./placement";
import { compareIds } from "./actor";

import type { Actor, ActorDefinition } from "./actor";
import type { NavigationGrid } from "./navigation";
import { distance } from "./world";
import type { WorldPosition } from "./world";

export type DefinedActor = {
  actor: Actor;
  definition: ActorDefinition;
};
export type NavigatingActor = DefinedActor & {
  grid: NavigationGrid;
};

export type GroupDestination = {
  actorId: string;
  target: WorldPosition;
  /** The group click when `target` only approaches it. */
  requestedTarget?: WorldPosition;
};

/** World-space radius for friendly separation; zero opts out. */
export function separationRadius(definition: ActorDefinition): number {
  return definition.movement?.radius ?? 0;
}

type Slot = { point: WorldPosition; nearTarget: number };

/**
 * Assigns distinct tile-center destinations near `target`, in `movers` order.
 * Pass movers sorted by stable actor ID so selection order has no effect.
 * Movers without an available destination are left out.
 */
export function assignGroupDestinations(
  movers: readonly NavigatingActor[],
  actors: readonly DefinedActor[],
  target: WorldPosition,
): GroupDestination[] {
  const selected = new Set(movers.map(({ actor }) => actor.id));
  const reserved = actors
    .filter(({ actor }) => !isTilePlacedActor(actor) && !selected.has(actor.id))
    .map(({ actor, definition }) => ({
      point: actor.worldPosition,
      layer: actor.occupancyLayer,
      radius: separationRadius(definition),
    }));
  // Each region's tiles, nearest the click first, shared by movers on a grid.
  const slotsByGrid = new Map<NavigationGrid, Map<number, Slot[]>>();
  const slotsIn = (grid: NavigationGrid, region: number) => {
    const byRegion = slotsByGrid.get(grid) ?? new Map<number, Slot[]>();
    slotsByGrid.set(grid, byRegion);
    let slots = byRegion.get(region);
    if (!slots) {
      slots = [];
      const { map } = grid;
      for (let z = 0; z < map.height; z += 1) {
        for (let x = 0; x < map.width; x += 1) {
          if (grid.regionAt(x, z) !== region) continue;
          const point = map.tileCenter(x, z);
          slots.push({ point, nearTarget: squaredDistance(point, target) });
        }
      }
      // The stable sort keeps tile order among equally near tiles.
      slots.sort((a, b) => a.nearTarget - b.nearTarget);
      byRegion.set(region, slots);
    }
    return slots;
  };
  const destinations: GroupDestination[] = [];
  for (const { actor, definition, grid } of movers) {
    const base = resolveNavigationDestination(
      grid,
      actor.worldPosition,
      target,
    );
    if (!base) continue;
    const radius = separationRadius(definition);
    const minimumSpacing = grid.map.tileSize * 0.8;
    // An approach must get closer, so a stranded unit keeps its current order.
    const limit = base.reachedTarget
      ? Number.POSITIVE_INFINITY
      : squaredDistance(actor.worldPosition, target);
    let slot: Slot | undefined;
    let slotNearActor = Number.POSITIVE_INFINITY;
    for (const candidate of slotsIn(
      grid,
      grid.regionAt(base.end.x, base.end.z),
    )) {
      if (
        candidate.nearTarget >= limit ||
        (slot && candidate.nearTarget > slot.nearTarget)
      )
        break;
      // Equally near tiles prefer the one closest to the unit.
      const nearActor = squaredDistance(candidate.point, actor.worldPosition);
      if (nearActor >= slotNearActor) continue;
      if (
        reserved.some(
          (other) =>
            other.layer === actor.occupancyLayer &&
            distance(other.point, candidate.point) <
              Math.max(minimumSpacing, radius + other.radius),
        )
      )
        continue;
      slot = candidate;
      slotNearActor = nearActor;
    }
    if (!slot) continue;
    reserved.push({ point: slot.point, layer: actor.occupancyLayer, radius });
    destinations.push({
      actorId: actor.id,
      target: { ...slot.point },
      ...(!base.reachedTarget && { requestedTarget: { ...target } }),
    });
  }
  return destinations;
}

function squaredDistance(a: WorldPosition, b: WorldPosition): number {
  return (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
}

/** Soft contact correction never changes orders or crosses blocked terrain. */
export function separateMobileActors(
  movers: readonly NavigatingActor[],
  seconds: number,
  previousPositions: ReadonlyMap<string, WorldPosition>,
  /** Whether contact correction may move an actor to a point. */
  allows: (mover: NavigatingActor, point: WorldPosition) => boolean = () =>
    true,
): void {
  const sorted = [...movers]
    .filter(({ definition }) => separationRadius(definition) > 0)
    .sort((a, b) => compareIds(a.actor.id, b.actor.id));
  // Contact cannot cancel a full tick of travel on expensive terrain.
  const budgets = new Map(
    sorted.map(({ actor, definition }) => {
      const travel = distance(
        previousPositions.get(actor.id) ?? actor.worldPosition,
        actor.worldPosition,
      );
      return [
        actor.id,
        (actor.movement || travel > 0
          ? travel
          : definition.movement!.speed * seconds) * 0.5,
      ];
    }),
  );
  const move = (
    mover: NavigatingActor,
    dx: number,
    dz: number,
    amount: number,
  ) => {
    const { actor, grid } = mover;
    const step = Math.min(amount, budgets.get(actor.id)!);
    if (step <= 0) return;
    const from = actor.worldPosition;
    const to = { x: from.x + dx * step, z: from.z + dz * step };
    if (!allows(mover, to)) return;
    const { minX, maxX, minZ, maxZ } = grid.map.worldBounds;
    if (to.x < minX || to.x > maxX || to.z < minZ || to.z > maxZ) return;
    if (segmentCost(grid, from, to) === undefined) return;
    actor.worldPosition = to;
    budgets.set(actor.id, budgets.get(actor.id)! - step);
  };
  // Spatial buckets keep local contact work independent of total map area.
  const cellSize = sorted.reduce(
    (size, { definition }) => Math.max(size, separationRadius(definition) * 2),
    0.01,
  );
  const buckets = new Map<string, NavigatingActor[]>();
  const cells = new Map<string, { x: number; z: number }>();
  for (const mover of sorted) {
    const { x, z } = mover.actor.worldPosition;
    const cell = { x: Math.floor(x / cellSize), z: Math.floor(z / cellSize) };
    cells.set(mover.actor.id, cell);
    const key = `${cell.x},${cell.z}`;
    const bucket = buckets.get(key) ?? [];
    bucket.push(mover);
    buckets.set(key, bucket);
  }
  for (const left of sorted) {
    // Queries use the same positions as the buckets, before any corrections.
    const { x: cellX, z: cellZ } = cells.get(left.actor.id)!;
    for (let z = cellZ - 1; z <= cellZ + 1; z += 1) {
      for (let x = cellX - 1; x <= cellX + 1; x += 1) {
        for (const right of buckets.get(`${x},${z}`) ?? []) {
          if (
            left.actor.id >= right.actor.id ||
            left.actor.occupancyLayer !== right.actor.occupancyLayer
          )
            continue;
          const a = left.actor.worldPosition;
          const b = right.actor.worldPosition;
          const length = distance(a, b);
          const overlap =
            separationRadius(left.definition) +
            separationRadius(right.definition) -
            length;
          if (overlap <= 1e-6) continue;
          // Coincident centers get a stable diagonal instead of a random impulse.
          const dx = length > 1e-9 ? (b.x - a.x) / length : Math.SQRT1_2;
          const dz = length > 1e-9 ? (b.z - a.z) / length : Math.SQRT1_2;
          // Passing traffic yields to stopped units and completed destinations.
          const leftMoving = !!left.actor.movement;
          const rightMoving = !!right.actor.movement;
          if (leftMoving || !rightMoving)
            move(
              left,
              -dx,
              -dz,
              overlap / (rightMoving === leftMoving ? 2 : 1),
            );
          if (rightMoving || !leftMoving)
            move(right, dx, dz, overlap / (rightMoving === leftMoving ? 2 : 1));
        }
      }
    }
  }
}
