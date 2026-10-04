import type { StrategyCamera } from "../render/camera";

const CAMERA_ACTIONS: Record<string, (camera: StrategyCamera) => void> = {
  up: (camera) => camera.panView(0, -1),
  down: (camera) => camera.panView(0, 1),
  left: (camera) => camera.panView(-1, 0),
  right: (camera) => camera.panView(1, 0),
  "rotate-left": (camera) => camera.rotateView(-Math.PI / 8),
  "rotate-right": (camera) => camera.rotateView(Math.PI / 8),
  "tilt-up": (camera) => camera.tiltView(-Math.PI / 16),
  "tilt-down": (camera) => camera.tiltView(Math.PI / 16),
  "zoom-in": (camera) => camera.zoomBy(0.8),
  "zoom-out": (camera) => camera.zoomBy(1.25),
  reset: (camera) => camera.resetView(),
  pan: (camera) => camera.setPanMode(!camera.panMode),
};

/** All pointer camera actions also have touch-sized buttons. */
export function bindCameraControls(root: HTMLElement, camera: StrategyCamera) {
  const controller = new AbortController();
  const { signal } = controller;
  const edges = root.querySelector<HTMLInputElement>("#edge-panning");
  if (edges) {
    camera.setEdgePanEnabled(edges.checked);
    edges.addEventListener(
      "change",
      () => camera.setEdgePanEnabled(edges.checked),
      { signal },
    );
  }
  const pan = root.querySelector<HTMLButtonElement>(
    '[data-camera-action="pan"]',
  );
  const updatePan = () => {
    if (!pan) return;
    pan.setAttribute("aria-pressed", String(camera.panMode));
    pan.textContent = camera.panMode ? "Pan ✓" : "Pan";
  };
  updatePan();
  const observer = camera.onPanChangedObservable.add(updatePan);
  root.addEventListener(
    "click",
    (event) => {
      if (!(event.target instanceof Element)) return;
      const button = event.target.closest<HTMLButtonElement>(
        "button[data-camera-action]",
      );
      if (!button || button.disabled) return;
      CAMERA_ACTIONS[button.dataset.cameraAction!]?.(camera);
    },
    { signal },
  );
  return () => {
    controller.abort();
    camera.onPanChangedObservable.remove(observer);
  };
}
