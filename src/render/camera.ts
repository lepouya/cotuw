import {
  ArcRotateCamera,
  Camera,
  Observable,
  Scene,
  Vector3,
} from "@babylonjs/core";

import { createPointerGesture } from "./pointer-gesture";
import { createEdgePan } from "./edge-pan";
import { worldInputAvailable, isTextEntry } from "./input-focus";

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
// Look 22.5° east of north (+z).
const INITIAL_ALPHA = (-5 * Math.PI) / 8;
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
const CONTINUOUS_PAN_SPEED = 3;
const PAN_VIEW_FRACTION = 0.18;
const PAN_KEYS: Readonly<Record<string, readonly [number, number]>> = {
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
};

export type StrategyCamera = {
  /** Frames the starting view: centered, close enough to read one tile. */
  resetView: () => void;
  panView: (horizontal: number, vertical: number) => void;
  readonly panMode: boolean;
  /** Reserves primary pointers for navigation instead of world actions. */
  readonly primaryPanActive: boolean;
  readonly onPanChangedObservable: Observable<void>;
  setPanMode: (active: boolean) => void;
  readonly edgePanEnabled: boolean;
  setEdgePanEnabled: (active: boolean) => void;
  rotateView: (radians: number) => void;
  tiltView: (radians: number) => void;
  zoomBy: (factor: number) => void;
  /** Constrains every new focal point, such as to explored terrain. */
  setFocusLimit: (limit: (point: Vector3) => Vector3) => void;
  /** Decides whether a one-finger touch press pans the view. */
  setTouchPanFilter: (canPan: (event: PointerEvent) => boolean) => void;
  /** Developer framing of the whole grid; ignores the focus limit. */
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
  // Every camera input is handled here, sharing gestures with unit selection.
  camera.inputs.clear();

  let viewHeight = INITIAL_VIEW_TILES * map.tileSize;
  const syncViewBounds = () =>
    syncOrthographicBounds(camera, canvas, viewHeight);
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
  let limitFocus = (point: Vector3) => point;
  // Babylon would otherwise re-derive alpha, beta and radius from the
  // unchanged position and tilt the fixed isometric view.
  const retarget = (target: Vector3) =>
    camera.setTarget(target, false, false, true);
  // Every deliberate move replaces a glide instead of fighting it.
  const moveTo = (target: Vector3) => {
    glide = undefined;
    retarget(limitFocus(target));
  };
  const fitToMap = () => {
    glide = undefined;
    retarget(Vector3.Zero());
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
    glide = {
      from: camera.target.clone(),
      to: limitFocus(groundPoint(point)),
      elapsed: 0,
    };
  };
  const advanceGlide = () => {
    if (!glide) {
      return;
    }

    glide.elapsed += scene.getEngine().getDeltaTime() / 1000;
    const progress = Math.min(glide.elapsed / GLIDE_SECONDS, 1);
    retarget(
      limitFocus(Vector3.Lerp(glide.from, glide.to, easeOutCubic(progress))),
    );
    if (progress === 1) {
      glide = undefined;
    }
  };
  const setBeta = (beta: number) => {
    camera.beta = Math.max(LOWER_BETA_LIMIT, Math.min(UPPER_BETA_LIMIT, beta));
  };
  let canTouchPan = (_event: PointerEvent) => true;
  let panMode = false;
  let spaceHeld = false;
  const panKeys = new Set<string>();
  const onPanChangedObservable = new Observable<void>();
  const primaryPanActive = () => panMode || spaceHeld;
  const panChanged = () => {
    pointer.cancel();
    canvas.setAttribute?.("data-camera-pan-active", String(primaryPanActive()));
    onPanChangedObservable.notifyObservers();
  };
  const setPanMode = (active: boolean) => {
    if (panMode === active) return;
    panMode = active;
    panChanged();
  };
  const pointAt = (x: number, y: number) => {
    // Refreshes the camera position after alpha, beta or target changes.
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
    enabled: () => worldInputAvailable(canvas.ownerDocument),
    start: (event) => {
      const touch = event.pointerType === "touch";
      if (!(
        event.button === 2 ||
        (event.button === 0 &&
          (primaryPanActive() || (touch && canTouchPan(event))))
      ))
        return undefined;
      glide = undefined;
      canvas.focus?.({ preventScroll: true });
      return { rotate: event.button === 2 && !touch && event.shiftKey };
    },
    move: (event, gesture) => {
      if (gesture.data.rotate) {
        camera.alpha -= (event.clientX - gesture.last.clientX) * 0.005;
        setBeta(camera.beta - (event.clientY - gesture.last.clientY) * 0.005);
      } else {
        canvas.setAttribute?.("data-camera-dragging", "true");
        panPixels(
          gesture.last.clientX - event.clientX,
          gesture.last.clientY - event.clientY,
        );
      }
    },
    release: () => canvas.removeAttribute?.("data-camera-dragging"),
  });
  /** Moves the view as far as the ground under a screen offset travels. */
  const panPixels = (x: number, y: number) => {
    const from = pointAt(0, 0);
    moveTo(camera.target.add(pointAt(x, y).subtract(from)));
  };
  const panView = (horizontal: number, vertical: number) => {
    const step = canvas.getBoundingClientRect().height * PAN_VIEW_FRACTION;
    panPixels(horizontal * step, vertical * step);
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
    event.preventDefault();
    const scale = wheelPixelScale(event, canvas.clientHeight);
    if (panMode && !event.ctrlKey)
      panPixels(event.deltaX * scale, event.deltaY * scale);
    else
      setViewHeight(
        viewHeight * Math.exp(event.deltaY * scale * ZOOM_SENSITIVITY),
      );
  };
  const document = canvas.ownerDocument;
  const host = document?.defaultView;
  const ownsKeyboard = () =>
    document?.activeElement === canvas && worldInputAvailable(document);
  const clearKeys = () => {
    panKeys.clear();
    if (!spaceHeld) return;
    spaceHeld = false;
    panChanged();
  };
  const keyDown = (event: KeyboardEvent) => {
    if (
      event.defaultPrevented ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey
    )
      return;
    if (
      event.key === "Escape" &&
      primaryPanActive() &&
      worldInputAvailable(document) &&
      !isTextEntry(document?.activeElement)
    ) {
      clearKeys();
      setPanMode(false);
      event.stopImmediatePropagation();
      event.preventDefault();
      return;
    }
    if (!ownsKeyboard()) return;
    if (event.code === "Space") {
      if (!spaceHeld) {
        spaceHeld = true;
        panChanged();
      }
    } else if (PAN_KEYS[event.key]) {
      glide = undefined;
      panKeys.add(event.key);
    } else return;
    event.preventDefault();
  };
  const keyUp = (event: KeyboardEvent) => {
    if (event.code === "Space" && spaceHeld) {
      spaceHeld = false;
      panChanged();
    } else if (!panKeys.delete(event.key)) return;
    event.preventDefault();
  };
  const edgePan = createEdgePan(canvas);
  const advanceNavigation = () => {
    const seconds = Math.min(0.1, scene.getEngine().getDeltaTime() / 1000);
    if (!ownsKeyboard()) clearKeys();
    let horizontal = 0;
    let vertical = 0;
    for (const key of panKeys) {
      horizontal += PAN_KEYS[key][0];
      vertical += PAN_KEYS[key][1];
    }
    // Keyboard direction takes precedence over an unattended cursor.
    const edge = edgePan.advance(seconds);
    if (panKeys.size === 0 && edge) [horizontal, vertical] = edge;
    const length = Math.hypot(horizontal, vertical);
    if (length === 0) return;
    // A delayed frame must not fling the camera across the map.
    const step = (seconds * CONTINUOUS_PAN_SPEED) / length;
    panView(horizontal * step, vertical * step);
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
  const listeners = new AbortController();
  const { signal } = listeners;
  canvas.addEventListener("wheel", zoom, { passive: false, signal });
  // Capture lets Escape leave Pan mode before world tools see it.
  host?.addEventListener("keydown", keyDown, { capture: true, signal });
  host?.addEventListener("keyup", keyUp, { signal });
  host?.addEventListener("blur", clearKeys, { signal });
  canvas.addEventListener("blur", clearKeys, { signal });
  document?.addEventListener?.("visibilitychange", clearKeys, { signal });
  scene.onDisposeObservable.add(() => {
    listeners.abort();
    pointer.dispose();
    edgePan.dispose();
    canvas.removeAttribute?.("data-camera-pan-active");
    canvas.removeAttribute?.("data-camera-dragging");
    onPanChangedObservable.clear();
  });
  scene.onBeforeRenderObservable.add(syncToCanvas);
  scene.onBeforeRenderObservable.add(advanceNavigation);
  scene.onBeforeRenderObservable.add(advanceGlide);

  return {
    resetView,
    panView,
    get panMode() {
      return panMode;
    },
    get primaryPanActive() {
      return primaryPanActive();
    },
    onPanChangedObservable,
    setPanMode,
    get edgePanEnabled() {
      return edgePan.enabled;
    },
    setEdgePanEnabled: edgePan.setEnabled,
    rotateView: (radians) => {
      camera.alpha += radians;
    },
    tiltView: (radians) => setBeta(camera.beta + radians),
    zoomBy: (factor) => setViewHeight(viewHeight * factor),
    setFocusLimit: (limit) => {
      limitFocus = limit;
      moveTo(camera.target.clone());
    },
    setTouchPanFilter: (canPan) => {
      pointer.cancel();
      canTouchPan = canPan;
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

/** Pixels per wheel delta unit; Firefox mice report lines. */
function wheelPixelScale(event: WheelEvent, pageHeight: number): number {
  switch (event.deltaMode) {
    case WheelEvent.DOM_DELTA_LINE:
      return WHEEL_LINE_PIXELS;
    case WheelEvent.DOM_DELTA_PAGE:
      return pageHeight;
    default:
      return 1;
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
