import { expect, test, vi } from "vitest";

import { createPrimaryClick } from "../src/render/primary-click";

function pointer(target: EventTarget, type: string, x = 10, pointerId = 1) {
  const event = new Event(type);
  Object.assign(event, { button: 0, clientX: x, clientY: 10, pointerId });
  target.dispatchEvent(event);
}

function fixture() {
  const target = new EventTarget();
  const clicked = vi.fn();
  let enabled = true;
  const click = createPrimaryClick(
    target as HTMLElement,
    clicked,
    () => enabled,
  );
  return {
    target,
    clicked,
    click,
    disable: () => {
      enabled = false;
    },
  };
}

test("a small primary gesture clicks once", () => {
  const { target, clicked, click } = fixture();
  pointer(target, "pointerdown");
  pointer(target, "pointermove", 12);
  pointer(target, "pointerup", 12);
  pointer(target, "pointerup", 12);
  expect(clicked).toHaveBeenCalledTimes(1);
  click.dispose();
});

test("a drag returning to its starting point never clicks", () => {
  const { target, clicked, click } = fixture();
  pointer(target, "pointerdown");
  pointer(target, "pointermove", 30);
  pointer(target, "pointermove", 10);
  pointer(target, "pointerup", 10);
  expect(clicked).not.toHaveBeenCalled();
  click.dispose();
});

test.each(["pointercancel", "pointerleave", "lostpointercapture"])(
  "%s cancels a gesture",
  (event) => {
    const { target, clicked, click } = fixture();
    pointer(target, "pointerdown");
    pointer(target, event);
    pointer(target, "pointerup");
    expect(clicked).not.toHaveBeenCalled();
    click.dispose();
  },
);

test("another pointer cannot complete a gesture and multitouch cancels it", () => {
  const { target, clicked, click } = fixture();
  pointer(target, "pointerdown");
  pointer(target, "pointerup", 10, 2);
  expect(clicked).not.toHaveBeenCalled();
  pointer(target, "pointerdown", 10, 2);
  pointer(target, "pointerup");
  expect(clicked).not.toHaveBeenCalled();
  click.dispose();
});

test("disabling or disposing input prevents a pending click", () => {
  const { target, clicked, click, disable } = fixture();
  pointer(target, "pointerdown");
  disable();
  pointer(target, "pointerup");
  expect(clicked).not.toHaveBeenCalled();
  click.dispose();
  pointer(target, "pointerdown");
  pointer(target, "pointerup");
  expect(clicked).not.toHaveBeenCalled();
});
