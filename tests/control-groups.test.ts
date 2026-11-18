import { expect, test, vi } from "vitest";

import { CONTROL_GROUP_SLOTS } from "../src/simulation/mission-file";
import {
  createControlGroupControls,
  createControlGroups,
} from "../src/ui/control-groups";

import type { ControlGroupSlot } from "../src/simulation/mission-file";

test("groups hold sorted distinct members and save only non-empty groups", () => {
  const groups = createControlGroups({ "1": ["b", "a"], "0": [] });
  expect(groups.members("1")).toEqual(["a", "b"]);
  groups.add("1", ["c", "a"]);
  // A unit may belong to several groups.
  groups.assign("2", ["a"]);
  expect(groups.uiState()).toEqual({
    controlGroups: { "1": ["a", "b", "c"], "2": ["a"] },
  });
  expect(groups.retain((id) => id !== "a")).toBe(true);
  expect(groups.retain(() => true)).toBe(false);
  expect(groups.uiState()).toEqual({ controlGroups: { "1": ["b", "c"] } });
  groups.clear("1");
  expect(groups.uiState()).toBeUndefined();
});

function fixture(saved?: Partial<Record<ControlGroupSlot, string[]>>) {
  /** Enough of a button for the binder to render state and handle clicks. */
  const button = () => {
    const attributes = new Map<string, string>();
    const target = Object.assign(new EventTarget(), {
      disabled: false,
      textContent: "",
      setAttribute: (name: string, value: string) =>
        attributes.set(name, value),
      getAttribute: (name: string) => attributes.get(name) ?? null,
      focus: vi.fn(),
    });
    const node = Object.assign(target, {
      click: () => {
        if (!node.disabled) target.dispatchEvent(new Event("click"));
      },
    });
    return node as unknown as HTMLButtonElement;
  };
  const toggle = button();
  const panel = { hidden: true } as HTMLElement;
  const slots = CONTROL_GROUP_SLOTS.map((slot) => ({
    slot,
    button: button(),
    count: { textContent: "" } as HTMLElement,
  }));
  const actions = (["assign", "add", "clear"] as const).map((id) => ({
    id,
    button: button(),
  }));
  const status = { textContent: "" } as HTMLElement;
  const elements = { toggle, panel, slots, actions, status };
  const state = {
    commanded: new Set(["u1", "u2", "u3"]),
    selected: [] as string[],
    enabled: true,
    time: 0,
  };
  const select = vi.fn((ids: readonly string[]) => {
    state.selected = [...ids];
  });
  const focus = vi.fn();
  const controls = createControlGroupControls(elements, {
    saved,
    commands: (id) => state.commanded.has(id),
    selectedIds: () => state.selected,
    select,
    focus,
    enabled: () => state.enabled,
    changed: () => controls?.refresh(),
    now: () => state.time,
  });
  controls.refresh();
  const group = (slot: ControlGroupSlot) =>
    slots.find((entry) => entry.slot === slot)!;
  const action = (id: (typeof actions)[number]["id"]) =>
    actions.find((entry) => entry.id === id)!.button;
  return { controls, elements, state, select, focus, group, action };
}

test("loading keeps only members the player still commands", () => {
  const { controls } = fixture({ "3": ["u1", "lost", "captured"] });
  expect(controls.uiState()).toEqual({ controlGroups: { "3": ["u1"] } });
});

test("assignment, addition, and recall; repeated recall focuses", () => {
  const { controls, state, select, focus } = fixture();
  expect(controls.recall("1")).toBe(false);
  expect(controls.store("1", "assign")).toBe(false);
  state.selected = ["u2", "u1"];
  expect(controls.store("1", "assign")).toBe(true);
  state.selected = ["u3"];
  expect(controls.store("1", "add")).toBe(true);
  state.selected = [];
  state.time = 1000;
  expect(controls.recall("1")).toBe(true);
  expect(select).toHaveBeenLastCalledWith(["u1", "u2", "u3"]);
  expect(focus).not.toHaveBeenCalled();
  state.time = 1400;
  controls.recall("1");
  expect(focus).toHaveBeenCalledWith(["u1", "u2", "u3"]);
  // A slow repeat recalls without focusing.
  state.time = 3000;
  controls.recall("1");
  expect(focus).toHaveBeenCalledTimes(1);
  // Destroyed members drop out; nothing joins the group automatically.
  state.commanded.delete("u2");
  state.commanded.add("u4");
  expect(controls.uiState()).toEqual({ controlGroups: { "1": ["u1", "u3"] } });
  expect(controls.recall("4")).toBe(false);
  controls.recall("1");
  expect(select).toHaveBeenLastCalledWith(["u1", "u3"]);
  expect(focus).toHaveBeenCalledTimes(1);
  state.enabled = false;
  expect(controls.recall("1")).toBe(false);
});

test("panel modes apply to the next chosen group", () => {
  const { elements, state, select, controls, group, action } = fixture({
    "2": ["u3"],
  });
  const { status, toggle } = elements;
  const first = group("1");
  const second = group("2");
  const assign = action("assign");
  const add = action("add");
  const clear = action("clear");
  toggle.click();
  expect(first.button.disabled).toBe(true);
  expect(second.button.disabled).toBe(false);
  expect(second.button.getAttribute("aria-label")).toBe("Group 2, 1 unit");
  expect(assign.disabled).toBe(true);
  state.selected = ["u1", "u2"];
  controls.refresh();
  assign.click();
  expect(assign.getAttribute("aria-pressed")).toBe("true");
  expect(status.textContent).toBe(
    "Choose a group to hold the 2 units selected.",
  );
  state.selected = ["u1"];
  controls.refresh();
  expect(status.textContent).toBe(
    "Choose a group to hold the 1 unit selected.",
  );
  state.selected = ["u1", "u2"];
  // Empty groups accept assignments.
  expect(first.button.disabled).toBe(false);
  first.button.click();
  expect(assign.getAttribute("aria-pressed")).toBe("false");
  expect(status.textContent).toBe("Group 1 holds 2 units.");
  expect(first.count.textContent).toBe("2");
  add.click();
  second.button.click();
  expect(status.textContent).toBe("Group 2 holds 3 units.");
  clear.click();
  first.button.click();
  expect(status.textContent).toBe("Group 1 cleared.");
  expect(first.button.getAttribute("aria-label")).toBe("Group 1, empty");
  second.button.click();
  expect(select).toHaveBeenLastCalledWith(["u1", "u2", "u3"]);
  // Escape leaves a pending mode before reaching selection.
  add.click();
  expect(controls.escape()).toBe(true);
  expect(elements.panel.hidden).toBe(false);
  expect(status.textContent).toBe("");
  // A mode ends once it can no longer apply.
  assign.click();
  state.selected = [];
  controls.refresh();
  expect(assign.getAttribute("aria-pressed")).toBe("false");
  expect(controls.escape()).toBe(true);
  expect(elements.panel.hidden).toBe(true);
  expect(controls.escape()).toBe(false);
});

test("direct group recall applies a pending panel action", () => {
  const { controls, elements, state, select, action } = fixture({
    "5": ["u3"],
  });
  elements.toggle.click();
  state.selected = ["u1"];
  controls.refresh();
  action("assign").click();
  expect(controls.recall("4")).toBe(true);
  expect(select).not.toHaveBeenCalled();
  expect(action("assign").getAttribute("aria-pressed")).toBe("false");
  action("clear").click();
  expect(controls.recall("6")).toBe(false);
  expect(controls.recall("5")).toBe(true);
  expect(controls.uiState()).toEqual({ controlGroups: { "4": ["u1"] } });
});
