import { Color3, LinesMesh, MeshBuilder, Vector3 } from "@babylonjs/core";

import { groundPoint, groundRing, groundCross } from "./ground-marker";
import { TERRAIN_LAYER_OFFSET } from "./terrain-mesh";

import type { Observer, Scene } from "@babylonjs/core";
import type { TerrainMap } from "../map";
import type { ActorRenderState } from "../simulation/actor";
import type { WorldPosition } from "../simulation/world";

const PATH_COLOR = new Color3(1, 0.78, 0.24);
const BLOCKED_COLOR = new Color3(1, 0.25, 0.17);
const PATH_ALPHA = 0.95;
const DOT_PERIOD = 0.36;
const DOT_LENGTH = 0.08;
const MARKER_RADIUS = 0.48;
const MARKER_SEGMENTS = 32;
const MARKER_OFFSET = 0.035;
const REJECTED_MARKER_SECONDS = 1.5;

export type MovementPathView = {
  dispose: () => void;
  setSelectedActors: (actorIds: readonly string[]) => void;
  showRejectedTarget: (
    actorId: string,
    target: Readonly<WorldPosition>,
  ) => void;
  update: (actors: readonly ActorRenderState[]) => void;
};

type ActiveMovement = NonNullable<ActorRenderState["movement"]>;

type Route = {
  actorId: string;
  movement: ActiveMovement;
  destinationMarker?: LinesMesh;
  line?: LinesMesh;
  /** Dashes from the destination back towards where the route was drawn. */
  dashes: Vector3[][];
  /** Route distance from the destination to each dash's far end. */
  dashEnds: number[];
  /** Route distance from each waypoint to the destination. */
  waypointDistances: number[];
  visibleDashes: number;
};

/**
 * Draws selected actors' remaining routes and resolved destinations. Dashes
 * stay fixed on the ground and disappear as the actor passes them. Actors
 * sharing a blocked target share one marker.
 */
export function createMovementPathView(
  scene: Scene,
  map: TerrainMap,
): MovementPathView {
  let selected = new Set<string>();
  const routes = new Map<string, Route>();
  const rejected = new Map<
    string,
    { target: WorldPosition; seconds: number }
  >();
  const blockedMarkers = new Map<string, LinesMesh[]>();
  let disposed = false;
  const clearRoute = (id: string) => {
    const route = routes.get(id);
    route?.line?.dispose();
    route?.destinationMarker?.dispose();
    routes.delete(id);
  };
  const clearBlockedMarker = (key: string) => {
    for (const marker of blockedMarkers.get(key) ?? []) marker.dispose();
    blockedMarkers.delete(key);
  };
  const syncBlockedMarkers = () => {
    const targets = new Map<string, WorldPosition>();
    const mark = (target: WorldPosition) =>
      targets.set(`${target.x},${target.z}`, target);
    for (const { movement } of routes.values())
      if (
        movement.blocked ||
        movement.reachedTarget === false ||
        movement.requestedTarget
      )
        mark(movement.requestedTarget ?? movement.target);
    for (const { target } of rejected.values()) mark(target);
    for (const key of blockedMarkers.keys())
      if (!targets.has(key)) clearBlockedMarker(key);
    for (const [key, target] of targets)
      if (!blockedMarkers.has(key))
        blockedMarkers.set(
          key,
          createBlockedMarker(scene, map, target, groundOffset(map)),
        );
  };
  const setSelectedActors = (ids: readonly string[]) => {
    selected = new Set(ids);
    for (const id of routes.keys()) if (!selected.has(id)) clearRoute(id);
    for (const id of rejected.keys())
      if (!selected.has(id)) rejected.delete(id);
    syncBlockedMarkers();
  };
  // Markers are recreated on the next update.
  const refreshGroundGeometry = () => {
    for (const id of routes.keys()) clearRoute(id);
    for (const key of blockedMarkers.keys()) clearBlockedMarker(key);
  };
  const update = (actors: readonly ActorRenderState[]) => {
    const present = new Set(actors.map(({ id }) => id));
    for (const [id, entry] of rejected) {
      entry.seconds -= scene.getEngine().getDeltaTime() / 1000;
      if (entry.seconds <= 0 || !present.has(id)) rejected.delete(id);
    }
    for (const id of routes.keys()) if (!present.has(id)) clearRoute(id);
    for (const actor of actors) {
      if (!selected.has(actor.id)) continue;
      const movement = actor.movement;
      if (
        !movement?.waypoints ||
        movement.waypointIndex === undefined ||
        !movement.destination
      ) {
        clearRoute(actor.id);
        continue;
      }
      let route = routes.get(actor.id);
      if (!route || !isSameRoute(route, actor.id, movement)) {
        clearRoute(actor.id);
        route = createRoute(scene, map, actor, movement);
        routes.set(actor.id, route);
      }
      route.movement = movement;
      trimRoute(scene, route, actor, movement);
    }
    syncBlockedMarkers();
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const id of routes.keys()) clearRoute(id);
    for (const key of blockedMarkers.keys()) clearBlockedMarker(key);
    rejected.clear();
    map.onChangedObservable.remove(terrainChangeObserver);
    scene.onDisposeObservable.remove(sceneDisposeObserver);
  };
  const terrainChangeObserver = map.onChangedObservable.add(
    refreshGroundGeometry,
  );
  const sceneDisposeObserver: Observer<Scene> =
    scene.onDisposeObservable.add(dispose);
  return {
    dispose,
    setSelectedActors,
    showRejectedTarget: (id, target) => {
      if (!selected.has(id)) return;
      rejected.set(id, {
        target: { ...target },
        seconds: REJECTED_MARKER_SECONDS,
      });
      syncBlockedMarkers();
    },
    update,
  };
}

