import { ArcRotateCamera, Camera, Scene, Vector3 } from "@babylonjs/core";
import type { TerrainMap } from "../map";
import { cornerPoint } from "./world";

const INITIAL_VIEW_FILL = 0.76;
const MINIMUM_CAMERA_DISTANCE = 160;
const MINIMUM_VIEW_HEIGHT = 12;
/** The furthest zoom-out, as a multiple of the map's longest side. */
const MAXIMUM_VIEW_HEIGHT_RATIO = 2;
const DEFAULT_VIEW_HEIGHT = 120;
const ZOOM_SENSITIVITY = 0.001;
const PANNING_SENSIBILITY = 45;
const INITIAL_ALPHA = -Math.PI / 4;
const INITIAL_BETA = Math.PI / 3.2;
const LOWER_BETA_LIMIT = Math.PI / 7;
const UPPER_BETA_LIMIT = Math.PI / 2.15;
/** Extra depth range beyond twice the camera distance. */
const FAR_CLIP_MARGIN = 100;

export type StrategyCamera = {
  /** Positions the camera so the whole map is visible. */
  fitToMap: () => void;
  /** Extends the clipping range after a terrain-height edit. */
  updateClipRange: () => void;
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
  camera.panningSensibility = PANNING_SENSIBILITY;
  camera.attachControl(canvas, true);

  let viewHeight = DEFAULT_VIEW_HEIGHT;
  const syncViewBounds = () =>
    syncOrthographicBounds(camera, canvas, viewHeight);
  const setViewHeight = (height: number) => {
    const mapFitHeight = viewHeightToFitMap(camera, canvas, map);
    const maximumViewHeight = Math.max(
      mapFitHeight,
      map.tileSize *
        Math.max(map.width, map.height) *
        MAXIMUM_VIEW_HEIGHT_RATIO,
    );
    viewHeight = Math.min(
      Math.max(height, MINIMUM_VIEW_HEIGHT),
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
  const fitToMap = () => {
    setDistance(cameraDistanceForMap(map));
    setViewHeight(viewHeightToFitMap(camera, canvas, map));
  };

  const zoom = (event: WheelEvent) => {
    setViewHeight(viewHeight * Math.exp(event.deltaY * ZOOM_SENSITIVITY));
    event.preventDefault();
  };
  canvas.addEventListener("wheel", zoom, { passive: false });
  window.addEventListener("resize", fitToMap);
  scene.onDisposeObservable.add(() => {
    canvas.removeEventListener("wheel", zoom);
    window.removeEventListener("resize", fitToMap);
  });
  scene.onBeforeRenderObservable.add(syncViewBounds);

  return {
    fitToMap,
    updateClipRange: () => {
      camera.maxZ = Math.max(
        camera.maxZ,
        cameraDistanceForMap(map) * 2 + FAR_CLIP_MARGIN,
      );
    },
  };
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

  for (let z = 0; z <= map.height; z += 1) {
    for (let x = 0; x <= map.width; x += 1) {
      const viewPoint = Vector3.TransformCoordinates(
        cornerPoint(map, x, z),
        viewMatrix,
      );

      minX = Math.min(minX, viewPoint.x);
      maxX = Math.max(maxX, viewPoint.x);
      minY = Math.min(minY, viewPoint.y);
      maxY = Math.max(maxY, viewPoint.y);
    }
  }

  const requiredViewHeight = Math.max(maxY - minY, (maxX - minX) / aspectRatio);
  return requiredViewHeight / INITIAL_VIEW_FILL;
}

function cameraDistanceForMap(map: TerrainMap): number {
  let lowestHeight = Number.POSITIVE_INFINITY;
  let highestHeight = Number.NEGATIVE_INFINITY;

  for (let z = 0; z <= map.height; z += 1) {
    for (let x = 0; x <= map.width; x += 1) {
      const height = map.getCorner(x, z);
      lowestHeight = Math.min(lowestHeight, height);
      highestHeight = Math.max(highestHeight, height);
    }
  }

  const mapDiagonal = Math.hypot(
    map.width * map.tileSize,
    map.height * map.tileSize,
  );
  return Math.max(
    mapDiagonal + highestHeight - lowestHeight,
    MINIMUM_CAMERA_DISTANCE,
  );
}
