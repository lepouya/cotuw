import { expect, test, vi } from "vitest";
import { createPointerGesture } from "../src/render/pointer-gesture";

function pointer(target: EventTarget, type: string, pointerId: number, x = 10) {
  const event = new Event(type);
  Object.assign(event, { pointerId, button: 0, clientX: x, clientY: 10 });
  target.dispatchEvent(event);
}
function fixture() {
  const host = new EventTarget();
  const target = Object.assign(new EventTarget(), {
    ownerDocument: { defaultView: host },
    hasPointerCapture: () => false,
  });
  const start = vi.fn(() => true);
  const end = vi.fn();
  const release = vi.fn();
  const gesture = createPointerGesture(target as unknown as HTMLElement, {
    start,
    end,
    release,
  });
  return { target, host, start, end, release, gesture };
}

test("lost capture does not forget a finger that is still down", () => {
  const { target, start, end, gesture } = fixture();
  pointer(target, "pointerdown", 1);
  pointer(target, "pointerdown", 2);
  pointer(target, "lostpointercapture", 1);
  pointer(target, "pointerup", 2);
  pointer(target, "pointerdown", 3);
  pointer(target, "pointerup", 3);
  expect(start).toHaveBeenCalledTimes(1);
  expect(end).not.toHaveBeenCalled();
  pointer(target, "pointerup", 1);
  pointer(target, "pointerdown", 4);
  pointer(target, "pointerup", 4);
  expect(end).toHaveBeenCalledTimes(1);
  gesture.dispose();
});

test("releases outside the target retire cancelled pointers", () => {
  const { target, host, end, gesture } = fixture();
  pointer(target, "pointerdown", 1);
  pointer(target, "pointerdown", 2);
  pointer(host, "pointerup", 1);
  pointer(host, "pointercancel", 2);
  pointer(target, "pointerdown", 3);
  pointer(target, "pointerup", 3);
  expect(end).toHaveBeenCalledTimes(1);
  gesture.dispose();
});

test("move runs only once a press becomes a drag", () => {
  const host = new EventTarget();
  const target = Object.assign(new EventTarget(), {
    ownerDocument: { defaultView: host },
    hasPointerCapture: () => false,
  });
  const move = vi.fn();
  const gesture = createPointerGesture(target as unknown as HTMLElement, {
    start: () => true,
    move,
  });
  pointer(target, "pointerdown", 1);
  pointer(target, "pointermove", 1, 12);
  expect(move).not.toHaveBeenCalled();
  pointer(target, "pointermove", 1, 30);
  expect(move).toHaveBeenCalledTimes(1);
  expect(gesture.cancel()).toBe(true);
  expect(gesture.cancel()).toBe(false);
  gesture.dispose();
});

test("blur cancels a drag and disposal removes target and window listeners", () => {
  const { target, host, start, end, release, gesture } = fixture();
  pointer(target, "pointerdown", 1);
  pointer(target, "pointermove", 1, 30);
  host.dispatchEvent(new Event("blur"));
  pointer(target, "pointerup", 1);
  expect(release).toHaveBeenCalledTimes(1);
  expect(end).not.toHaveBeenCalled();
  gesture.dispose();
  pointer(target, "pointerdown", 2);
  pointer(host, "pointerup", 2);
  expect(start).toHaveBeenCalledTimes(1);
  expect(end).not.toHaveBeenCalled();
});