/** Progress along a route does not change it; a new order or replan does. */
function isSameRoute(
  route: Route,
  actorId: string,
  movement: ActiveMovement,
): boolean {
  const previous = route.movement;
  const waypoints = movement.waypoints!;
  return (
    route.actorId === actorId &&
    samePoint(previous.target, movement.target) &&
    samePoint(previous.destination!, movement.destination!) &&
    previous.reachedTarget === movement.reachedTarget &&
    previous.blocked === movement.blocked &&
    previous.waypoints!.length === waypoints.length &&
    waypoints.every((point, index) =>
      samePoint(point, previous.waypoints![index]!),
    )
  );
}

function createRoute(
  scene: Scene,
  map: TerrainMap,
  actor: ActorRenderState,
  movement: ActiveMovement,
): Route {
  const offset = groundOffset(map);
  const waypoints = movement.waypoints!;
  const route: Route = {
    actorId: actor.id,
    movement,
    dashes: [],
    dashEnds: [],
    waypointDistances: [],
    visibleDashes: 0,
  };
  // The view draws the blocked marker, which actors may share.
  if (movement.blocked) return route;
  route.destinationMarker = createGroundRing(
    scene,
    map,
    "movement-path-destination",
    movement.destination!,
    PATH_COLOR,
    offset,
  );

  const distances = Array.from({ length: waypoints.length }, () => 0);
  for (let index = waypoints.length - 2; index >= 0; index -= 1) {
    distances[index] =
      distances[index + 1]! +
      distance(waypoints[index]!, waypoints[index + 1]!);
  }
  route.waypointDistances = distances;

  // Walk backwards from the destination so dashes keep their ground position.
  const backwards = [
    ...waypoints.slice(movement.waypointIndex).reverse(),
    actor.worldPosition,
  ];
  const length = remainingDistance(route, actor, movement);
  for (let near = 0; near < length; near += DOT_PERIOD) {
    const far = Math.min(near + DOT_LENGTH, length);
    route.dashes.push([
      groundPoint(map, pointAlong(backwards, near), offset),
      groundPoint(map, pointAlong(backwards, far), offset),
    ]);
    route.dashEnds.push(far);
  }
  if (route.dashes.length > 0) {
    route.visibleDashes = route.dashes.length;
    route.line = MeshBuilder.CreateLineSystem(
      "movement-path-route",
      { lines: route.dashes, updatable: true },
      scene,
    );
    route.line.color = PATH_COLOR;
    route.line.alpha = PATH_ALPHA;
    route.line.isPickable = false;
  }
  return route;
}

