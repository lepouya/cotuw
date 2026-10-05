import { Color3, Color4, Engine, Scene } from "@babylonjs/core";

import { createStrategyCamera } from "./camera";
import { watchCanvasSize } from "./canvas-size";
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
  canvas.addEventListener("contextmenu", suppressContextMenu);
  const canvasSize = watchCanvasSize(canvas);

  const camera = createStrategyCamera(scene, canvas, map);
  const lighting = createLighting(scene, lightingConfig);
  engine.runRenderLoop(() => {
    if (canvasSize.takeChange()) {
      engine.resize();
    }
    scene.render();
  });

  return {
    engine,
    scene,
    camera,
    lighting,
    dispose: () => {
      canvas.removeEventListener("contextmenu", suppressContextMenu);
      canvasSize.dispose();
      scene.dispose();
      engine.dispose();
    },
  };
}
