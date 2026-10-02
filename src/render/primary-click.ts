import { createPointerGesture } from "./pointer-gesture";

/** Tracks the entire gesture; dragging out and back never produces a click. */
export function createPrimaryClick(
  target: HTMLElement,
  onClick: (event: PointerEvent) => void,
  enabled: () => boolean = () => true,
) {
  return createPointerGesture(target, {
    start: (event) => (event.button === 0 ? true : undefined),
    end: (event, gesture) => {
      if (!gesture.dragged) onClick(event);
    },
    enabled,
    capture: false,
  });
}
