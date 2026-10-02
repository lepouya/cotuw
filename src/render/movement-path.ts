import { Color3, LinesMesh, MeshBuilder, Vector3 } from "@babylonjs/core";

import { clampToBounds } from "../simulation/world";
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
  markers: LinesMesh[];
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
 * stay fixed on the ground and disappear as the actor passes them.
 */
export function createMovementPathView(
  scene: Scene,
  map: TerrainMap,
): MovementPathView {
  let selected = new Set<string>();
  const routes = new Map<string, Route>();
  const rejected = new Map<
    string,
    { target: WorldPosition; seconds: number; markers: LinesMesh[] }
  >();
  let disposed = false;
  const clearRoute = (id: string) => {
    const route = routes.get(id);
    route?.line?.dispose();
    for (const marker of route?.markers ?? []) marker.dispose();
    routes.delete(id);
  };
  const clearRejected = (id: string) => {
    for (const marker of rejected.get(id)?.markers ?? []) marker.dispose();
    rejected.delete(id);
  };
  const setSelectedActors = (ids: readonly string[]) => {
    selected = new Set(ids);
    for (const id of routes.keys()) if (!selected.has(id)) clearRoute(id);
    for (const id of rejected.keys()) if (!selected.has(id)) clearRejected(id);
  };
  const refreshGroundGeometry = () => {
    for (const id of routes.keys()) clearRoute(id);
    for (const entry of rejected.values()) {
      for (const marker of entry.markers) marker.dispose();
      entry.markers = createBlockedMarker(
        scene,
        map,
        entry.target,
        groundOffset(map),
      );
    }
  };
  const update = (actors: readonly ActorRenderState[]) => {
    const present = new Set(actors.map(({ id }) => id));
    for (const [id, entry] of rejected) {
      entry.seconds -= scene.getEngine().getDeltaTime() / 1000;
      if (entry.seconds <= 0 || !present.has(id)) clearRejected(id);
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
      trimRoute(scene, route, actor, movement);
    }
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const id of routes.keys()) clearRoute(id);
    for (const id of rejected.keys()) clearRejected(id);
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
      clearRejected(id);
      rejected.set(id, {
        target: { ...target },
        seconds: REJECTED_MARKER_SECONDS,
        markers: createBlockedMarker(scene, map, target, groundOffset(map)),
      });
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
    (previous.requestedTarget === undefined
      ? movement.requestedTarget === undefined
      : movement.requestedTarget !== undefined &&
        samePoint(previous.requestedTarget, movement.requestedTarget)) &&
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
    markers: [],
    dashes: [],
    dashEnds: [],
    waypointDistances: [],
    visibleDashes: 0,
  };
  if (movement.blocked) {
    route.markers = createBlockedMarker(
      scene,
      map,
      movement.requestedTarget ?? movement.target,
      offset,
    );
    return route;
  }
  route.markers.push(
    createGroundRing(
      scene,
      map,
      "movement-path-destination",
      movement.destination!,
      PATH_COLOR,
      offset,
    ),
  );
  if (movement.reachedTarget === false || movement.requestedTarget) {
    route.markers.push(
      ...createBlockedMarker(
        scene,
        map,
        movement.requestedTarget ?? movement.target,
        offset,
      ),
    );
  }

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
  const points: Vector3[] = [];
  for (let index = 0; index <= MARKER_SEGMENTS; index += 1) {
    const angle = (index / MARKER_SEGMENTS) * Math.PI * 2;
    points.push(
      groundPoint(
        map,
        {
          x: center.x + Math.cos(angle) * MARKER_RADIUS,
          z: center.z + Math.sin(angle) * MARKER_RADIUS,
        },
        offset,
      ),
    );
  }
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
  const corner = (x: number, z: number) =>
    groundPoint(
      map,
      { x: center.x + x * diagonal, z: center.z + z * diagonal },
      offset,
    );
  const cross = MeshBuilder.CreateLineSystem(
    "movement-path-unreachable-cross",
    {
      lines: [
        [corner(-1, -1), corner(1, 1)],
        [corner(-1, 1), corner(1, -1)],
      ],
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

function groundPoint(
  map: TerrainMap,
  point: Readonly<WorldPosition>,
  offset: number,
): Vector3 {
  const sample = clampToBounds(point, map.worldBounds);
  return new Vector3(
    point.x,
    map.heightAtWorldPosition(sample.x, sample.z) + offset,
    point.z,
  );
}
