import { ArcRotateCamera, Camera, Scene, Vector3 } from "@babylonjs/core";

import { createPointerGesture } from "./pointer-gesture";

import type { TerrainMap } from "../map";

/** How much of the viewport the map footprint fills once fitted. */
const MAP_FIT_VIEW_FILL = 0.76;
const MINIMUM_CAMERA_DISTANCE = 160;
/** The closest zoom, in tiles across the viewport's height. */
const MINIMUM_VIEW_TILES = 2;
/** The framing a new view starts at, in tiles across the viewport's height. */
const INITIAL_VIEW_TILES = 24;
const ZOOM_SENSITIVITY = 0.0015;
/** Pixels per wheel line, for line-based deltas. */
const WHEEL_LINE_PIXELS = 16;
const INITIAL_ALPHA = -Math.PI / 4;
const INITIAL_BETA = Math.PI / 3.2;
const LOWER_BETA_LIMIT = Math.PI / 7;
const UPPER_BETA_LIMIT = Math.PI / 2.15;
const NEAR_CLIP = 0.01;
/** Replaced by the distance-based far clip once the view is framed. */
const INITIAL_FAR_CLIP = 500;
/** Extra depth range beyond twice the camera distance. */
const FAR_CLIP_MARGIN = 100;
/** How long a glide takes to reach its destination, whatever the distance. */
const GLIDE_SECONDS = 0.3;

export type StrategyCamera = {
  /** Frames the starting view: centered, close enough to read one tile. */
  resetView: () => void;
  panView: (horizontal: number, vertical: number) => void;
  rotateView: (radians: number) => void;
  tiltView: (radians: number) => void;
  zoomBy: (factor: number) => void;
  setTouchPanEnabled: (enabled: (event: PointerEvent) => boolean) => void;
  fitToMap: () => void;
  /** Centers the view on a tile without changing the zoom. */
  focusOnTile: (x: number, z: number) => void;
  /** Centers the view on a world point without changing the zoom. */
  focusOnPoint: (point: Vector3) => void;
  /** Eases the view onto a world point; any other pan cancels the glide. */
  glideToPoint: (point: Vector3) => void;
  /**
   * The world quad where the view volume currently meets `height`, ordered
   * bottom-left, bottom-right, top-right, top-left as seen on screen.
   */
  viewFootprint: (height?: number) => Vector3[];
};

