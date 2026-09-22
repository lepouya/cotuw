import { Vector3 } from "@babylonjs/core";

import { layerSlot } from "../map";
import { terrainTextureSource } from "./terrain-mesh";

import type { Scene } from "@babylonjs/core";
import type { TerrainBounds, TerrainMap } from "../map";
import type { StrategyCamera } from "./camera";

type Rgb = [number, number, number];
type ScreenPoint = { x: number; y: number };

/** Shows through wherever the map doesn't reach, like unlayered ground. */
const BACKGROUND: Rgb = [0.02, 0.043, 0.051];
const OUTLINE_COLOR = "rgb(242 199 89)";
/** Outline stroke width, in CSS pixels. */
const OUTLINE_WIDTH = 1.5;
/** Extra hit area around the thin viewport outline, in CSS pixels. */
const OUTLINE_GRAB_RADIUS = OUTLINE_WIDTH / 2 + 4;
/** The heading wedge's length and half-width, in CSS pixels. */
const HEADING_LENGTH = 6;
const HEADING_HALF_WIDTH = 4;
/** Breathing room beyond the map edge so it doesn't touch the frame. */
const MAP_FIT_MARGIN = 1.08;
/** CSS pixels a press may wander and still count as a click. */
const DRAG_THRESHOLD = 4;
/** Brightness change per unit of slope, lit from the northwest. */
const HILLSHADE_STRENGTH = 1.2;
const HILLSHADE_LIMIT = 0.3;

export type Minimap = {
  dispose: () => void;
};

/**
 * A north-up 2D map in its own canvas: terrain baked to one pixel per tile,
 * with the main camera's footprint drawn over it. Pressing glides the camera
 * there; dragging the footprint pans it.
 */
export function createMinimap(
  scene: Scene,
  map: TerrainMap,
  camera: StrategyCamera,
  canvas: HTMLCanvasElement,
): Minimap {
  const context = canvas.getContext("2d");
  const terrain = document.createElement("canvas");
  terrain.width = map.width;
  terrain.height = map.height;
  const terrainContext = terrain.getContext("2d");
  if (!context || !terrainContext) {
    throw new Error("The minimap requires a 2D canvas context.");
  }

  let needsDraw = true;
  const terrainPixels = terrainContext.createImageData(map.width, map.height);
  const paint = (bounds: TerrainBounds) => {
    paintTerrain(map, terrainPixels.data, bounds);
    terrainContext.putImageData(
      terrainPixels,
      0,
      0,
      bounds.minX,
      map.height - 1 - bounds.maxZ,
      bounds.maxX - bounds.minX + 1,
      bounds.maxZ - bounds.minZ + 1,
    );
    needsDraw = true;
  };
  paint({ minX: 0, minZ: 0, maxX: map.width - 1, maxZ: map.height - 1 });
  const changeObserver = map.onChangedObservable.add(paint);

  let projection = minimapProjection(map, 0, 0);
  const resize = () => {
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(canvas.clientWidth * ratio);
    canvas.height = Math.round(canvas.clientHeight * ratio);
    projection = minimapProjection(
      map,
      canvas.clientWidth,
      canvas.clientHeight,
    );
    needsDraw = true;
  };
  resize();
  // Window resizes also carry pixel-ratio changes between displays.
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);
  window.addEventListener("resize", resize);

  let outline: ScreenPoint[] = [];
  // Runs after each main render, so the outline matches the frame on screen.
  const draw = () => {
    const footprint = camera.viewFootprint().map(projection.toMinimap);
    if (!needsDraw && samePoints(footprint, outline)) {
      return;
    }
    needsDraw = false;
    outline = footprint;

    const ratio = canvas.width / Math.max(canvas.clientWidth, 1);
    const { mapRect } = projection;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.fillStyle = cssColor(BACKGROUND);
    context.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    // The source has exactly one terrain color per tile. Keep those cells
    // legible instead of blending neighboring terrain while scaling.
    context.imageSmoothingEnabled = false;
    context.drawImage(
      terrain,
      mapRect.x,
      mapRect.y,
      mapRect.width,
      mapRect.height,
    );
    drawFootprint(context, footprint);
  };
  const renderObserver = scene.onAfterRenderObservable.add(draw);

  let drag:
    | {
        pointerId: number;
        start: ScreenPoint;
        /** Whether the press landed on the footprint outline. */
        grabbed: boolean;
        /** From the pressed world point to the view center. */
        offset: Vector3;
        /** Whether the pointer has left the click threshold. */
        moved: boolean;
      }
    | undefined;
  const localPoint = (event: PointerEvent): ScreenPoint => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left - canvas.clientLeft,
      y: event.clientY - rect.top - canvas.clientTop,
    };
  };
  const glideTo = (point: ScreenPoint) =>
    camera.glideToPoint(clampToMap(projection.toWorld(point), map));
  const handlePointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || drag) {
      return;
    }
    event.preventDefault();
    // Keeps move/up coming here even once the pointer leaves the minimap.
    canvas.setPointerCapture(event.pointerId);

    const point = localPoint(event);
    const grabbed = pointNearPolygon(point, outline, OUTLINE_GRAB_RADIUS);
    drag = {
      pointerId: event.pointerId,
      start: point,
      grabbed,
      offset: centroid(camera.viewFootprint()).subtract(
        projection.toWorld(point),
      ),
      moved: false,
    };
    if (grabbed) {
      canvas.style.cursor = "grabbing";
    } else {
      // Answers the press at once; a drag that follows then takes over.
      glideTo(point);
    }
  };
  const handlePointerMove = (event: PointerEvent) => {
    const point = localPoint(event);
    if (drag?.pointerId !== event.pointerId) {
      canvas.style.cursor = pointNearPolygon(
        point,
        outline,
        OUTLINE_GRAB_RADIUS,
      )
        ? "grab"
        : "";
      return;
    }

    drag.moved ||=
      Math.hypot(point.x - drag.start.x, point.y - drag.start.y) >=
      DRAG_THRESHOLD;
    if (drag.grabbed) {
      // The grip point stays under the pointer, however far it strays.
      camera.focusOnPoint(
        clampToMap(projection.toWorld(point).add(drag.offset), map),
      );
    } else if (drag.moved) {
      camera.focusOnPoint(clampToMap(projection.toWorld(point), map));
    }
  };
  const handlePointerUp = (event: PointerEvent) => {
    if (drag?.pointerId !== event.pointerId) {
      return;
    }
    // A click inside the outline still centers there, like anywhere else.
    if (drag.grabbed && !drag.moved) {
      glideTo(drag.start);
    }
    endDrag(event);
  };
  const endDrag = (event: PointerEvent) => {
    if (drag?.pointerId === event.pointerId) {
      drag = undefined;
      canvas.style.cursor = "";
    }
  };
  // Right-press is reserved for minimap commands later.
  const suppressContextMenu = (event: Event) => event.preventDefault();
  canvas.addEventListener("pointerdown", handlePointerDown);
  canvas.addEventListener("pointermove", handlePointerMove);
  canvas.addEventListener("pointerup", handlePointerUp);
  canvas.addEventListener("pointercancel", endDrag);
  canvas.addEventListener("contextmenu", suppressContextMenu);

  let disposed = false;
  const dispose = () => {
    if (disposed) {
      return;
    }
    disposed = true;

    map.onChangedObservable.remove(changeObserver);
    scene.onAfterRenderObservable.remove(renderObserver);
    scene.onDisposeObservable.remove(sceneDisposeObserver);
    resizeObserver.disconnect();
    window.removeEventListener("resize", resize);
    canvas.removeEventListener("pointerdown", handlePointerDown);
    canvas.removeEventListener("pointermove", handlePointerMove);
    canvas.removeEventListener("pointerup", handlePointerUp);
    canvas.removeEventListener("pointercancel", endDrag);
    canvas.removeEventListener("contextmenu", suppressContextMenu);
  };
  const sceneDisposeObserver = scene.onDisposeObservable.add(dispose);

  return { dispose };
}

