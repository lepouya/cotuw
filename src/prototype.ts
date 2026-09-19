// Throwaway prototype code: a sample map and the scene that shows it.
// Replace this with real game setup once the prototype has served its purpose.
import { TerrainMap } from "./map";
import {
  createDebugOverlay,
  createGameView,
  createLighting,
  createStrategyCamera,
  createTerrainMeshes,
  type GameView,
} from "./render";

const TILE_COUNT = 100;
const TILE_SIZE = 1;

export function createTerrainPrototype(
  canvas: HTMLCanvasElement,
  map = createPrototypeMap(),
): GameView {
  const view = createGameView(canvas);

  const camera = createStrategyCamera(view.scene, canvas, map);
  camera.fitToMap();
  createLighting(view.scene);
  const terrainMeshes = createTerrainMeshes(view.scene, map);
  const debugOverlay = createDebugOverlay(view.scene, map);
  let refreshQueued = false;
  const unsubscribeMap = map.onChange((change) => {
    if (change.heightsChanged) {
      camera.updateClipRange();
    }

    if (refreshQueued) {
      return;
    }

    refreshQueued = true;
    view.scene.onBeforeRenderObservable.addOnce(() => {
      terrainMeshes.refresh();
      debugOverlay.refresh();
      refreshQueued = false;
    });
  });
  view.scene.onDisposeObservable.add(unsubscribeMap);

  canvas.dataset.terrainReady = "true";
  return view;
}

export function createPrototypeMap(): TerrainMap {
  const mapCenter = TILE_COUNT / 2;
  const map = new TerrainMap(TILE_COUNT, TILE_COUNT, TILE_SIZE, (x, z) => {
    const distanceFromCenter = Math.hypot(x - mapCenter, z - mapCenter);
    const ridge = Math.max(0, 1 - distanceFromCenter / 55) * 2.8;
    const rolling = Math.sin(x * 0.16) * 0.65 + Math.cos(z * 0.13) * 0.55;
    const detail = Math.sin((x + z) * 0.37) * 0.2;

    return ridge + rolling + detail;
  });

  map.edit(() => {
    for (let z = 0; z < map.height; z += 1) {
      for (let x = 0; x < map.width; x += 1) {
        const variation =
          Math.sin(x * 0.23) * 0.025 + Math.cos(z * 0.19) * 0.02;
        map.addTileLayer(x, z, {
          tint: [0.19 + variation, 0.36 + variation, 0.29],
          alpha: 1,
        });

        if (Math.sin(x * 0.18 + z * 0.11) > 0.72) {
          map.addTileLayer(x, z, {
            texture: "terrain/dirt",
            tint: [0.62, 0.4, 0.22],
            alpha: 0.46,
          });
        }

        if (Math.sin(x * 0.47 - z * 0.29) > 0.9) {
          map.addTileLayer(x, z, {
            texture: "terrain/clutter",
            tint: [0.56, 0.83, 0.61],
            alpha: 0.56,
          });
        }
      }
    }
  });

  return map;
}
