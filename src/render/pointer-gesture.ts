/** CSS pixels a press may wander before it becomes a drag. */
const DRAG_SLOP_PIXELS = 5;

export type PointerGesture<T> = {
  start: PointerEvent;
  last: PointerEvent;
  dragged: boolean;
  data: T;
};

/** Tracks one gesture; additional pointers cancel it until they are released. */
export function createPointerGesture<T>(
  target: HTMLElement,
  options: {
    start: (event: PointerEvent) => T | undefined;
    move?: (event: PointerEvent, gesture: PointerGesture<T>) => void;
    end?: (event: PointerEvent, gesture: PointerGesture<T>) => void;
    cancel?: () => void;
    enabled?: () => boolean;
    capture?: boolean;
  },
) {
  const { enabled = () => true, capture = true } = options;
  const controller = new AbortController();
  const signal = controller.signal;
  const host = target.ownerDocument?.defaultView;
  const pointers = new Set<number>();
  let gesture: PointerGesture<T> | undefined;
  const cancel = () => {
    const active = gesture;
    gesture = undefined;
    if (!active) return;
    options.cancel?.();
    if (capture && target.hasPointerCapture(active.start.pointerId))
      target.releasePointerCapture(active.start.pointerId);
  };
  const down = (event: PointerEvent) => {
    pointers.add(event.pointerId);
    if (pointers.size > 1) {
      cancel();
      return;
    }
    if (gesture || !enabled()) return;
    const data = options.start(event);
    if (data === undefined) return;
    gesture = { start: event, last: event, dragged: false, data };
    if (capture && event.isTrusted) target.setPointerCapture(event.pointerId);
  };
  const move = (event: PointerEvent) => {
    if (gesture?.start.pointerId !== event.pointerId) return;
    if (!enabled()) {
      cancel();
      return;
    }
    if (
      Math.hypot(
        event.clientX - gesture.start.clientX,
        event.clientY - gesture.start.clientY,
      ) > DRAG_SLOP_PIXELS
    )
      gesture.dragged = true;
    options.move?.(event, gesture);
    if (gesture) gesture.last = event;
  };
  const up = (event: PointerEvent) => {
    pointers.delete(event.pointerId);
    if (gesture?.start.pointerId !== event.pointerId) return;
    move(event);
    const completed = gesture;
    cancel();
    if (completed && event.button === completed.start.button)
      options.end?.(event, completed);
  };
  const cancelled = (event: PointerEvent) => {
    pointers.delete(event.pointerId);
    if (gesture?.start.pointerId === event.pointerId) cancel();
  };
  const lostCapture = (event: PointerEvent) => {
    // Capture can be released while the finger is still down.
    if (gesture?.start.pointerId === event.pointerId) cancel();
  };
  const leave = () => {
    if (
      !capture ||
      (gesture && !target.hasPointerCapture(gesture.start.pointerId))
    )
      cancel();
  };
  const blur = () => {
    pointers.clear();
    cancel();
  };
  target.addEventListener("pointerdown", down, { signal });
  target.addEventListener("pointermove", move, { signal });
  target.addEventListener("pointerup", up, { signal });
  target.addEventListener("pointercancel", cancelled, { signal });
  target.addEventListener("pointerleave", leave, { signal });
  target.addEventListener("lostpointercapture", lostCapture, { signal });
  // Releases outside the target must still retire cancelled pointers.
  host?.addEventListener("pointerup", up, { signal });
  host?.addEventListener("pointercancel", cancelled, { signal });
  host?.addEventListener("blur", blur, { signal });
  return {
    cancel,
    dispose: () => {
      blur();
      controller.abort();
    },
  };
}
