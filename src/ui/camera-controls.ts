import type { StrategyCamera } from "../render/camera";

/** All pointer camera actions also have touch-sized buttons. */
export function bindCameraControls(root: HTMLElement, camera: StrategyCamera) {
  const controller = new AbortController();
  root.addEventListener(
    "click",
    (event) => {
      if (!(event.target instanceof Element)) return;
      const button = event.target.closest<HTMLButtonElement>(
        "button[data-camera-action]",
      );
      if (!button || button.disabled) return;
      switch (button.dataset.cameraAction) {
        case "up":
          camera.panView(0, -1);
          break;
        case "down":
          camera.panView(0, 1);
          break;
        case "left":
          camera.panView(-1, 0);
          break;
        case "right":
          camera.panView(1, 0);
          break;
        case "rotate-left":
          camera.rotateView(-Math.PI / 8);
          break;
        case "rotate-right":
          camera.rotateView(Math.PI / 8);
          break;
        case "tilt-up":
          camera.tiltView(-Math.PI / 16);
          break;
        case "tilt-down":
          camera.tiltView(Math.PI / 16);
          break;
        case "zoom-in":
          camera.zoomBy(0.8);
          break;
        case "zoom-out":
          camera.zoomBy(1.25);
          break;
        case "reset":
          camera.resetView();
          break;
      }
    },
    { signal: controller.signal },
  );
  return () => controller.abort();
}
