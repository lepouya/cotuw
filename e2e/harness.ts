// Runs inside the page under test: the specs load it through the Vite dev
// server, so its imports resolve to the same module instances as the app's.
import { Color3, Color4, Vector3 } from "@babylonjs/core";

import { TerrainMap } from "../src/map";
import {
  createGameView,
  createMinimap,
  createTerrainMeshes,
} from "../src/render";

import type { ArcRotateCamera } from "@babylonjs/core";
import type { TerrainMapOptions, TileType } from "../src/map";
import type { GameViewOptions } from "../src/render";

export { createMinimap } from "../src/render";
export { minimapProjection } from "../src/render/minimap";
export { Matrix, Vector3 } from "@babylonjs/core";

export const TEST_VIEW_OPTIONS = {
  clearColor: new Color3(0.035, 0.07, 0.09),
  lighting: {
    skyColor: new Color3(0.6, 0.78, 0.77),
    groundColor: new Color3(0.08, 0.12, 0.1),
    sunColor: Color3.White(),
    sunDirection: new Vector3(-0.5, -1, 0.35),
    skyIntensity: 1.05,
    sunIntensity: 1.3,
  },
} satisfies GameViewOptions;

/** Tile types over the checked-in terrain images, pinned like real content. */
export const TEST_TILE_TYPES = {
  dirt: {
    id: "dirt",
    slot: 0,
    graphics: {
      url: "/assets/terrain/dirt.png",
      hasAlpha: false,
      minimapColor: [0.47, 0.34, 0.22, 1],
    },
  },
  water: {
    id: "water",
    slot: 1,
    featherEdges: true,
    graphics: {
      url: "/assets/terrain/water.png",
      hasAlpha: true,
      layerAlphaOnly: true,
      scrollSpeed: { u: 0.025, v: 0.012 },
      minimapColor: [0.19, 0.5, 0.56, 1],
    },
  },
  waterRipples: {
    id: "water-ripples",
    slot: 2,
    featherEdges: true,
    graphics: {
      url: "/assets/terrain/water.png",
      hasAlpha: true,
      scale: { u: 1.37, v: 1.37 },
      scrollSpeed: { u: -0.018, v: 0.032 },
      minimapColor: [0.19, 0.5, 0.56, 0.65],
    },
  },
  clutter: {
    id: "clutter",
    slot: 3,
    graphics: {
      url: "/assets/terrain/clutter.png",
      hasAlpha: true,
      minimapColor: [0.41, 0.37, 0.34, 0.05],
    },
  },
} satisfies Record<string, TileType>;

export type TestViewOptions = {
  map?: TerrainMapOptions;
  /** Canvas size in CSS pixels. */
  size?: { width: number; height: number };
  /** Also builds the terrain meshes for the map. */
  terrain?: boolean;
  /** Also adds a minimap, pinned on top of the page at this size in CSS px. */
  minimapSize?: number;
};

/** A game view on a fresh canvas, so tests never touch the app's own view. */
export function createTestView({
  map: mapOptions = { width: 100, height: 100, tileSize: 1 },
  size = { width: 1280, height: 720 },
  terrain = false,
  minimapSize,
}: TestViewOptions = {}) {
  const canvas = document.createElement("canvas");
  canvas.style.width = `${size.width}px`;
  canvas.style.height = `${size.height}px`;
  document.body.append(canvas);

  const map = new TerrainMap(mapOptions);
  const view = createGameView(canvas, map, TEST_VIEW_OPTIONS);
  if (terrain) {
    createTerrainMeshes(view.scene, map);
  }

  let minimapCanvas: HTMLCanvasElement | undefined;
  if (minimapSize !== undefined) {
    minimapCanvas = document.createElement("canvas");
    // Pinned over the app so real pointer input reaches it.
    Object.assign(minimapCanvas.style, {
      position: "fixed",
      top: "0",
      left: "0",
      width: `${minimapSize}px`,
      height: `${minimapSize}px`,
      zIndex: "10",
    });
    document.body.append(minimapCanvas);
    createMinimap(view.scene, map, view.camera, minimapCanvas);
  }

  return {
    canvas,
    map,
    view,
    scene: view.scene,
    camera: view.scene.activeCamera as ArcRotateCamera,
    dispose: () => {
      view.dispose();
      canvas.remove();
      minimapCanvas?.remove();
    },
  };
}

/** The scene's clear color as 0-255 channels, for spotting terrain in shots. */
export const clearColorBytes = () =>
  TEST_VIEW_OPTIONS.clearColor
    .asArray()
    .map((channel) => Math.round(channel * 255));

export const color = (
  red: number,
  green: number,
  blue: number,
  alpha: number,
) => new Color4(red, green, blue, alpha);

export async function frames(count = 2): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
  }
}

/** Tiles visible across the viewport's height. */
export const viewHeight = (camera: ArcRotateCamera) =>
  camera.orthoTop! - camera.orthoBottom!;

export const viewAspectRatio = (camera: ArcRotateCamera) =>
  (camera.orthoRight! - camera.orthoLeft!) / viewHeight(camera);

export function wheel(
  canvas: HTMLCanvasElement,
  deltaY: number,
  deltaMode: number = WheelEvent.DOM_DELTA_PIXEL,
): void {
  canvas.dispatchEvent(
    new WheelEvent("wheel", { deltaY, deltaMode, cancelable: true }),
  );
}

export function pointer(
  canvas: HTMLCanvasElement,
  type: "pointerdown" | "pointermove" | "pointerup",
  { button = 0, x, y }: { button?: number; x: number; y: number },
): void {
  canvas.dispatchEvent(
    new PointerEvent(type, {
      pointerId: 1,
      pointerType: "mouse",
      button,
      buttons: button === 0 ? 1 : 2,
      clientX: x,
      clientY: y,
    }),
  );
}
