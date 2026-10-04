import { worldInputAvailable } from "./input-focus";

const EDGE_PIXELS = 16;
const EDGE_DWELL_SECONDS = 0.2;

/** Mouse hover navigation; touches and pressed buttons never start it. */
export function createEdgePan(canvas: HTMLCanvasElement) {
  const document = canvas.ownerDocument;
  const host = document?.defaultView;
  const controller = new AbortController();
  const { signal } = controller;
  let enabled = true;
  let point: { x: number; y: number } | undefined;
  let direction = [0, 0];
  let dwell = 0;
  const clear = () => {
    point = undefined;
    direction = [0, 0];
    dwell = 0;
  };
  canvas.addEventListener(
    "pointermove",
    (event) => {
      if (event.pointerType !== "mouse" || event.buttons !== 0) {
        clear();
        return;
      }
      point = { x: event.clientX, y: event.clientY };
    },
    { signal },
  );
  canvas.addEventListener("pointerleave", clear, { signal });
  host?.addEventListener("pointerdown", clear, { signal });
  host?.addEventListener("pointerup", clear, { signal });
  host?.addEventListener("pointercancel", clear, { signal });
  host?.addEventListener("blur", clear, { signal });
  document?.addEventListener?.("visibilitychange", clear, { signal });
  return {
    get enabled() {
      return enabled;
    },
    setEnabled(active: boolean) {
      enabled = active;
      clear();
    },
    advance(seconds: number): readonly [number, number] | undefined {
      if (!enabled || !point || !worldInputAvailable(document)) {
        clear();
        return;
      }
      const bounds = canvas.getBoundingClientRect();
      const x = point.x - bounds.left;
      const y = point.y - bounds.top;
      if (x < 0 || y < 0 || x >= bounds.width || y >= bounds.height) {
        clear();
        return;
      }
      const band = Math.min(EDGE_PIXELS, bounds.width / 4, bounds.height / 4);
      const horizontal = x < band ? -1 : x >= bounds.width - band ? 1 : 0;
      const vertical = y < band ? -1 : y >= bounds.height - band ? 1 : 0;
      if (
        (horizontal === 0 && vertical === 0) ||
        (document?.elementFromPoint &&
          document.elementFromPoint(point.x, point.y) !== canvas)
      ) {
        clear();
        return;
      }
      if (horizontal !== direction[0] || vertical !== direction[1]) {
        direction = [horizontal, vertical];
        dwell = 0;
      }
      dwell += seconds;
      // Passing briefly through an edge should not shift a click's target.
      if (dwell >= EDGE_DWELL_SECONDS) return [horizontal, vertical];
    },
    dispose() {
      clear();
      controller.abort();
    },
  };
}
