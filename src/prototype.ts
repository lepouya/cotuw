// Throwaway prototype code: a sample map and the scene that shows it.
// Replace this with real game setup once the prototype has served its purpose.
import { Color3, Color4, Vector3 } from "@babylonjs/core";

import { TerrainMap } from "./map";
import { createGameView, createMinimap, createTerrainMeshes } from "./render";

import type { TileLayer } from "./map";
import type { GameView, GameViewOptions } from "./render";

const TILE_COUNT = 100;
const TILE_SIZE = 1;
/** Tiles from the river's midline to its bank. */
const WATER_HALF_WIDTH = 5;
/** Water opacity at the midline and at the last tile before the bank. */
const WATER_DEEP_ALPHA = 0.98;
const WATER_SHORE_ALPHA = 0.06;
/** Ripple opacity, as a fraction of the water beneath it. */
const WATER_RIPPLE_ALPHA = 0.3;
/** Water, ripples and clutter are each optional, so their slots are fixed. */
const DIRT_SLOT = 0;
const WATER_SLOT = 1;
const WATER_RIPPLE_SLOT = 2;
const CLUTTER_SLOT = 3;

export const PROTOTYPE_VIEW_OPTIONS = {
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

export function createTerrainPrototype(
  canvas: HTMLCanvasElement,
  minimapCanvas: HTMLCanvasElement,
): GameView {
  const map = createPrototypeMap();
  const view = createGameView(canvas, map, PROTOTYPE_VIEW_OPTIONS);

  createTerrainMeshes(view.scene, map);
  createMinimap(view.scene, map, view.camera, minimapCanvas);

  view.scene.executeWhenReady(() => {
    canvas.dataset.terrainReady = "true";
  });
  return view;
}

export function createPrototypeMap(): TerrainMap {
  const mapCenter = TILE_COUNT / 2;
  return new TerrainMap({
    width: TILE_COUNT,
    height: TILE_COUNT,
    tileSize: TILE_SIZE,
    createHeight: (x, z) => {
      const distanceFromCenter = Math.hypot(x - mapCenter, z - mapCenter);
      const ridge = Math.max(0, 1 - distanceFromCenter / 55) * 2.8;
      const rolling = Math.sin(x * 0.16) * 0.65 + Math.cos(z * 0.13) * 0.55;
      const detail = Math.sin((x + z) * 0.37) * 0.2;

      return ridge + rolling + detail;
    },
    createLayers: (x, z) => {
      const variation = Math.sin(x * 0.23) * 0.025 + Math.cos(z * 0.19) * 0.02;
      const waterCenter = 52 + Math.sin(x * 0.08) * 8;
      const depth = 1 - Math.abs(z + 0.5 - waterCenter) / WATER_HALF_WIDTH;
      const layers: TileLayer[] = [
        {
          texture: "terrain/dirt",
          slot: DIRT_SLOT,
          color: new Color4(
            0.86 + variation,
            0.9 + variation,
            0.88 + variation,
            1,
          ),
        },
      ];

      if (depth > 0) {
        const alpha = waterAlpha(depth);
        layers.push({
          texture: "terrain/water",
          slot: WATER_SLOT,
          color: new Color4(0.74, 0.94, 0.98, alpha),
          featherEdges: true,
        });
        layers.push({
          texture: "terrain/water-ripples",
          slot: WATER_RIPPLE_SLOT,
          color: new Color4(0.82, 0.98, 1, alpha * WATER_RIPPLE_ALPHA),
          featherEdges: true,
        });
      }

      if (Math.sin(x * 0.47 - z * 0.29) > 0.78) {
        layers.push({
          texture: "terrain/clutter",
          slot: CLUTTER_SLOT,
          color: new Color4(0.99, 0.66, 0.33, 1),
        });
      }

      return layers;
    },
  });
}

/**
 * Fades the river towards its banks so its edge reads as a shoreline.
 *
 * @param depth 0 at the bank, 1 at the midline.
 */
function waterAlpha(depth: number): number {
  const eased = depth * depth * (3 - 2 * depth);
  return WATER_SHORE_ALPHA + (WATER_DEEP_ALPHA - WATER_SHORE_ALPHA) * eased;
}