export function createStrategyCamera(
  scene: Scene,
  canvas: HTMLCanvasElement,
  map: TerrainMap,
): StrategyCamera {
  const camera = new ArcRotateCamera(
    "strategy-camera",
    INITIAL_ALPHA,
    INITIAL_BETA,
    MINIMUM_CAMERA_DISTANCE,
    Vector3.Zero(),
    scene,
  );

  camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
  camera.lowerBetaLimit = LOWER_BETA_LIMIT;
  camera.upperBetaLimit = UPPER_BETA_LIMIT;
  camera.lowerRadiusLimit = MINIMUM_CAMERA_DISTANCE;
  camera.upperRadiusLimit = MINIMUM_CAMERA_DISTANCE;
  camera.minZ = NEAR_CLIP;
  camera.maxZ = INITIAL_FAR_CLIP;
  // Panning must stick to the pointer, so it cannot glide after release.
  camera.panningInertia = 0;
  camera.attachControl(canvas, true);
  // Pointer gestures are shared with unit selection and explicit touch modes.
  camera.inputs.removeByType("ArcRotateCameraPointersInput");
  camera.inputs.removeByType("ArcRotateCameraMouseWheelInput");

  let viewHeight = INITIAL_VIEW_TILES * map.tileSize;
  const syncViewBounds = () => {
    syncOrthographicBounds(camera, canvas, viewHeight);
    // Panning moves the target in world units, so sensibility tracks the zoom.
    camera.panningSensibility = Math.max(canvas.clientHeight, 1) / viewHeight;
  };
  const setViewHeight = (height: number) => {
    // Zooming out stops at the whole map, zooming in a couple of tiles short.
    const minimumViewHeight = MINIMUM_VIEW_TILES * map.tileSize;
    const maximumViewHeight = Math.max(
      viewHeightToFitMap(camera, canvas, map),
      minimumViewHeight,
    );
    const clamped = Math.min(
      Math.max(height, minimumViewHeight),
      maximumViewHeight,
    );
    // Keep the last good height so a zero-sized canvas cannot strand the view.
    viewHeight = Number.isFinite(clamped) ? clamped : viewHeight;
    syncViewBounds();
  };
  const setDistance = (distance: number) => {
    const safeDistance = Math.max(distance, MINIMUM_CAMERA_DISTANCE);
    camera.lowerRadiusLimit = safeDistance;
    camera.upperRadiusLimit = safeDistance;
    camera.radius = safeDistance;
    camera.maxZ = safeDistance * 2 + FAR_CLIP_MARGIN;
  };
  let glide: { from: Vector3; to: Vector3; elapsed: number } | undefined;
  // Babylon would otherwise re-derive alpha, beta and radius from the
  // unchanged position and tilt the fixed isometric view.
  const retarget = (target: Vector3) =>
    camera.setTarget(target, false, false, true);
  // Every deliberate move replaces a glide instead of fighting it.
  const moveTo = (target: Vector3) => {
    glide = undefined;
    retarget(target);
  };
  const fitToMap = () => {
    moveTo(Vector3.Zero());
    setDistance(cameraDistanceForMap(map));
    setViewHeight(viewHeightToFitMap(camera, canvas, map));
  };
  // Small maps get fitted instead, so the start never overshoots the map.
  const resetView = () => {
    camera.alpha = INITIAL_ALPHA;
    camera.beta = INITIAL_BETA;
    moveTo(Vector3.Zero());
    setDistance(cameraDistanceForMap(map));
    setViewHeight(
      Math.min(
        INITIAL_VIEW_TILES * map.tileSize,
        viewHeightToFitMap(camera, canvas, map),
      ),
    );
  };
  const focusOnPoint = (point: Vector3) => moveTo(groundPoint(point));
  const focusOnTile = (x: number, z: number) => {
    focusOnPoint(map.worldPoint(x + 0.5, z + 0.5, 0));
  };
  const glideToPoint = (point: Vector3) => {
    glide = { from: camera.target.clone(), to: groundPoint(point), elapsed: 0 };
  };
  const advanceGlide = () => {
    if (!glide) {
      return;
    }

    glide.elapsed += scene.getEngine().getDeltaTime() / 1000;
    const progress = Math.min(glide.elapsed / GLIDE_SECONDS, 1);
    retarget(Vector3.Lerp(glide.from, glide.to, easeOutCubic(progress)));
    if (progress === 1) {
      glide = undefined;
    }
  };
  let touchPanEnabled = (_event: PointerEvent) => true;
  const pointAt = (x: number, y: number) => {
    camera.getViewMatrix();
    const bounds = canvas.getBoundingClientRect();
    return projectOntoPlane(
      orthographicFrameOf(camera),
      ((x - bounds.left - bounds.width / 2) * viewHeight) /
        Math.max(bounds.height, 1),
      ((bounds.height / 2 - y + bounds.top) * viewHeight) /
        Math.max(bounds.height, 1),
      0,
    );
  };
  const pointer = createPointerGesture(canvas, {
    start: (event) => {
      const touch = event.pointerType === "touch";
      if (!(
        event.button === 2 ||
        (touch && event.button === 0 && touchPanEnabled(event))
      ))
        return undefined;
      glide = undefined;
      return { rotate: !touch && event.shiftKey };
    },
    move: (event, gesture) => {
      if (!gesture.dragged) return;
      if (gesture.data.rotate) {
        camera.alpha -= (event.clientX - gesture.last.clientX) * 0.005;
        camera.beta = Math.max(
          LOWER_BETA_LIMIT,
          Math.min(
            UPPER_BETA_LIMIT,
            camera.beta - (event.clientY - gesture.last.clientY) * 0.005,
          ),
        );
      } else {
        const from = pointAt(gesture.last.clientX, gesture.last.clientY);
        const to = pointAt(event.clientX, event.clientY);
        moveTo(camera.target.add(from.subtract(to)));
      }
    },
  });
  const panView = (horizontal: number, vertical: number) => {
    const bounds = canvas.getBoundingClientRect();
    const centerX = bounds.left + bounds.width / 2;
    const centerY = bounds.top + bounds.height / 2;
    const from = pointAt(centerX, centerY);
    const to = pointAt(
      centerX + horizontal * bounds.height * 0.18,
      centerY + vertical * bounds.height * 0.18,
    );
    moveTo(camera.target.add(to.subtract(from)));
  };
  const rotateView = (radians: number) => {
    glide = undefined;
    camera.alpha += radians;
  };
  const viewFootprint = (height = 0) =>
    orthographicViewFootprint(
      orthographicFrameOf(camera),
      {
        left: camera.orthoLeft ?? 0,
        right: camera.orthoRight ?? 0,
        top: camera.orthoTop ?? 0,
        bottom: camera.orthoBottom ?? 0,
      },
      height,
    );

  const zoom = (event: WheelEvent) => {
    const pixels = wheelDeltaPixels(event, canvas.clientHeight);
    setViewHeight(viewHeight * Math.exp(pixels * ZOOM_SENSITIVITY));
    event.preventDefault();
  };
  let syncedWidth = canvas.clientWidth;
  let syncedHeight = canvas.clientHeight;
  // Runs in the same frame as the engine's resize. A new canvas size keeps the
  // player's zoom, re-clamped to the new viewport.
  const syncToCanvas = () => {
    if (
      canvas.clientWidth === syncedWidth &&
      canvas.clientHeight === syncedHeight
    ) {
      syncViewBounds();
      return;
    }
    syncedWidth = canvas.clientWidth;
    syncedHeight = canvas.clientHeight;
    setViewHeight(viewHeight);
  };
  canvas.addEventListener("wheel", zoom, { passive: false });
  scene.onDisposeObservable.add(() => {
    canvas.removeEventListener("wheel", zoom);
    pointer.dispose();
  });
  scene.onBeforeRenderObservable.add(advanceGlide);
  scene.onBeforeRenderObservable.add(syncToCanvas);

  return {
    resetView,
    panView,
    rotateView,
    tiltView: (radians) => {
      glide = undefined;
      camera.beta = Math.max(
        LOWER_BETA_LIMIT,
        Math.min(UPPER_BETA_LIMIT, camera.beta + radians),
      );
    },
    zoomBy: (factor) => setViewHeight(viewHeight * factor),
    setTouchPanEnabled: (enabled) => {
      pointer.cancel();
      touchPanEnabled = enabled;
    },
    fitToMap,
    focusOnTile,
    focusOnPoint,
    glideToPoint,
    viewFootprint,
  };
}

