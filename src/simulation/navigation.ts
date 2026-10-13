import { clampToBounds, isFinitePosition } from "./world";
import { deepFreeze, insideRouteBounds } from "./actor";
import { hasOwn } from "./validation";

import type { DeepReadonly, RouteBounds } from "./actor";

import type { TerrainView, TileCoord } from "./terrain";
import type { OccupancyLayer, OccupancyView } from "./occupancy";
import type { WorldPosition } from "./world";

export type MovementProfile = {
  id: string;
  /** Maximum rise per horizontal world unit. */
  maxSlope: number;
  /** Traversal cost multiplier at `maxSlope`; one means no slope penalty. */
  slopeCostAtLimit: number;
  /** Positive traversal cost, or `null` when this terrain is impassable. */
  terrainCosts: Readonly<Record<string, number | null>>;
};

export type NavigationPath = {
  /** Straight segments ending at the exact target when it is reachable. */
  waypoints: WorldPosition[];
  /** The requested target, or the closest reachable tile center. */
  destination: WorldPosition;
  reachedTarget: boolean;
};

type OpenTile = { index: number; score: number; estimate: number };

/** Share of a tile within which a segment counts as passing a tile corner. */
const CORNER_TOLERANCE = 1e-9;
/** Absorbs rounding when a shortcut costs the same as the tile route. */
const SHORTCUT_TOLERANCE = 1e-9;
const UNKNOWN_COST = Number.NaN;
const BLOCKED_COST = -1;
const UNLABELED = -2;
const BLOCKED_REGION = -1;

const NEIGHBORS: readonly (TileCoord & { distance: number })[] = [
  { x: -1, z: 0, distance: 1 },
  { x: 1, z: 0, distance: 1 },
  { x: 0, z: -1, distance: 1 },
  { x: 0, z: 1, distance: 1 },
  { x: -1, z: -1, distance: Math.SQRT2 },
  { x: 1, z: -1, distance: Math.SQRT2 },
  { x: -1, z: 1, distance: Math.SQRT2 },
  { x: 1, z: 1, distance: Math.SQRT2 },
];

export function validateMovementProfile(profile: MovementProfile): void {
  if (
    !profile ||
    typeof profile.id !== "string" ||
    !profile.terrainCosts ||
    typeof profile.terrainCosts !== "object" ||
    Array.isArray(profile.terrainCosts)
  )
    throw new RangeError("Invalid movement profile shape.");
  const costs = Object.values(profile.terrainCosts);
  if (
    profile.id.length === 0 ||
    !Number.isFinite(profile.maxSlope) ||
    profile.maxSlope < 0 ||
    !Number.isFinite(profile.slopeCostAtLimit) ||
    profile.slopeCostAtLimit < 1 ||
    !costs.some((cost) => cost !== null) ||
    costs.some((cost) => cost !== null && !(Number.isFinite(cost) && cost > 0))
  ) {
    throw new RangeError(`Invalid movement profile: ${profile.id}.`);
  }
}

/**
 * Returns the speed divisor for a tile under a validated profile, or
 * `undefined` when it is blocked.
 */
export function traversalCostAt(
  map: TerrainView,
  profile: MovementProfile,
  x: number,
  z: number,
): number | undefined {
  if (!map.containsTile(x, z)) {
    return undefined;
  }
  const terrain = map.terrainAt(x, z);
  // Out-of-bounds tiles block every profile, priced or not.
  if (terrain.outOfBounds) {
    return undefined;
  }
  if (!hasOwn(profile.terrainCosts, terrain.typeId)) {
    throw new RangeError(
      `Movement profile ${profile.id} has no cost for terrain ${terrain.typeId}.`,
    );
  }
  if (terrain.surfacePassable === false) {
    return undefined;
  }
  const terrainCost = profile.terrainCosts[terrain.typeId]!;
  if (terrainCost === null) {
    return undefined;
  }
  const slope = map.slopeAt(x, z);
  if (terrain.surfacePassable !== true && slope > profile.maxSlope) {
    return undefined;
  }
  if (profile.maxSlope === 0) {
    return terrainCost;
  }
  const slopeShare = Math.min(slope / profile.maxSlope, 1);
  return terrainCost * (1 + (profile.slopeCostAtLimit - 1) * slopeShare);
}

