import { expect, test } from "vitest";
import { createKeyboardPreferences } from "../src/ui/keyboard-preferences";

function key(code: string, key: string, shiftKey = false, ctrlKey = false) {
  return {
    code,
    key,
    shiftKey,
    ctrlKey,
    metaKey: false,
    altKey: false,
  } as KeyboardEvent;
}

test("layout labels do not change physical slots or number-row modifiers", () => {
  const keyboard = createKeyboardPreferences();
  for (const [layout, labels] of [
    ["qwerty", ["A", "Q", "W", "1"]],
    ["azerty", ["Q", "A", "Z", "&"]],
    ["qwertz", ["A", "Q", "W", "1"]],
  ] as const) {
    keyboard.setLayout(layout);
    expect(
      (
        [
          "attackMove",
          "production-1",
          "production-2",
          "group-1-recall",
        ] as const
      ).map(keyboard.label),
    ).toEqual(labels);
    expect(keyboard.actionFor(key("KeyA", labels[0]), false)).toBe(
      "attackMove",
    );
    expect(keyboard.actionFor(key("KeyQ", labels[1]), false)).toBe(
      "production-1",
    );
    expect(keyboard.actionFor(key("Digit1", labels[3]), false)).toBe(
      "group-1-recall",
    );
    expect(keyboard.actionFor(key("Digit1", "1", true), false)).toBe(
      "group-1-add",
    );
    expect(keyboard.actionFor(key("Digit1", "1", true, true), false)).toBe(
      "group-1-assign",
    );
    expect(
      keyboard.actionFor(key("Digit1", "1", false, true), false),
    ).toBeUndefined();
    expect(keyboard.actionFor(key("Numpad1", "1"), false)).toBeUndefined();
  }
  expect(keyboard.rebind("attackMove", key("KeyY", "z"))).toBeUndefined();
  expect(keyboard.label("attackMove")).toBe("Z");
  expect(keyboard.actionFor(key("KeyY", "z"), false)).toBe("attackMove");
});

test("the active tool disambiguates rotation and the fourth card", () => {
  const keyboard = createKeyboardPreferences();
  expect(keyboard.actionFor(key("KeyR", "r"), false)).toBe("production-4");
  expect(keyboard.actionFor(key("KeyR", "r"), true)).toBe("rotate");
  expect(keyboard.actionFor(key("KeyQ", "q"), true)).toBeUndefined();
  expect(keyboard.rebind("rotate", key("KeyQ", "q"))).toBeUndefined();
  expect(keyboard.rebind("attackMove", key("KeyQ", "q"))).toMatch(
    /Production slot 1/,
  );
  expect(keyboard.rebind("attackMove", key("Digit1", "1", true))).toMatch(
    /Add to group 1/,
  );
  expect(keyboard.rebind("attackMove", key("KeyR", "r", true, true))).toMatch(
    /reserved/,
  );
  expect(keyboard.rebind("attackMove", key("F5", "F5"))).toMatch(/reserved/);
  expect(keyboard.actionFor(key("KeyA", "a"), false)).toBe("attackMove");
});

test("device settings retain bindings, labels, and layout, and can reset", () => {
  const stored = new Map<string, string>();
  const storage = {
    read: (key: string) => stored.get(key) ?? null,
    write: (key: string, value: unknown) => {
      stored.set(key, JSON.stringify(value));
    },
  };
  const keyboard = createKeyboardPreferences(storage);
  expect(keyboard.label("attackMove")).toBe("A");
  keyboard.rebind("attackMove", key("KeyJ", "й"));
  keyboard.rebind("group-1-recall", key("KeyU", "г"));
  keyboard.rebind("idleAll", key("Slash", "?", true));
  let restored = createKeyboardPreferences(storage);
  expect(restored.label("idleAll")).toBe("Shift+/");
  expect(restored.label("attackMove")).toBe("Й");
  expect(restored.label("group-1-recall")).toBe("Г");
  expect(restored.actionFor(key("KeyU", "u"), false)).toBe("group-1-recall");
  restored.setLayout("qwerty");
  restored = createKeyboardPreferences(storage);
  expect(restored.label("attackMove")).toBe("J");
  restored.reset();
  const defaults = createKeyboardPreferences(storage);
  expect(defaults.layout()).toBe("auto");
  expect(defaults.label("attackMove")).toBe("A");
  expect(defaults.actionFor(key("Digit1", "1"), false)).toBe("group-1-recall");
});

test("automatic layout lookup uses per-key fallbacks and refreshes", async () => {
  let labels = new Map([["KeyA", "q"]]);
  const keyboard = createKeyboardPreferences(undefined, {
    getLayoutMap: async () => labels,
  });
  await keyboard.refreshLayout();
  expect(keyboard.label("attackMove")).toBe("Q");
  expect(keyboard.label("production-2")).toBe("W");
  labels = new Map([["KeyA", "a"]]);
  await keyboard.refreshLayout();
  expect(keyboard.label("attackMove")).toBe("A");
  const denied = createKeyboardPreferences(undefined, {
    getLayoutMap: async () => {
      throw new Error("Layout lookup denied");
    },
  });
  await denied.refreshLayout();
  expect(denied.label("attackMove")).toBe("A");
});

test("reserved modifiers cannot resolve a normal gameplay binding", () => {
  const keyboard = createKeyboardPreferences();
  const ordinary = key("KeyA", "a");
  expect(
    keyboard.actionFor({ ...ordinary, metaKey: true }, false),
  ).toBeUndefined();
  expect(
    keyboard.actionFor({ ...ordinary, altKey: true }, false),
  ).toBeUndefined();
});

test("aborted or unsubscribed listeners receive no updates", () => {
  const keyboard = createKeyboardPreferences();
  const controller = new AbortController();
  let calls = 0;
  const unsubscribe = keyboard.subscribe(() => calls++, controller.signal);
  expect(calls).toBe(1);
  unsubscribe();
  controller.abort();
  keyboard.subscribe(() => calls++, controller.signal);
  keyboard.reset();
  expect(calls).toBe(1);
});
