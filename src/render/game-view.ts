import { Color4, Engine, Scene } from "@babylonjs/core";

export type GameView = {
  engine: Engine;
  scene: Scene;
  /** Stops rendering and releases the engine, scene and page listeners. */
  dispose: () => void;
};

/** Creates an empty, rendering scene on `canvas`; callers populate it. */
export function createGameView(
  canvas: HTMLCanvasElement,
  clearColor = new Color4(0.035, 0.07, 0.09, 1),
): GameView {
  const engine = new Engine(canvas, true);
  const scene = new Scene(engine);
  scene.clearColor = clearColor;

  const suppressContextMenu = (event: Event) => event.preventDefault();
  const resize = () => engine.resize();
  canvas.addEventListener("contextmenu", suppressContextMenu);
  window.addEventListener("resize", resize);
  engine.runRenderLoop(() => scene.render());

  return {
    engine,
    scene,
    dispose: () => {
      canvas.removeEventListener("contextmenu", suppressContextMenu);
      window.removeEventListener("resize", resize);
      scene.dispose();
      engine.dispose();
    },
  };
}