/**
 * One profile's tile costs and connected regions, cached until the map reports
 * a navigation change. The cache is derived data and never affects results.
 */
export class NavigationGrid {
  readonly map: TerrainView;
  readonly occupancy: OccupancyView;
  readonly profile: MovementProfile;
  readonly occupancyLayer: OccupancyLayer;
  readonly bounds: DeepReadonly<RouteBounds> | undefined;
  /** Lowest cost per world unit, which keeps the A* estimate admissible. */
  readonly minimumCost: number;
  private readonly costs: Float64Array;
  private regions: Int32Array | undefined;
  private version: number;
  private generation: number;
  private physicalGrid: NavigationGrid | undefined;

  constructor(
    map: TerrainView,
    occupancy: OccupancyView,
    profile: MovementProfile,
    occupancyLayer: OccupancyLayer = "surface",
    bounds?: RouteBounds,
  ) {
    validateMovementProfile(profile);
    if (
      bounds !== undefined &&
      (!bounds ||
        !isFinitePosition(bounds.center) ||
        !(Number.isFinite(bounds.radius) && bounds.radius > 0))
    )
      throw new RangeError("Invalid navigation route bounds.");
    this.bounds = bounds && deepFreeze(structuredClone(bounds));
    for (const typeId of map.terrainTypeIds) {
      if (!hasOwn(profile.terrainCosts, typeId)) {
        throw new RangeError(
          `Movement profile ${profile.id} has no cost for terrain ${typeId}.`,
        );
      }
    }
    this.map = map;
    this.occupancy = occupancy;
    this.profile = profile;
    this.occupancyLayer = occupancyLayer;
    this.minimumCost = Math.min(
      ...Object.values(profile.terrainCosts).filter(
        (cost): cost is number => cost !== null,
      ),
    );
    this.costs = new Float64Array(map.width * map.height).fill(UNKNOWN_COST);
    this.version = map.navigationChanges.version;
    this.generation = map.navigationChanges.generation;
  }

  /** Terrain costs without the route's circular waypoint restriction. */
  unbounded(): NavigationGrid {
    if (!this.bounds) return this;
    return (this.physicalGrid ??= new NavigationGrid(
      this.map,
      this.occupancy,
      this.profile,
      this.occupancyLayer,
    ));
  }

  costAt(x: number, z: number): number | undefined {
    if (!this.map.containsTile(x, z)) {
      return undefined;
    }
    if (
      this.bounds &&
      !insideRouteBounds(this.bounds, this.map.tileCenter(x, z))
    )
      return undefined;
    this.sync();
    const index = this.map.tileIndex(x, z);
    let cost = this.costs[index]!;
    if (Number.isNaN(cost)) {
      cost = this.occupancy.blocksMovementAt(x, z, this.occupancyLayer)
        ? BLOCKED_COST
        : (traversalCostAt(this.map, this.profile, x, z) ?? BLOCKED_COST);
      this.costs[index] = cost;
    }
    return cost === BLOCKED_COST ? undefined : cost;
  }

  /** Whether a mover may step between adjacent tiles, leaving any tile. */
  canStep(from: TileCoord, to: TileCoord): boolean {
    if (this.costAt(to.x, to.z) === undefined) {
      return false;
    }
    // A diagonal step must not cut the corner of a blocked tile.
    return (
      from.x === to.x ||
      from.z === to.z ||
      (this.costAt(from.x, to.z) !== undefined &&
        this.costAt(to.x, from.z) !== undefined)
    );
  }

  /** The connected region of a passable tile, or -1 when it is blocked. */
  regionAt(x: number, z: number): number {
    this.sync();
    this.regions ??= this.labelRegions();
    return this.regions[this.map.tileIndex(x, z)]!;
  }

