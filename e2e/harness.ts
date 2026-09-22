// Runs inside the page under test: the specs load it through the Vite dev
// server, so its imports resolve to the same module instances as the app's.
import { Color4 } from "@babylonjs/core";

import { TerrainMap } from "../src/map";
import { PROTOTYPE_VIEW_OPTIONS } from "../src/prototype";
import { createGameView, createTerrainMeshes } from "../src/render";

import type { ArcRotateCamera } from "@babylonjs/core";
import type { TerrainMapOptions } from "../src/map";

export { layerSlot } from "../src/map";
export { createPrototypeMap } from "../src/prototype";

export type TestViewOptions = {
  map?: TerrainMapOptions;
  /** Canvas size in CSS pixels. */
  size?: { width: number; height: number };
  /** Also builds the terrain meshes for the map. */
  terrain?: boolean;
};

/** A game view on a fresh canvas, so tests never touch the app's own view. */
export function createTestView({
  map: mapOptions = { width: 100, height: 100, tileSize: 1 },
  size = { width: 1280, height: 720 },
  terrain = false,
}: TestViewOptions = {}) {
  const canvas = document.createElement("canvas");
  canvas.style.width = `${size.width}px`;
  canvas.style.height = `${size.height}px`;
  document.body.append(canvas);

  const map = new TerrainMap(mapOptions);
  const view = createGameView(canvas, map, PROTOTYPE_VIEW_OPTIONS);
  if (terrain) {
    createTerrainMeshes(view.scene, map);
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
    },
  };
}

/** The scene's clear color as 0-255 channels, for spotting terrain in shots. */
export const clearColorBytes = () =>
  PROTOTYPE_VIEW_OPTIONS.clearColor
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
