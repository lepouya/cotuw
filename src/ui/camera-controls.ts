import type { StrategyCamera } from "../render/camera";

const CAMERA_ACTIONS: Record<string, (camera: StrategyCamera) => void> = {
  up: (camera) => camera.panView(0, -1),
  down: (camera) => camera.panView(0, 1),
  left: (camera) => camera.panView(-1, 0),
  right: (camera) => camera.panView(1, 0),
  "rotate-left": (camera) => camera.rotateView(-1),
  "rotate-right": (camera) => camera.rotateView(1),
  "tilt-up": (camera) => camera.tiltView(-Math.PI / 16),
  "tilt-down": (camera) => camera.tiltView(Math.PI / 16),
  "zoom-in": (camera) => camera.zoomBy(0.8),
  "zoom-out": (camera) => camera.zoomBy(1.25),
  pan: (camera) => camera.setPanMode(!camera.panMode),
};

const VIEW_ACTIONS: Record<string, (camera: StrategyCamera) => void> = {
  isometric: (camera) => camera.setPreset("isometric"),
  "top-down": (camera) => camera.setPreset("top-down"),
  grid: (camera) => camera.setPreset("grid"),
  reset: (camera) => camera.resetView(),
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
  const views = root.querySelector<HTMLElement>("#camera-views");
  const viewsToggle = root.querySelector<HTMLButtonElement>(
    '[data-camera-action="views"]',
  );
  const showViews = (open: boolean) => {
    if (views) views.hidden = !open;
    viewsToggle?.setAttribute("aria-expanded", String(open));
  };
  showViews(false);
  const host = root.ownerDocument.defaultView;
  const dismissOutside = (event: Event) => {
    if (
      views &&
      !views.hidden &&
      !views.contains(event.target as Node) &&
      !viewsToggle?.contains(event.target as Node)
    )
      showViews(false);
  };
  host?.addEventListener("pointerdown", dismissOutside, {
    capture: true,
    signal,
  });
  root.ownerDocument.addEventListener("focusin", dismissOutside, { signal });
  host?.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "Escape" || !views || views.hidden) return;
      showViews(false);
      viewsToggle?.focus({ preventScroll: true });
      event.preventDefault();
      event.stopImmediatePropagation();
    },
    { capture: true, signal },
  );
  host?.addEventListener("blur", () => showViews(false), { signal });
  root.ownerDocument.addEventListener(
    "visibilitychange",
    () => showViews(false),
    {
      signal,
    },
  );
  const updatePreset = () => {
    for (const button of root.querySelectorAll<HTMLButtonElement>(
      "button[data-camera-view]:not([data-camera-view=reset])",
    ))
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.cameraView === camera.preset),
      );
  };
  updatePreset();
  const panObserver = camera.onPanChangedObservable.add(updatePan);
  const viewObserver = camera.onViewChangedObservable.add(updatePreset);
  root.addEventListener(
    "click",
    (event) => {
      if (!(event.target instanceof Element)) return;
      const button = event.target.closest<HTMLButtonElement>(
        "button[data-camera-action], button[data-camera-view]",
      );
      if (!button || button.disabled) return;
      if (button === viewsToggle) return showViews(!!views?.hidden);
      const view = button.dataset.cameraView;
      if (view) {
        VIEW_ACTIONS[view]?.(camera);
        showViews(false);
        viewsToggle?.focus({ preventScroll: true });
        return;
      }
      CAMERA_ACTIONS[button.dataset.cameraAction!]?.(camera);
    },
    { signal },
  );
  return () => {
    showViews(false);
    controller.abort();
    camera.onPanChangedObservable.remove(panObserver);
    camera.onViewChangedObservable.remove(viewObserver);
  };
}