/** Targets stay on the ground plane; only x/z come from the point. */
function groundPoint(point: Vector3): Vector3 {
  return new Vector3(point.x, 0, point.z);
}

function easeOutCubic(progress: number): number {
  return 1 - (1 - progress) ** 3;
}

/** Wheel travel in pixels; Firefox mice report lines. */
function wheelDeltaPixels(event: WheelEvent, pageHeight: number): number {
  switch (event.deltaMode) {
    case WheelEvent.DOM_DELTA_LINE:
      return event.deltaY * WHEEL_LINE_PIXELS;
    case WheelEvent.DOM_DELTA_PAGE:
      return event.deltaY * pageHeight;
    default:
      return event.deltaY;
  }
}

function syncOrthographicBounds(
  camera: ArcRotateCamera,
  canvas: HTMLCanvasElement,
  viewHeight: number,
): void {
  const aspectRatio = aspectRatioOf(canvas);
  const halfHeight = viewHeight * 0.5;

  camera.orthoLeft = -halfHeight * aspectRatio;
  camera.orthoRight = halfHeight * aspectRatio;
  camera.orthoTop = halfHeight;
  camera.orthoBottom = -halfHeight;
}

/** Canvas aspect ratio, or 1 when hidden: NaN bounds never recover. */
function aspectRatioOf(canvas: HTMLCanvasElement): number {
  const aspectRatio = canvas.clientWidth / canvas.clientHeight;
  return Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 1;
}

/** An orthographic camera's world-space placement, independent of Babylon. */
export type OrthographicFrame = {
  position: Vector3;
  right: Vector3;
  up: Vector3;
  forward: Vector3;
};

/** Reads any camera's world-space placement as an `OrthographicFrame`. */
function orthographicFrameOf(camera: Camera): OrthographicFrame {
  return {
    position: camera.position,
    right: camera.getDirection(Vector3.Right()),
    up: camera.getDirection(Vector3.Up()),
    forward: camera.getDirection(Vector3.Forward()),
  };
}

/**
 * Where the orthographic ray through local offset (u, v) meets the
 * horizontal plane at `height`. Assumes `frame.forward` is not horizontal.
 */
export function projectOntoPlane(
  frame: OrthographicFrame,
  u: number,
  v: number,
  height: number,
): Vector3 {
  const origin = frame.position
    .add(frame.right.scale(u))
    .add(frame.up.scale(v));
  const travel = (height - origin.y) / frame.forward.y;
  return origin.add(frame.forward.scale(travel));
}

/**
 * The four corners, in order around the quad, where an orthographic view
 * volume meets the horizontal plane at `height`.
 */
export function orthographicViewFootprint(
  frame: OrthographicFrame,
  bounds: { left: number; right: number; top: number; bottom: number },
  height: number,
): Vector3[] {
  return [
    [bounds.left, bounds.bottom],
    [bounds.right, bounds.bottom],
    [bounds.right, bounds.top],
    [bounds.left, bounds.top],
  ].map(([u, v]) => projectOntoPlane(frame, u, v, height));
}

function viewHeightToFitMap(
  camera: ArcRotateCamera,
  canvas: HTMLCanvasElement,
  map: TerrainMap,
): number {
  const viewMatrix = camera.getViewMatrix();
  const aspectRatio = aspectRatioOf(canvas);
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  const groundCorners = [
    map.worldPoint(0, 0, 0),
    map.worldPoint(map.width, 0, 0),
    map.worldPoint(0, map.height, 0),
    map.worldPoint(map.width, map.height, 0),
  ];

  for (const corner of groundCorners) {
    const viewPoint = Vector3.TransformCoordinates(corner, viewMatrix);
    minX = Math.min(minX, viewPoint.x);
    maxX = Math.max(maxX, viewPoint.x);
    minY = Math.min(minY, viewPoint.y);
    maxY = Math.max(maxY, viewPoint.y);
  }

  const requiredViewHeight = Math.max(maxY - minY, (maxX - minX) / aspectRatio);
  return requiredViewHeight / MAP_FIT_VIEW_FILL;
}

function cameraDistanceForMap(map: TerrainMap): number {
  const mapDiagonal = Math.hypot(
    map.width * map.tileSize,
    map.height * map.tileSize,
  );
  return Math.max(mapDiagonal, MINIMUM_CAMERA_DISTANCE);
}
