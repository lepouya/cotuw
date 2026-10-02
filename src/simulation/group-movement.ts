import { resolveNavigationDestination, segmentCost } from "./navigation";

import type { Actor, ActorDefinition } from "./actor";
import type { NavigationGrid } from "./navigation";
import type { MoveCommand } from "./command";
import type { WorldPosition } from "./world";

export type DefinedActor = {
  actor: Actor;
  definition: ActorDefinition;
};
export type NavigatingActor = DefinedActor & {
  grid: NavigationGrid;
};

/** Stable IDs and tile order break ties; selection order has no effect. */
export function assignGroupDestinations(
  movers: readonly NavigatingActor[],
  actors: readonly DefinedActor[],
  target: WorldPosition,
): { command: MoveCommand; assigned: boolean }[] {
  const selected = new Set(movers.map(({ actor }) => actor.id));
  const reserved = actors
    .filter(({ actor }) => !actor.tilePlacement && !selected.has(actor.id))
    .map(({ actor, definition }) => ({
      point: actor.worldPosition,
      layer: actor.occupancyLayer,
      radius: definition.movement?.radius ?? 0,
    }));
  const results = [];
  for (const { actor, definition, grid } of [...movers].sort((a, b) =>
    a.actor.id < b.actor.id ? -1 : a.actor.id > b.actor.id ? 1 : 0,
  )) {
    const { map } = grid;
    const radius = definition.movement?.radius ?? map.tileSize * 0.3;
    const base = resolveNavigationDestination(
      grid,
      actor.worldPosition,
      target,
    );
    const goal = map.tileAtWorldPosition(target.x, target.z);
    const command: MoveCommand = { kind: "move", actorId: actor.id, target };
    // A group order must not drag a stranded unit away from its current order.
    if (
      !base ||
      (!base.reachedTarget &&
        squaredDistance(base.start, goal) <= squaredDistance(base.end, goal))
    ) {
      results.push({ command, assigned: false });
      continue;
    }
    const { end } = base;
    const region = grid.regionAt(end.x, end.z);
    let slot:
      | {
          point: WorldPosition;
          nearTarget: number;
          nearActor: number;
          index: number;
        }
      | undefined;
    for (let z = 0; z < map.height; z += 1) {
      for (let x = 0; x < map.width; x += 1) {
        if (grid.regionAt(x, z) !== region) continue;
        const point = map.tileCenter(x, z);
        const candidate = {
          point,
          nearTarget: squaredDistance(point, target),
          nearActor: squaredDistance(point, actor.worldPosition),
          index: map.tileIndex(x, z),
        };
        if (
          slot &&
          (candidate.nearTarget - slot.nearTarget ||
            candidate.nearActor - slot.nearActor ||
            candidate.index - slot.index) >= 0
        )
          continue;
        if (
          reserved.some(
            (other) =>
              other.layer === actor.occupancyLayer &&
              distance(other.point, point) <
                Math.max(map.tileSize * 0.8, radius + other.radius),
          )
        )
          continue;
        slot = candidate;
      }
    }
    if (slot) {
      command.target = slot.point;
      if (!base.reachedTarget) command.requestedTarget = { ...target };
      reserved.push({ point: slot.point, layer: actor.occupancyLayer, radius });
    }
    results.push({ command, assigned: slot !== undefined });
  }
  return results;
}

function distance(a: WorldPosition, b: WorldPosition): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function squaredDistance(a: WorldPosition, b: WorldPosition): number {
  return (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
}

/** Soft contact correction never changes orders or crosses blocked terrain. */
export function separateMobileActors(
  movers: readonly NavigatingActor[],
  seconds: number,
  previousPositions: ReadonlyMap<string, WorldPosition>,
): void {
  const sorted = [...movers]
    .filter(({ definition }) => definition.movement?.radius)
    .sort((a, b) =>
      a.actor.id < b.actor.id ? -1 : a.actor.id > b.actor.id ? 1 : 0,
    );
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
    const { minX, maxX, minZ, maxZ } = grid.map.worldBounds;
    if (to.x < minX || to.x > maxX || to.z < minZ || to.z > maxZ) return;
    if (segmentCost(grid, from, to) === undefined) return;
    actor.worldPosition = to;
    budgets.set(actor.id, budgets.get(actor.id)! - step);
  };
  // Spatial buckets keep local contact work independent of total map area.
  const cellSize = sorted.reduce(
    (size, { definition }) => Math.max(size, definition.movement!.radius! * 2),
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
            left.definition.movement!.radius! +
            right.definition.movement!.radius! -
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
