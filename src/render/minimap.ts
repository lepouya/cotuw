import { Vector3 } from "@babylonjs/core";

import { layerSlot } from "../map";
import { DEFAULT_ACTOR_COLOR } from "./actor";
import { watchCanvasSize } from "./canvas-size";
import { createPointerGesture } from "./pointer-gesture";
import { worldInputAvailable } from "./input-focus";
import { fogAlpha } from "./fog";
import type { Rgb } from "./color";
export type { Rgb } from "./color";

import type { Scene } from "@babylonjs/core";
import type { TerrainBounds, TerrainMap, TileCoord } from "../map";
import type { StrategyCamera } from "./camera";
import type { FogView } from "../simulation/vision";

type ScreenPoint = { x: number; y: number };

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
/** Brightness change per unit of slope, lit from the northwest. */
const HILLSHADE_STRENGTH = 1.2;
const HILLSHADE_LIMIT = 0.3;
const SELECTED_ACTOR_COLOR = "rgb(255 220 112)";
/** Selected marker outline width, in CSS pixels. */
const SELECTED_ACTOR_OUTLINE_WIDTH = 1.5;
/** Marker radius in CSS pixels. */
const ACTOR_RADIUS = 3;
const PING_COLOR = "rgb(255 96 72)";
const PING_SECONDS = 2.4;
/** One expanding ring lasts this long; a ping repeats it. */
const PING_RING_SECONDS = 0.8;
/** The ring's largest radius, in CSS pixels. */
const PING_RADIUS = 14;

export type Minimap = {
  /** Re-reads `actors` before the next redraw. Call it when they change. */
  refreshActors: () => void;
  /** Pulses a ring at a world point to draw attention to it. */
  ping: (point: { x: number; z: number }) => void;
  dispose: () => void;
};

/** Render-only information for an actor shown on the minimap. */
export type MinimapActor = {
  id: string;
  worldPosition: { x: number; z: number };
  /** Draws these tiles instead of a marker, as for a tile-placed actor. */
  tiles?: readonly TileCoord[];
  /** Renderer-facing marker color, independent of simulation state. */
  color?: Rgb;
  selected?: boolean;
};

