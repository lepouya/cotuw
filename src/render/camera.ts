import { ArcRotateCamera, Camera, Scene, Vector3 } from "@babylonjs/core";

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
/** Extra depth range beyond twice the camera distance. */
const FAR_CLIP_MARGIN = 100;

export type StrategyCamera = {
  /** Frames the starting view: centered, close enough to read one tile. */
  resetView: () => void;
  fitToMap: () => void;
  /** Centers the view on a tile without changing the zoom. */
  focusOnTile: (x: number, z: number) => void;
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
  camera.minZ = 0.01;
  camera.maxZ = 500;
  // Panning must stick to the pointer, so it cannot glide after release.
  camera.panningInertia = 0;
  camera.attachControl(canvas, true);
  // Strategy convention: left-drag pans, right-drag orbits. Babylon's
  // defaults are the other way round.
  camera.movement.input.setInteractions("pointer", { button: 0 }, "pan");
  camera.movement.input.setInteractions("pointer", { button: 2 }, "rotate");

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
  // Babylon would otherwise re-derive alpha, beta and radius from the
  // unchanged position and tilt the fixed isometric view.
  const retarget = (target: Vector3) =>
    camera.setTarget(target, false, false, true);
  const fitToMap = () => {
    retarget(Vector3.Zero());
    setDistance(cameraDistanceForMap(map));
    setViewHeight(viewHeightToFitMap(camera, canvas, map));
  };
  // Small maps get fitted instead, so the start never overshoots the map.
  const resetView = () => {
    retarget(Vector3.Zero());
    setDistance(cameraDistanceForMap(map));
    setViewHeight(
      Math.min(
        INITIAL_VIEW_TILES * map.tileSize,
        viewHeightToFitMap(camera, canvas, map),
      ),
    );
  };
  const focusOnTile = (x: number, z: number) => {
    retarget(map.worldPoint(x + 0.5, z + 0.5, 0));
  };

  const zoom = (event: WheelEvent) => {
    const pixels = wheelDeltaPixels(event, canvas.clientHeight);
    setViewHeight(viewHeight * Math.exp(pixels * ZOOM_SENSITIVITY));
    event.preventDefault();
  };
  // Keeps the player's zoom, re-clamped to the new viewport.
  const handleResize = () => setViewHeight(viewHeight);
  canvas.addEventListener("wheel", zoom, { passive: false });
  // Observing the canvas catches layout-driven resizes that skip the window.
  const resizeObserver = new ResizeObserver(handleResize);
  resizeObserver.observe(canvas);
  scene.onDisposeObservable.add(() => {
    canvas.removeEventListener("wheel", zoom);
    resizeObserver.disconnect();
  });
  scene.onBeforeRenderObservable.add(syncViewBounds);

  return { resetView, fitToMap, focusOnTile };
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