  private sync(): void {
    const { navigationChanges } = this.map;
    const sameGeneration = this.generation === navigationChanges.generation;
    if (sameGeneration && this.version === navigationChanges.version) {
      return;
    }
    const entries = sameGeneration
      ? navigationChanges.entriesSince(this.version, this.occupancyLayer)
      : undefined;
    const changes = entries
      ?.filter(({ effect }) => effect !== "none")
      .map(({ bounds }) => bounds);
    if (!changes) {
      this.costs.fill(UNKNOWN_COST);
    }
    for (const bounds of changes ?? []) {
      for (let z = Math.max(bounds.minZ, 0); z <= bounds.maxZ; z += 1) {
        for (let x = Math.max(bounds.minX, 0); x <= bounds.maxX; x += 1) {
          if (this.map.containsTile(x, z)) {
            this.costs[this.map.tileIndex(x, z)] = UNKNOWN_COST;
          }
        }
      }
    }
    if (!changes || changes.length > 0) this.regions = undefined;
    this.version = navigationChanges.version;
    this.generation = navigationChanges.generation;
  }

  /** Labels regions in tile order, so labels are deterministic. */
  private labelRegions(): Int32Array {
    const { width, height } = this.map;
    const regions = new Int32Array(width * height).fill(UNLABELED);
    const queue = new Int32Array(width * height);
    let nextRegion = 0;
    for (let seed = 0; seed < regions.length; seed += 1) {
      if (regions[seed] !== UNLABELED) {
        continue;
      }
      const seedTile = tileForIndex(this.map, seed);
      if (this.costAt(seedTile.x, seedTile.z) === undefined) {
        regions[seed] = BLOCKED_REGION;
        continue;
      }
      regions[seed] = nextRegion;
      let head = 0;
      let tail = 0;
      queue[tail++] = seed;
      while (head < tail) {
        const current = tileForIndex(this.map, queue[head++]!);
        for (const neighbor of NEIGHBORS) {
          const next = { x: current.x + neighbor.x, z: current.z + neighbor.z };
          if (!this.map.containsTile(next.x, next.z)) {
            continue;
          }
          const index = this.map.tileIndex(next.x, next.z);
          if (regions[index] === UNLABELED && this.canStep(current, next)) {
            regions[index] = nextRegion;
            queue[tail++] = index;
          }
        }
      }
      nextRegion += 1;
    }
    return regions;
  }
}

/**
 * Finds the least-time eight-way route, then straightens it where a direct
 * segment is no slower. A target outside the source's region resolves to the
 * closest tile inside it, which may be the source's own tile. `undefined`
 * means the source cannot move at all.
 */
export function findNavigationPath(
  grid: NavigationGrid,
  from: WorldPosition,
  target: WorldPosition,
): NavigationPath | undefined {
  const resolved = resolveNavigationDestination(grid, from, target);
  if (!resolved) return undefined;
  const { start, end, reachedTarget } = resolved;
  const { map } = grid;
  const route = (resolved.direct ? [] : searchTiles(grid, start, end))
    .slice(1)
    .map(({ x, z }) => map.tileCenter(x, z));
  const destination = reachedTarget
    ? { ...target }
    : map.tileCenter(end.x, end.z);
  const last = route[route.length - 1];
  if (!last || last.x !== destination.x || last.z !== destination.z) {
    route.push(destination);
  }
  return {
    waypoints: straightenRoute(
      grid.unbounded(),
      from,
      route,
      grid.unbounded().costAt(start.x, start.z) !== undefined,
    ),
    destination,
    reachedTarget,
  };
}

