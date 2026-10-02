/** CSS pixels a press may wander before it becomes a drag. */
const CLICK_SLOP_PIXELS = 5;

/** Tracks the entire gesture; dragging out and back never produces a click. */
export function createPrimaryClick(
  target: HTMLElement,
  onClick: (event: PointerEvent) => void,
  enabled: () => boolean = () => true,
) {
  let press:
    { pointerId: number; clientX: number; clientY: number } | undefined;
  const cancel = () => {
    press = undefined;
  };
  const down = (event: PointerEvent) => {
    if (press) {
      if (press.pointerId !== event.pointerId) cancel();
      return;
    }
    if (enabled() && event.button === 0) {
      press = {
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
      };
    }
  };
  const move = (event: PointerEvent) => {
    if (press?.pointerId !== event.pointerId) return;
    if (
      !enabled() ||
      Math.hypot(event.clientX - press.clientX, event.clientY - press.clientY) >
        CLICK_SLOP_PIXELS
    )
      cancel();
  };
  const up = (event: PointerEvent) => {
    if (event.button !== 0 || press?.pointerId !== event.pointerId) return;
    move(event);
    const clicked = press !== undefined && enabled();
    cancel();
    if (clicked) onClick(event);
  };
  target.addEventListener("pointerdown", down);
  target.addEventListener("pointermove", move);
  target.addEventListener("pointerup", up);
  target.addEventListener("pointercancel", cancel);
  target.addEventListener("pointerleave", cancel);
  target.addEventListener("lostpointercapture", cancel);
  return {
    dispose: () => {
      cancel();
      target.removeEventListener("pointerdown", down);
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", cancel);
      target.removeEventListener("pointerleave", cancel);
      target.removeEventListener("lostpointercapture", cancel);
    },
  };
}
