import { expect, test, vi } from "vitest";

import { bindWorldShortcuts } from "../src/ui/world-shortcuts";

import type { WorldShortcuts } from "../src/ui/world-shortcuts";

function fixture(shortcuts: WorldShortcuts) {
  const host = new EventTarget();
  const document = { defaultView: host, hidden: false, modal: false };
  Object.assign(document, {
    querySelector: () => (document.modal ? {} : null),
  });
  const unbind = bindWorldShortcuts(document as unknown as Document, shortcuts);
  const press = (
    code: string,
    {
      target,
      handled = false,
      ...init
    }: Partial<KeyboardEvent> & { handled?: boolean } = {},
  ) => {
    const event = Object.assign(new Event("keydown", { cancelable: true }), {
      code,
      key: code,
      ...init,
    });
    // Event targets and prior handling are read-only; set them as a host would.
    if (target) Object.defineProperty(event, "target", { value: target });
    if (handled) event.preventDefault();
    host.dispatchEvent(event);
    return event;
  };
  return { document, press, unbind };
}

test("routes physical keys to the first handler that takes them", () => {
  const calls: string[] = [];
  const handler = (name: string, handled: boolean) => () => {
    calls.push(name);
    return handled;
  };
  const { press } = fixture({
    Escape: [handler("tool", false), handler("selection", true)],
    KeyS: [handler("stop", false)],
  });
  expect(press("Escape").defaultPrevented).toBe(true);
  expect(calls).toEqual(["tool", "selection"]);
  calls.length = 0;
  // Layouts that type another character keep the physical binding.
  expect(press("KeyS", { key: "o" }).defaultPrevented).toBe(false);
  expect(press("KeyO", { key: "s" }).defaultPrevented).toBe(false);
  expect(calls).toEqual(["stop"]);
});

test.each([
  ["repeated", { repeat: true }],
  ["modified", { ctrlKey: true }],
  ["handled", { handled: true }],
  ["typed", { target: { closest: () => ({}) } as unknown as EventTarget }],
] as const)("ignores %s keys", (_name, init) => {
  const handle = vi.fn(() => true);
  const { press } = fixture({ Escape: [handle] });
  press("Escape", init);
  expect(handle).not.toHaveBeenCalled();
});

test("yields to dialogs and stops after unbinding", () => {
  const handle = vi.fn(() => true);
  const { document, press, unbind } = fixture({ Escape: [handle] });
  document.modal = true;
  press("Escape");
  expect(handle).not.toHaveBeenCalled();
  document.modal = false;
  unbind();
  press("Escape");
  expect(handle).not.toHaveBeenCalled();
});