/** Resolves reachable tiles without constructing a route to them. */
export function resolveNavigationDestination(
  grid: NavigationGrid,
  from: WorldPosition,
  target: WorldPosition,
):
  | { start: TileCoord; end: TileCoord; reachedTarget: boolean; direct?: true }
  | undefined {
  const { map } = grid;
  const start = occupiedTile(grid, from);
  const goal = map.tileAtWorldPosition(target.x, target.z);
  const boundaryTarget =
    grid.bounds &&
    insideRouteBounds(grid.bounds, from) &&
    insideRouteBounds(grid.bounds, target) &&
    !insideRouteBounds(grid.bounds, map.tileCenter(goal.x, goal.z));
  // A circular leash contains every segment between two points inside it.
  if (
    boundaryTarget &&
    start.x === goal.x &&
    start.z === goal.z &&
    segmentCost(grid.unbounded(), from, target) !== undefined
  )
    return { start, end: start, reachedTarget: true, direct: true };
  const startPassable = grid.costAt(start.x, start.z) !== undefined;
  const regions = new Set<number>();
  if (startPassable) {
    regions.add(grid.regionAt(start.x, start.z));
  } else {
    // An actor standing on blocked terrain may step off it.
    for (const neighbor of NEIGHBORS) {
      const next = { x: start.x + neighbor.x, z: start.z + neighbor.z };
      if (map.containsTile(next.x, next.z) && grid.canStep(start, next)) {
        regions.add(grid.regionAt(next.x, next.z));
      }
    }
  }
  if (regions.size === 0) {
    return undefined;
  }

  if (boundaryTarget) {
    const connectors = NEIGHBORS.map(({ x, z }) => ({
      x: goal.x + x,
      z: goal.z + z,
    })).filter(
      (tile) =>
        map.containsTile(tile.x, tile.z) &&
        regions.has(grid.regionAt(tile.x, tile.z)) &&
        segmentCost(
          grid.unbounded(),
          map.tileCenter(tile.x, tile.z),
          target,
        ) !== undefined,
    );
    connectors.sort(
      (a, b) =>
        squaredDistance(a.x - goal.x, a.z - goal.z) -
          squaredDistance(b.x - goal.x, b.z - goal.z) ||
        squaredDistance(a.x - start.x, a.z - start.z) -
          squaredDistance(b.x - start.x, b.z - start.z) ||
        map.tileIndex(a.x, a.z) - map.tileIndex(b.x, b.z),
    );
    if (connectors[0])
      return { start, end: connectors[0], reachedTarget: true };
  }

  const reachedTarget = regions.has(grid.regionAt(goal.x, goal.z));
  const end = reachedTarget
    ? goal
    : closestTileInRegions(grid, regions, start, goal);
  return { start, end, reachedTarget };
}

/**
 * Visits each tile a segment crosses with the length inside it. At a tile
 * corner both side tiles are visited with zero length, so a segment obeys the
 * same corner rule as a diagonal step. Returns false if `visit` stopped it.
 */
export function forEachTileOnSegment(
  map: TerrainView,
  from: WorldPosition,
  to: WorldPosition,
  visit: (x: number, z: number, length: number) => boolean | void,
): boolean {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const length = Math.hypot(dx, dz);
  const xDirection = length === 0 ? 0 : dx / length;
  const zDirection = length === 0 ? 0 : dz / length;
  let { x, z } = tileAlong(map, from, xDirection, zDirection);
  const stepX = Math.sign(dx);
  const stepZ = Math.sign(dz);
  const boundary = (tile: number, step: number, min: number) =>
    min + (tile + (step > 0 ? 1 : 0)) * map.tileSize;
  let exitX =
    stepX === 0
      ? Number.POSITIVE_INFINITY
      : (boundary(x, stepX, map.worldBounds.minX) - from.x) / xDirection;
  let exitZ =
    stepZ === 0
      ? Number.POSITIVE_INFINITY
      : (boundary(z, stepZ, map.worldBounds.minZ) - from.z) / zDirection;
  const deltaX = Math.abs(map.tileSize / xDirection);
  const deltaZ = Math.abs(map.tileSize / zDirection);
  const cornerTolerance = map.tileSize * CORNER_TOLERANCE;
  let travelled = 0;

  while (true) {
    const exit = Math.min(exitX, exitZ, length);
    if (visit(x, z, Math.max(exit - travelled, 0)) === false) {
      return false;
    }
    if (exit >= length) {
      return true;
    }
    travelled = exit;
    if (Math.abs(exitX - exitZ) <= cornerTolerance) {
      if (
        visit(x + stepX, z, 0) === false ||
        visit(x, z + stepZ, 0) === false
      ) {
        return false;
      }
      x += stepX;
      z += stepZ;
      exitX += deltaX;
      exitZ += deltaZ;
    } else if (exitX < exitZ) {
      x += stepX;
      exitX += deltaX;
    } else {
      z += stepZ;
      exitZ += deltaZ;
    }
  }
}