export type MinimapOptions = {
  /** Read on creation, on resize, and after each `refreshActors` call. */
  actors?: () => readonly MinimapActor[];
  /** Read every frame; terrain repaints when its version changes. */
  fog?: () => FogView | undefined;
  /** While true, presses offer their ground point to `onCommand` first. */
  commandMode?: () => boolean;
  /** Returns whether it used the point; otherwise the camera navigates. */
  onCommand?: (target: { x: number; z: number }, shiftKey: boolean) => boolean;
  /** Draws pings as steady rings instead of expanding ones. */
  reducedMotion?: () => boolean;
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
  {
    actors = () => [],
    fog = () => undefined,
    commandMode = () => false,
    onCommand,
    reducedMotion = () => false,
  }: MinimapOptions = {},
): Minimap {
  const context = canvas.getContext("2d");
  const terrain = document.createElement("canvas");
  terrain.width = map.width;
  terrain.height = map.height;
  const terrainContext = terrain.getContext("2d");
  if (!context || !terrainContext) {
    throw new Error("The minimap requires a 2D canvas context.");
  }

  // Shows around the map and through unlayered ground, as in the main view.
  const { r, g, b } = scene.clearColor;
  const background: Rgb = [r, g, b];
  let needsDraw = true;
  const terrainPixels = terrainContext.createImageData(map.width, map.height);
  const shownPixels = terrainContext.createImageData(map.width, map.height);
  let fogVersion: number | undefined;
  const shade = () => {
    const current = fog();
    fogVersion = current?.version;
    shadeFog(map, terrainPixels.data, shownPixels.data, current, background);
    terrainContext.putImageData(shownPixels, 0, 0);
    needsDraw = true;
  };
  const paint = (bounds: TerrainBounds) => {
    paintTerrain(map, terrainPixels.data, bounds, background);
    shade();
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
  const canvasSize = watchCanvasSize(canvas);

  let outline: ScreenPoint[] = [];
  let actorMarkers: ActorMarker[] = [];
  let pings: { point: { x: number; z: number }; start: number }[] = [];
  // Runs after each main render, so the outline matches the frame on screen.
  // Actors change at the simulation's pace, not every frame.
  let actorsStale = true;
  const draw = () => {
    if (canvasSize.takeChange()) {
      resize();
      actorsStale = true;
    }
    if (fog()?.version !== fogVersion) shade();
    if (actorsStale) {
      actorsStale = false;
      const nextActorMarkers = actors().map(
        ({
          id,
          worldPosition,
          tiles,
          color = DEFAULT_ACTOR_COLOR,
          selected,
        }) => ({
          id,
          point: projection.toMinimap(worldPosition),
          tiles: tiles?.map(({ x, z }) =>
            [
              map.worldPoint(x, z, 0),
              map.worldPoint(x + 1, z, 0),
              map.worldPoint(x + 1, z + 1, 0),
              map.worldPoint(x, z + 1, 0),
            ].map(projection.toMinimap),
          ),
          color: [...color] as Rgb,
          selected: selected ?? false,
        }),
      );
      if (!sameActorMarkers(nextActorMarkers, actorMarkers)) {
        actorMarkers = nextActorMarkers;
        needsDraw = true;
      }
    }
    const now = performance.now();
    pings = pings.filter(({ start }) => now - start < PING_SECONDS * 1000);
    const footprint = camera.viewFootprint().map(projection.toMinimap);
    if (!needsDraw && !pings.length && samePoints(footprint, outline)) {
      return;
    }
    needsDraw = false;
    outline = footprint;

    const ratio = canvas.width / Math.max(canvas.clientWidth, 1);
    const { mapRect } = projection;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.fillStyle = cssColor(background);
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
    drawActors(context, actorMarkers);
    drawFootprint(context, footprint);
    const steady = reducedMotion();
    context.lineWidth = 2;
    context.strokeStyle = PING_COLOR;
    for (const { point, start } of pings) {
      const { x, y } = projection.toMinimap(point);
      const ring = steady
        ? 1
        : (((now - start) / 1000) % PING_RING_SECONDS) / PING_RING_SECONDS;
      context.beginPath();
      context.arc(x, y, ACTOR_RADIUS + ring * PING_RADIUS, 0, Math.PI * 2);
      context.globalAlpha = steady ? 1 : 1 - ring;
      context.stroke();
    }
    context.globalAlpha = 1;
    // Clears the last ring once every ping has ended.
    if (pings.length) needsDraw = true;
  };
  const renderObserver = scene.onAfterRenderObservable.add(draw);

  const localPoint = (event: PointerEvent): ScreenPoint => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left - canvas.clientLeft,
      y: event.clientY - rect.top - canvas.clientTop,
    };
  };
  const glideTo = (point: ScreenPoint) =>
    camera.glideToPoint(clampToMap(projection.toWorld(point), map));
  const pointer = createPointerGesture(canvas, {
    enabled: () => worldInputAvailable(canvas.ownerDocument),
    start: (event) => {
      if (event.button !== 0) return undefined;
      event.preventDefault();
      const point = localPoint(event);
      const command = commandMode();
      const grabbed = pointNearPolygon(point, outline, OUTLINE_GRAB_RADIUS);
      if (grabbed) canvas.style.cursor = "grabbing";
      else if (!command) glideTo(point);
      return {
        point,
        command,
        shiftKey: event.shiftKey,
        grabbed,
        offset: centroid(camera.viewFootprint()).subtract(
          projection.toWorld(point),
        ),
      };
    },
    move: (event, { data }) => {
      const point = projection.toWorld(localPoint(event));
      camera.focusOnPoint(
        clampToMap(data.grabbed ? point.add(data.offset) : point, map),
      );
    },
    end: (event, { data, dragged }) => {
      if (dragged) return;
      if (data.command && commandMode()) {
        const point = clampToMap(projection.toWorld(localPoint(event)), map);
        if (onCommand?.({ x: point.x, z: point.z }, data.shiftKey)) return;
      }
      if (data.grabbed || data.command) glideTo(data.point);
    },
    release: () => {
      canvas.style.cursor = "";
    },
  });
  const hover = (event: PointerEvent) => {
    if (event.buttons) return;
    canvas.style.cursor = pointNearPolygon(
      localPoint(event),
      outline,
      OUTLINE_GRAB_RADIUS,
    )
      ? "grab"
      : "";
  };
  // Right-press is reserved for minimap commands later.
  const suppressContextMenu = (event: Event) => event.preventDefault();
  canvas.addEventListener("pointermove", hover);
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
    canvasSize.dispose();
    pointer.dispose();
    canvas.removeEventListener("pointermove", hover);
    canvas.removeEventListener("contextmenu", suppressContextMenu);
  };
  const sceneDisposeObserver = scene.onDisposeObservable.add(dispose);

  return {
    refreshActors: () => {
      actorsStale = true;
    },
    ping: (point) => {
      pings.push({ point: { ...point }, start: performance.now() });
    },
    dispose,
  };
}