/** Maps between world ground points and minimap CSS pixels, north up. */
export type MinimapProjection = {
  toMinimap: (point: { x: number; z: number }) => ScreenPoint;
  toWorld: (point: ScreenPoint) => Vector3;
  /** Where the whole map sits on the minimap. */
  mapRect: { x: number; y: number; width: number; height: number };
};

export function minimapProjection(
  map: TerrainMap,
  width: number,
  height: number,
): MinimapProjection {
  const worldWidth = map.width * map.tileSize;
  const worldHeight = map.height * map.tileSize;
  // Kept positive so a hidden minimap cannot divide by zero.
  const scale =
    Math.max(Math.min(width / worldWidth, height / worldHeight), 1e-6) /
    MAP_FIT_MARGIN;
  const centerX = width / 2;
  const centerY = height / 2;

  return {
    // Screen y grows downward while north (+z) is up.
    toMinimap: ({ x, z }) => ({
      x: centerX + x * scale,
      y: centerY - z * scale,
    }),
    toWorld: ({ x, y }) =>
      new Vector3((x - centerX) / scale, 0, (centerY - y) / scale),
    mapRect: {
      x: centerX - (worldWidth * scale) / 2,
      y: centerY - (worldHeight * scale) / 2,
      width: worldWidth * scale,
      height: worldHeight * scale,
    },
  };
}

/** Pulls a world point onto the map, so the view never centers off it. */
export function clampToMap(point: Vector3, map: TerrainMap): Vector3 {
  const halfWidth = (map.width * map.tileSize) / 2;
  const halfHeight = (map.height * map.tileSize) / 2;
  return new Vector3(
    Math.min(Math.max(point.x, -halfWidth), halfWidth),
    0,
    Math.min(Math.max(point.z, -halfHeight), halfHeight),
  );
}

/** Writes an opaque RGBA pixel per tile in `bounds`, north row first. */
export function paintTerrain(
  map: TerrainMap,
  pixels: Uint8ClampedArray,
  bounds: TerrainBounds,
): void {
  for (let z = bounds.minZ; z <= bounds.maxZ; z += 1) {
    for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
      const [red, green, blue] = tileColor(map, x, z);
      const offset = ((map.height - 1 - z) * map.width + x) * 4;
      pixels[offset] = red * 255;
      pixels[offset + 1] = green * 255;
      pixels[offset + 2] = blue * 255;
      pixels[offset + 3] = 255;
    }
  }
}