/** Time-weighted length of a straight segment, or `undefined` if blocked. */
export function segmentCost(
  grid: NavigationGrid,
  from: WorldPosition,
  to: WorldPosition,
): number | undefined {
  let cost = 0;
  const clear = forEachTileOnSegment(grid.map, from, to, (x, z, length) => {
    const tileCost = grid.costAt(x, z);
    if (tileCost === undefined) {
      return false;
    }
    cost += length * tileCost;
  });
  return clear ? cost : undefined;
}

/**
 * The tile a mover at `position` stands on. On an edge or corner shared with a
 * passable tile it stands on that tile, so it cannot escape through a blocked
 * tile it only touches.
 */
export function occupiedTile(
  grid: NavigationGrid,
  position: WorldPosition,
): TileCoord {
  const { map } = grid;
  const tile = map.tileAtWorldPosition(position.x, position.z);
  const tolerance = CORNER_TOLERANCE;
  const onLowEdge = (world: number, min: number, index: number) =>
    index > 0 && (world - min) / map.tileSize - index <= tolerance;
  const xs = onLowEdge(position.x, map.worldBounds.minX, tile.x)
    ? [tile.x, tile.x - 1]
    : [tile.x];
  const zs = onLowEdge(position.z, map.worldBounds.minZ, tile.z)
    ? [tile.z, tile.z - 1]
    : [tile.z];
  for (const z of zs) {
    for (const x of xs) {
      if (grid.costAt(x, z) !== undefined) {
        return { x, z };
      }
    }
  }
  return tile;
}

/** The tile a mover occupies when it leaves `position` in this direction. */
export function tileAlong(
  map: TerrainView,
  position: WorldPosition,
  xDirection: number,
  zDirection: number,
): TileCoord {
  const epsilon = map.tileSize * CORNER_TOLERANCE;
  const { x, z } = clampToBounds(
    {
      x: position.x + xDirection * epsilon,
      z: position.z + zDirection * epsilon,
    },
    map.worldBounds,
  );
  return map.tileAtWorldPosition(x, z);
}

/** Nearest to the goal, then nearest to the start, then lowest index. */
function closestTileInRegions(
  grid: NavigationGrid,
  regions: ReadonlySet<number>,
  start: TileCoord,
  goal: TileCoord,
): TileCoord {
  let best = start;
  let bestGoalDistance = Number.POSITIVE_INFINITY;
  let bestStartDistance = Number.POSITIVE_INFINITY;
  for (let z = 0; z < grid.map.height; z += 1) {
    for (let x = 0; x < grid.map.width; x += 1) {
      if (!regions.has(grid.regionAt(x, z))) {
        continue;
      }
      const goalDistance = squaredDistance(x - goal.x, z - goal.z);
      const startDistance = squaredDistance(x - start.x, z - start.z);
      if (
        goalDistance < bestGoalDistance ||
        (goalDistance === bestGoalDistance && startDistance < bestStartDistance)
      ) {
        best = { x, z };
        bestGoalDistance = goalDistance;
        bestStartDistance = startDistance;
      }
    }
  }
  return best;
}