type ActorMarker = {
  id: string;
  point: ScreenPoint;
  /** Outlines of tiles to fill in place of the round marker. */
  tiles?: ScreenPoint[][];
  color: Rgb;
  selected: boolean;
};

function drawActors(context: CanvasRenderingContext2D, actors: ActorMarker[]) {
  for (const { point, tiles, color, selected } of actors) {
    context.beginPath();
    if (tiles) {
      for (const [first, ...rest] of tiles) {
        context.moveTo(first!.x, first!.y);
        for (const corner of rest) context.lineTo(corner.x, corner.y);
        context.closePath();
      }
    } else {
      context.arc(point.x, point.y, ACTOR_RADIUS, 0, Math.PI * 2);
    }
    context.fillStyle = cssColor(color);
    context.fill();
    if (selected) {
      context.lineWidth = SELECTED_ACTOR_OUTLINE_WIDTH;
      context.strokeStyle = SELECTED_ACTOR_COLOR;
      context.stroke();
    }
  }
}

function sameActorMarkers(left: ActorMarker[], right: ActorMarker[]): boolean {
  return (
    left.length === right.length &&
    left.every(
      (actor, index) =>
        actor.id === right[index]?.id &&
        actor.point.x === right[index]?.point.x &&
        actor.point.y === right[index]?.point.y &&
        actor.color.every(
          (channel, colorIndex) => channel === right[index]?.color[colorIndex],
        ) &&
        actor.selected === right[index]?.selected &&
        sameTilePolygons(actor.tiles, right[index]?.tiles),
    )
  );
}

function sameTilePolygons(
  left: ScreenPoint[][] | undefined,
  right: ScreenPoint[][] | undefined,
): boolean {
  if (!left || !right) return left === right;
  return (
    left.length === right.length &&
    left.every((polygon, index) => samePoints(polygon, right[index]!))
  );
}

/** Maps between world ground points and minimap CSS pixels, north up. */
export type MinimapProjection = {
  toMinimap: (point: { x: number; z: number }) => ScreenPoint;
  toWorld: (point: ScreenPoint) => Vector3;
  /** Where the whole map sits on the minimap. */
  mapRect: { x: number; y: number; width: number; height: number };
};

export function minimapProjection(
  map: Pick<TerrainMap, "width" | "height" | "tileSize">,
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
  const { minX, maxX, minZ, maxZ } = map.worldBounds;
  return new Vector3(
    Math.min(Math.max(point.x, minX), maxX),
    0,
    Math.min(Math.max(point.z, minZ), maxZ),
  );
}

/** Writes an opaque RGBA pixel per tile in `bounds`, north row first. */
export function paintTerrain(
  map: TerrainMap,
  pixels: Uint8ClampedArray,
  bounds: TerrainBounds,
  background: Rgb,
): void {
  for (let z = bounds.minZ; z <= bounds.maxZ; z += 1) {
    for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
      const [red, green, blue] = tileColor(map, x, z, background);
      const offset = ((map.height - 1 - z) * map.width + x) * 4;
      pixels[offset] = red * 255;
      pixels[offset + 1] = green * 255;
      pixels[offset + 2] = blue * 255;
      pixels[offset + 3] = 255;
    }
  }
}

/**
 * Copies terrain pixels, hiding unexplored tiles in the background color and
 * dimming explored tiles outside current vision.
 */
export function shadeFog(
  map: TerrainMap,
  terrain: Uint8ClampedArray,
  shown: Uint8ClampedArray,
  fog: FogView | undefined,
  background: Rgb,
): void {
  for (let z = 0; z < map.height; z += 1) {
    for (let x = 0; x < map.width; x += 1) {
      const alpha = fog ? fogAlpha(fog, x, z) : 0;
      const offset = ((map.height - 1 - z) * map.width + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        const color = terrain[offset + channel];
        shown[offset + channel] =
          color + (background[channel] * 255 - color) * alpha;
      }
      shown[offset + 3] = 255;
    }
  }
}

/** A tile's layers composited over `background` in slot order, then hillshaded. */
export function tileColor(
  map: TerrainMap,
  x: number,
  z: number,
  background: Rgb,
): Rgb {
  const color: Rgb = [...background];
  const layers = map
    .layersAt(x, z)
    .map((layer, index) => ({ layer, slot: layerSlot(layer, index) }))
    .sort((a, b) => a.slot - b.slot);

  for (const { layer } of layers) {
    const [red, green, blue, coverage] = layer.type?.graphics?.minimapColor ?? [
      1, 1, 1, 1,
    ];
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
