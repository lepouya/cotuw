import { Color3, Color4, Engine, Scene } from "@babylonjs/core";

import { createStrategyCamera } from "./camera";
import { createLighting } from "./lighting";

import type { TerrainMap } from "../map";
import type { StrategyCamera } from "./camera";
import type { GameLighting, LightingConfig } from "./lighting";

export type GameViewOptions = {
  clearColor: Color3;
  lighting: LightingConfig;
};

export type GameView = {
  engine: Engine;
  scene: Scene;
  camera: StrategyCamera;
  lighting: GameLighting;
  /** Stops rendering and releases the engine, scene and page listeners. */
  dispose: () => void;
};

export function createGameView(
  canvas: HTMLCanvasElement,
  map: TerrainMap,
  { clearColor, lighting: lightingConfig }: GameViewOptions,
): GameView {
  // Render at device pixels for HiDPI; camera and pointer math stay in CSS px.
  const engine = new Engine(canvas, true, { adaptToDeviceRatio: true });
  const scene = new Scene(engine);
  scene.clearColor = Color4.FromColor3(clearColor);

  const suppressContextMenu = (event: Event) => event.preventDefault();
  const resize = () => engine.resize();
  canvas.addEventListener("contextmenu", suppressContextMenu);
  // The canvas can resize without the window, and the window resize still
  // matters for pixel-ratio changes between displays.
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);
  window.addEventListener("resize", resize);

  const camera = createStrategyCamera(scene, canvas, map);
  camera.resetView();
  const lighting = createLighting(scene, lightingConfig);
  engine.runRenderLoop(() => scene.render());

  return {
    engine,
    scene,
    camera,
    lighting,
    dispose: () => {
      canvas.removeEventListener("contextmenu", suppressContextMenu);
      window.removeEventListener("resize", resize);
      resizeObserver.disconnect();
      scene.dispose();
      engine.dispose();
    },
  };
}