/** A* between tiles already known to share a region. */
function searchTiles(
  grid: NavigationGrid,
  start: TileCoord,
  end: TileCoord,
): TileCoord[] {
  const { map } = grid;
  const startIndex = map.tileIndex(start.x, start.z);
  const endIndex = map.tileIndex(end.x, end.z);
  const scores = new Float64Array(map.width * map.height).fill(
    Number.POSITIVE_INFINITY,
  );
  scores[startIndex] = 0;
  const parents = new Int32Array(map.width * map.height).fill(-1);
  const closed = new Uint8Array(map.width * map.height);
  const estimate = (tile: TileCoord) =>
    octileDistance(tile, end) * map.tileSize * grid.minimumCost;
  const open = new MinHeap();
  open.push({ index: startIndex, score: 0, estimate: estimate(start) });

  while (open.size > 0) {
    const entry = open.pop()!;
    const currentIndex = entry.index;
    if (closed[currentIndex] || entry.score !== scores[currentIndex]) {
      continue;
    }
    if (currentIndex === endIndex) {
      break;
    }
    closed[currentIndex] = 1;
    const current = tileForIndex(map, currentIndex);
    const currentCost = grid.costAt(current.x, current.z);

    for (const neighbor of NEIGHBORS) {
      const next = { x: current.x + neighbor.x, z: current.z + neighbor.z };
      if (!map.containsTile(next.x, next.z) || !grid.canStep(current, next)) {
        continue;
      }
      const nextIndex = map.tileIndex(next.x, next.z);
      if (closed[nextIndex]) {
        continue;
      }
      const nextCost = grid.costAt(next.x, next.z)!;
      // A center-to-center step spends half its length in each tile.
      const stepCost =
        currentCost === undefined ? nextCost : (currentCost + nextCost) / 2;
      const score =
        scores[currentIndex]! + neighbor.distance * map.tileSize * stepCost;
      if (score >= scores[nextIndex]!) {
        continue;
      }
      parents[nextIndex] = currentIndex;
      scores[nextIndex] = score;
      open.push({ index: nextIndex, score, estimate: score + estimate(next) });
    }
  }

  const reversed: TileCoord[] = [];
  for (let index = endIndex; index !== -1; index = parents[index]!) {
    reversed.push(tileForIndex(map, index));
  }
  return reversed.reverse();
}

/**
 * Greedily replaces runs of waypoints with one segment when that segment
 * crosses only passable tiles and costs no more time. A step off blocked
 * terrain stays as planned.
 */
function straightenRoute(
  grid: NavigationGrid,
  from: WorldPosition,
  route: WorldPosition[],
  startPassable: boolean,
): WorldPosition[] {
  const points = [from, ...route];
  const first = startPassable ? 0 : 1;
  const along = Array.from({ length: points.length }, () => 0);
  for (let index = first + 1; index < points.length; index += 1) {
    along[index] =
      along[index - 1]! +
      (segmentCost(grid, points[index - 1]!, points[index]!) ??
        Number.POSITIVE_INFINITY);
  }

  const straightened = points.slice(1, first + 1);
  let anchor = first;
  while (anchor < points.length - 1) {
    let next = anchor + 1;
    for (let candidate = next + 1; candidate < points.length; candidate += 1) {
      const cost = segmentCost(grid, points[anchor]!, points[candidate]!);
      const allowed =
        (along[candidate]! - along[anchor]!) * (1 + SHORTCUT_TOLERANCE);
      if (cost === undefined || !(cost <= allowed)) {
        break;
      }
      next = candidate;
    }
    straightened.push(points[next]!);
    anchor = next;
  }
  return straightened;
}

function squaredDistance(x: number, z: number): number {
  return x * x + z * z;
}

function octileDistance(from: TileCoord, to: TileCoord): number {
  const x = Math.abs(to.x - from.x);
  const z = Math.abs(to.z - from.z);
  return Math.max(x, z) + (Math.SQRT2 - 1) * Math.min(x, z);
}

function tileForIndex(map: TerrainView, index: number): TileCoord {
  return { x: index % map.width, z: Math.floor(index / map.width) };
}

/** Deterministic binary heap ordered by estimate, then tile index. */
class MinHeap {
  private items: OpenTile[] = [];

  get size(): number {
    return this.items.length;
  }

  push(item: OpenTile): void {
    this.items.push(item);
    let index = this.items.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (!before(item, this.items[parent]!)) break;
      this.items[index] = this.items[parent]!;
      index = parent;
    }
    this.items[index] = item;
  }

  pop(): OpenTile | undefined {
    const first = this.items[0];
    const last = this.items.pop();
    if (!first || !last || this.items.length === 0) {
      return first;
    }
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      if (left >= this.items.length) break;
      const child =
        right < this.items.length &&
        before(this.items[right]!, this.items[left]!)
          ? right
          : left;
      if (!before(this.items[child]!, last)) break;
      this.items[index] = this.items[child]!;
      index = child;
    }
    this.items[index] = last;
    return first;
  }
}

function before(left: OpenTile, right: OpenTile): boolean {
  return (
    left.estimate < right.estimate ||
    (left.estimate === right.estimate && left.index < right.index)
  );
}
