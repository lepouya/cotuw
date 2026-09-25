/**
 * Records when a canvas's CSS size or the device pixel ratio changes. Callers
 * resize right before drawing, so a cleared buffer is never left on screen and
 * the resize lands in a later frame than the observer that reported it.
 */
export type CanvasSizeWatcher = {
  /** Whether a change arrived since the last call. */
  takeChange: () => boolean;
  dispose: () => void;
};

export function watchCanvasSize(canvas: HTMLCanvasElement): CanvasSizeWatcher {
  let changed = false;
  const markChanged = () => {
    changed = true;
  };
  // The canvas can resize without the window, and window resizes also carry
  // pixel-ratio changes between displays.
  const resizeObserver = new ResizeObserver(markChanged);
  resizeObserver.observe(canvas);
  window.addEventListener("resize", markChanged);

  return {
    takeChange: () => {
      const result = changed;
      changed = false;
      return result;
    },
    dispose: () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", markChanged);
    },
  };
}