/** A tile's layers composited in slot order, then hillshaded. */
export function tileColor(map: TerrainMap, x: number, z: number): Rgb {
  const color: Rgb = [...BACKGROUND];
  const layers = map
    .layersAt(x, z)
    .map((layer, index) => ({ layer, slot: layerSlot(layer, index) }))
    .sort((a, b) => a.slot - b.slot);

  for (const { layer } of layers) {
    const [red, green, blue, coverage] = layer.texture
      ? terrainTextureSource(layer.texture).minimapColor
      : [1, 1, 1, 1];
    const tint: Rgb = [
      red * layer.color.r,
      green * layer.color.g,
      blue * layer.color.b,
    ];
    const alpha = coverage * layer.color.a;
    for (let channel = 0; channel < 3; channel += 1) {
      color[channel] += (tint[channel] - color[channel]) * alpha;
    }
  }

  const shade = hillshade(map, x, z);
  return color.map((channel) => Math.min(channel * shade, 1)) as Rgb;
}

/** Brightens slopes that face the northwest and darkens those facing away. */
function hillshade(map: TerrainMap, x: number, z: number): number {
  const southWest = map.heightAt(x, z);
  const southEast = map.heightAt(x + 1, z);
  const northWest = map.heightAt(x, z + 1);
  const northEast = map.heightAt(x + 1, z + 1);
  const riseEast = (southEast + northEast - southWest - northWest) / 2;
  const riseNorth = (northWest + northEast - southWest - southEast) / 2;
  // A slope rising eastward faces west, towards the light; northward, away.
  const lit =
    ((riseEast - riseNorth) / Math.SQRT2 / map.tileSize) * HILLSHADE_STRENGTH;
  return 1 + Math.min(Math.max(lit, -HILLSHADE_LIMIT), HILLSHADE_LIMIT);
}

/** Whether a point lies within `radius` CSS pixels of a polygon's outline. */
export function pointNearPolygon(
  point: ScreenPoint,
  polygon: ScreenPoint[],
  radius: number,
): boolean {
  return polygon.some((start, index) => {
    const end = polygon[(index + 1) % polygon.length];
    return distanceToSegment(point, start, end) <= radius;
  });
}

function distanceToSegment(
  point: ScreenPoint,
  start: ScreenPoint,
  end: ScreenPoint,
): number {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const lengthSquared = deltaX ** 2 + deltaY ** 2;
  if (lengthSquared === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }

  const progress = Math.min(
    Math.max(
      ((point.x - start.x) * deltaX + (point.y - start.y) * deltaY) /
        lengthSquared,
      0,
    ),
    1,
  );
  return Math.hypot(
    point.x - (start.x + deltaX * progress),
    point.y - (start.y + deltaY * progress),
  );
}

/**
 * Strokes the camera footprint, then marks its far edge with a wedge so the
 * view direction reads at a glance.
 */
function drawFootprint(
  context: CanvasRenderingContext2D,
  footprint: ScreenPoint[],
): void {
  context.strokeStyle = OUTLINE_COLOR;
  context.fillStyle = OUTLINE_COLOR;
  context.lineWidth = OUTLINE_WIDTH;
  context.lineJoin = "round";
  context.beginPath();
  for (const { x, y } of footprint) {
    context.lineTo(x, y);
  }
  context.closePath();
  context.stroke();

  const [bottomLeft, bottomRight, topRight, topLeft] = footprint;
  const front = midpoint(topRight, topLeft);
  const back = midpoint(bottomLeft, bottomRight);
  const length = Math.hypot(front.x - back.x, front.y - back.y);
  if (length === 0) {
    return;
  }

  const forward = {
    x: (front.x - back.x) / length,
    y: (front.y - back.y) / length,
  };
  const side = {
    x: -forward.y * HEADING_HALF_WIDTH,
    y: forward.x * HEADING_HALF_WIDTH,
  };
  context.beginPath();
  context.moveTo(front.x + side.x, front.y + side.y);
  context.lineTo(
    front.x + forward.x * HEADING_LENGTH,
    front.y + forward.y * HEADING_LENGTH,
  );
  context.lineTo(front.x - side.x, front.y - side.y);
  context.closePath();
  context.fill();
}

function midpoint(a: ScreenPoint, b: ScreenPoint): ScreenPoint {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function centroid(points: Vector3[]): Vector3 {
  return points
    .reduce((sum, point) => sum.addInPlace(point), Vector3.Zero())
    .scaleInPlace(1 / points.length);
}

function samePoints(a: ScreenPoint[], b: ScreenPoint[]): boolean {
  return (
    a.length === b.length &&
    a.every((point, index) => point.x === b[index].x && point.y === b[index].y)
  );
}

function cssColor([red, green, blue]: Rgb): string {
  return `rgb(${red * 255} ${green * 255} ${blue * 255})`;
}
