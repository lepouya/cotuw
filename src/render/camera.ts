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
const INITIAL_ALPHA = -Math.PI / 4;
const INITIAL_BETA = Math.PI / 3.2;
const LOWER_BETA_LIMIT = Math.PI / 7;
const UPPER_BETA_LIMIT = Math.PI / 2.15;
/** Extra depth range beyond twice the camera distance. */
const FAR_CLIP_MARGIN = 100;

export type StrategyCamera = {
  /** Frames the starting view: centered, and close enough to read one tile. */
  resetView: () => void;
  /** Positions the camera so the whole map is visible. */
  fitToMap: () => void;
  /** Moves the view target to the center of a tile without changing the zoom. */
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
  // Dragging the map should stick to the pointer, so panning glides nowhere
  // after release and its sensibility below is exact.
  camera.panningInertia = 0;
  camera.attachControl(canvas, true);
  // Left-drag pans the map and right-drag swings the view angle, the way
  // strategy players expect; Babylon ships with those two the other way round.
  camera.movement.input.setInteractions("pointer", { button: 0 }, "pan");
  camera.movement.input.setInteractions("pointer", { button: 2 }, "rotate");

  let viewHeight = INITIAL_VIEW_TILES * map.tileSize;
  const syncViewBounds = () => {
    syncOrthographicBounds(camera, canvas, viewHeight);
    // Panning moves the target in world units, so its sensibility has to track
    // the zoom for a drag to keep carrying the ground along with the pointer.
    camera.panningSensibility = Math.max(canvas.clientHeight, 1) / viewHeight;
  };
  const setViewHeight = (height: number) => {
    // Zooming out stops once the whole map is framed; zooming in stops a
    // couple of tiles short of the ground, where tile detail reads clearly.
    const minimumViewHeight = MINIMUM_VIEW_TILES * map.tileSize;
    const maximumViewHeight = Math.max(
      viewHeightToFitMap(camera, canvas, map),
      minimumViewHeight,
    );
    viewHeight = Math.min(
      Math.max(height, minimumViewHeight),
      maximumViewHeight,
    );
    syncViewBounds();
  };
  const setDistance = (distance: number) => {
    const safeDistance = Math.max(distance, MINIMUM_CAMERA_DISTANCE);
    camera.lowerRadiusLimit = safeDistance;
    camera.upperRadiusLimit = safeDistance;
    camera.radius = safeDistance;
    camera.maxZ = safeDistance * 2 + FAR_CLIP_MARGIN;
  };
  /**
   * Retargets without letting Babylon re-derive alpha, beta and radius from the
   * unchanged camera position, which would tilt the fixed isometric view.
   */
  const retarget = (target: Vector3) =>
    camera.setTarget(target, false, false, true);
  const fitToMap = () => {
    retarget(Vector3.Zero());
    setDistance(cameraDistanceForMap(map));
    setViewHeight(viewHeightToFitMap(camera, canvas, map));
  };
  /** Small maps get fitted instead, so the start never overshoots the map. */
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
    setViewHeight(viewHeight * Math.exp(event.deltaY * ZOOM_SENSITIVITY));
    event.preventDefault();
  };
  /** Keeps the player's zoom, only re-clamping it against the new viewport. */
  const handleResize = () => setViewHeight(viewHeight);
  canvas.addEventListener("wheel", zoom, { passive: false });
  window.addEventListener("resize", handleResize);
  scene.onDisposeObservable.add(() => {
    canvas.removeEventListener("wheel", zoom);
    window.removeEventListener("resize", handleResize);
  });
  scene.onBeforeRenderObservable.add(syncViewBounds);

  return { resetView, fitToMap, focusOnTile };
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

function aspectRatioOf(canvas: HTMLCanvasElement): number {
  return Math.max(canvas.clientWidth / canvas.clientHeight, 0.01);
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