/** Collapses the dashes behind the actor, keeping the vertex count. */
function trimRoute(
  scene: Scene,
  route: Route,
  actor: ActorRenderState,
  movement: ActiveMovement,
): void {
  if (!route.line) return;
  const remaining = remainingDistance(route, actor, movement);
  let visible = 0;
  while (
    visible < route.dashEnds.length &&
    route.dashEnds[visible]! <= remaining
  ) {
    visible += 1;
  }
  if (visible === route.visibleDashes) return;
  route.visibleDashes = visible;
  MeshBuilder.CreateLineSystem(
    route.line.name,
    {
      lines: route.dashes.map((dash, index) =>
        index < visible ? dash : [dash[0]!, dash[0]!],
      ),
      instance: route.line,
    },
    scene,
  );
}

function remainingDistance(
  route: Route,
  actor: ActorRenderState,
  movement: ActiveMovement,
): number {
  const index = movement.waypointIndex!;
  const next = movement.waypoints![index];
  if (!next) return 0;
  return distance(actor.worldPosition, next) + route.waypointDistances[index]!;
}

function pointAlong(
  points: readonly Readonly<WorldPosition>[],
  target: number,
): WorldPosition {
  let remaining = target;
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1]!;
    const to = points[index]!;
    const segment = distance(from, to);
    if (remaining <= segment && segment > 0) {
      const share = remaining / segment;
      return {
        x: from.x + (to.x - from.x) * share,
        z: from.z + (to.z - from.z) * share,
      };
    }
    remaining -= segment;
  }
  return { ...points[points.length - 1]! };
}

function distance(
  from: Readonly<WorldPosition>,
  to: Readonly<WorldPosition>,
): number {
  return Math.hypot(to.x - from.x, to.z - from.z);
}

function samePoint(
  left: Readonly<WorldPosition>,
  right: Readonly<WorldPosition>,
): boolean {
  return left.x === right.x && left.z === right.z;
}

function createBlockedMarker(
  scene: Scene,
  map: TerrainMap,
  target: Readonly<WorldPosition>,
  offset: number,
): LinesMesh[] {
  return [
    createGroundRing(
      scene,
      map,
      "movement-path-unreachable",
      target,
      BLOCKED_COLOR,
      offset,
    ),
    createBlockedCross(scene, map, target, offset),
  ];
}

function createGroundRing(
  scene: Scene,
  map: TerrainMap,
  name: string,
  center: Readonly<WorldPosition>,
  color: Color3,
  offset: number,
): LinesMesh {
  const points = groundRing(center, MARKER_RADIUS, MARKER_SEGMENTS, (point) =>
    groundPoint(map, point, offset),
  );
  const ring = MeshBuilder.CreateLines(name, { points }, scene);
  ring.color = color;
  ring.alpha = PATH_ALPHA;
  ring.isPickable = false;
  return ring;
}

function createBlockedCross(
  scene: Scene,
  map: TerrainMap,
  center: Readonly<WorldPosition>,
  offset: number,
): LinesMesh {
  const diagonal = MARKER_RADIUS * Math.SQRT1_2;
  const cross = MeshBuilder.CreateLineSystem(
    "movement-path-unreachable-cross",
    {
      lines: groundCross(center, diagonal, (point) =>
        groundPoint(map, point, offset),
      ),
    },
    scene,
  );
  cross.color = BLOCKED_COLOR;
  cross.alpha = PATH_ALPHA;
  cross.isPickable = false;
  return cross;
}

/** Scans every tile, so call it only when geometry is rebuilt. */
function groundOffset(map: TerrainMap): number {
  return map.layerCount * TERRAIN_LAYER_OFFSET + MARKER_OFFSET;
}
