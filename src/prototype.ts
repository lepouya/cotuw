// Throwaway prototype code: a sample map and the scene that shows it.
// Replace this with real game setup once the prototype has served its purpose.
import { Color3, Color4, Vector3 } from "@babylonjs/core";

import { TerrainMap } from "./map";
import { createGameView, createTerrainMeshes } from "./render";

import type { TileLayer } from "./map";
import type { GameView, GameViewOptions } from "./render";
const TILE_COUNT = 100;
const TILE_SIZE = 1;

export const PROTOTYPE_VIEW_OPTIONS = {
  clearColor: new Color4(0.035, 0.07, 0.09, 1),
  lighting: {
    skyColor: new Color3(0.6, 0.78, 0.77),
    groundColor: new Color3(0.08, 0.12, 0.1),
    sunColor: Color3.White(),
    sunDirection: new Vector3(-0.5, -1, 0.35),
    skyIntensity: 1.05,
    sunIntensity: 1.3,
  },
} satisfies GameViewOptions;

export function createTerrainPrototype(canvas: HTMLCanvasElement): GameView {
  const map = createPrototypeMap();
  const view = createGameView(canvas, map, PROTOTYPE_VIEW_OPTIONS);

  createTerrainMeshes(view.scene, map, { debugOverlay: true });

  canvas.dataset.terrainReady = "true";
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
      const layers: TileLayer[] = [
        {
          color: new Color4(0.19 + variation, 0.36 + variation, 0.29, 1),
        },
      ];

      if (Math.sin(x * 0.18 + z * 0.11) > 0.72) {
        layers.push({
          texture: "terrain/dirt",
          color: new Color4(0.62, 0.4, 0.22, 0.46),
        });
      }

      if (Math.sin(x * 0.47 - z * 0.29) > 0.9) {
        layers.push({
          texture: "terrain/clutter",
          color: new Color4(0.56, 0.83, 0.61, 0.56),
        });
      }

      return layers;
    },
  });
}
