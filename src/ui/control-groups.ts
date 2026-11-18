import { GROUP_SHORTCUTS } from "./keyboard-preferences";
import { createShortcutHint } from "./shortcut-hint";
import type { KeyboardBindings } from "./keyboard-preferences";
import { compareIds } from "../simulation/actor";
import { CONTROL_GROUP_SLOTS } from "../simulation/mission-file";
import { createButton, createElement as el, setText } from "./dom";

import type {
  ControlGroupSlot,
  MissionUiState,
} from "../simulation/mission-file";

/** A second recall of the same group within this time also focuses it. */
const REPEAT_RECALL_MILLISECONDS = 500;

const unitCount = (count: number) => `${count} unit${count === 1 ? "" : "s"}`;

const GROUP_ACTIONS = [
  {
    id: "assign",
    label: "Assign",
    prompt: (count: number) =>
      `Choose a group to hold the ${unitCount(count)} selected.`,
  },
  {
    id: "add",
    label: "Add",
    prompt: (count: number) =>
      `Choose a group to add the ${unitCount(count)} selected.`,
  },
  { id: "clear", label: "Clear", prompt: () => "Choose a group to clear." },
] as const;
type GroupAction = (typeof GROUP_ACTIONS)[number]["id"];

export type ControlGroupElements = {
  toggle: HTMLButtonElement;
  panel: HTMLElement;
  slots: readonly {
    slot: ControlGroupSlot;
    button: HTMLButtonElement;
    count: HTMLElement;
  }[];
  actions: readonly { id: GroupAction; button: HTMLButtonElement }[];
  status: HTMLElement;
};

export function createControlGroupPanel(
  preferences: KeyboardBindings,
  signal: AbortSignal,
): ControlGroupElements {
  const toggle = createButton("Groups", {
    id: "toggle-control-groups",
    "aria-expanded": "false",
    "aria-controls": "control-groups",
  });
  const slots = CONTROL_GROUP_SLOTS.map((slot) => {
    const count = el("small", { "aria-hidden": "true" });
    const button = el(
      "button",
      { type: "button", id: `control-group-${slot}`, disabled: true },
      slot,
      count,
    );
    const hint = createShortcutHint(button);
    const bindings = GROUP_SHORTCUTS.filter(
      (shortcut) => shortcut.slot === slot,
    );
    preferences.subscribe(() => {
      hint(preferences.label(bindings[0]!.id));
      button.title = bindings
        .map(({ name, id }) => `${name} · ${preferences.label(id)}`)
        .join("\n");
    }, signal);
    return { slot, button, count };
  });
  const actions = GROUP_ACTIONS.map(({ id, label }) => ({
    id,
    button: createButton(label, {
      id: `control-group-${id}`,
      "aria-pressed": "false",
      disabled: true,
    }),
  }));
  const status = el("p", {
    id: "control-group-status",
    class: "muted",
    role: "status",
  });
  const panel = el(
    "section",
    { id: "control-groups", "aria-label": "Control groups", hidden: true },
    el(
      "div",
      { class: "group-slots", role: "group", "aria-label": "Group slots" },
      ...slots.map(({ button }) => button),
    ),
    el(
      "div",
      { class: "action-row", role: "group", "aria-label": "Group actions" },
      ...actions.map(({ button }) => button),
    ),
    status,
  );
  return { toggle, panel, slots, actions, status };
}

/** Ten player-assigned unit groups, kept outside the simulation. */
export function createControlGroups(saved?: MissionUiState["controlGroups"]) {
  const groups = new Map<ControlGroupSlot, readonly string[]>();
  const members = (slot: ControlGroupSlot) => groups.get(slot) ?? [];
  const set = (slot: ControlGroupSlot, ids: Iterable<string>) => {
    const next = [...new Set(ids)].sort(compareIds);
    if (next.length) groups.set(slot, next);
    else groups.delete(slot);
  };
  for (const slot of CONTROL_GROUP_SLOTS) set(slot, saved?.[slot] ?? []);
  return {
    members,
    empty: () => !groups.size,
    assign: set,
    add: (slot: ControlGroupSlot, ids: readonly string[]) =>
      set(slot, [...members(slot), ...ids]),
    clear: (slot: ControlGroupSlot) => groups.delete(slot),
    /** Drops members `keep` rejects; returns whether any were dropped. */
    retain: (keep: (id: string) => boolean) => {
      let changed = false;
      for (const [slot, ids] of groups) {
        const kept = ids.filter(keep);
        if (kept.length === ids.length) continue;
        if (kept.length) groups.set(slot, kept);
        else groups.delete(slot);
        changed = true;
      }
      return changed;
    },
    /** What a save keeps; nothing while every group is empty. */
    uiState: (): Pick<MissionUiState, "controlGroups"> | undefined =>
      groups.size
        ? {
            controlGroups: Object.fromEntries(
              [...groups].map(([slot, ids]) => [slot, [...ids]]),
            ),
          }
        : undefined,
  };
}

/**
 * Keyboard and Groups panel actions. Panel Assign, Add, and Clear apply to
 * the next group chosen; recall replaces selection without moving the camera.
 */
export function createControlGroupControls(
  elements: ControlGroupElements | undefined,
  {
    saved,
    commands,
    selectedIds,
    select,
    focus,
    enabled,
    changed,
    now = () => performance.now(),
  }: {
    saved?: MissionUiState["controlGroups"];
    /** Whether the player still commands this mobile unit. */
    commands: (id: string) => boolean;
    selectedIds: () => readonly string[];
    select: (ids: readonly string[]) => void;
    focus: (ids: readonly string[]) => void;
    enabled: () => boolean;
    changed: () => void;
    now?: () => number;
  },
) {
  const groups = createControlGroups(saved);
  groups.retain(commands);
  const controller = new AbortController();
  let mode: GroupAction | undefined;
  let feedback = "";
  let lastRecall: { slot: ControlGroupSlot; time: number } | undefined;
  const setMode = (next?: GroupAction, text = "") => {
    mode = next;
    feedback = text;
    lastRecall = undefined;
    changed();
  };
  const cancelMode = () => {
    lastRecall = undefined;
    if (!mode) return false;
    setMode();
    return true;
  };
  const setPanelOpen = (open: boolean) => {
    if (!elements) return;
    elements.panel.hidden = !open;
    elements.toggle.setAttribute("aria-expanded", String(open));
    if (!open) setMode();
  };
  const close = () => {
    lastRecall = undefined;
    if (!elements || elements.panel.hidden) return false;
    setPanelOpen(false);
    return true;
  };
  const escape = () => {
    if (cancelMode()) return true;
    if (!close()) return false;
    elements?.toggle.focus({ preventScroll: true });
    return true;
  };
  const retain = () => {
    if (groups.retain(commands)) changed();
  };
  const selectedUnits = () => selectedIds().filter(commands);
  const recallGroup = (slot: ControlGroupSlot) => {
    const ids = groups.members(slot).filter(commands);
    const previous = lastRecall;
    lastRecall = undefined;
    if (!ids.length) return false;
    select(ids);
    const time = now();
    if (
      previous?.slot === slot &&
      time - previous.time <= REPEAT_RECALL_MILLISECONDS
    )
      focus(ids);
    else lastRecall = { slot, time };
    return true;
  };
  const store = (slot: ControlGroupSlot, action: "assign" | "add") => {
    if (!enabled()) return false;
    const ids = selectedUnits();
    if (!ids.length) return false;
    retain();
    groups[action](slot, ids);
    setMode(
      undefined,
      `Group ${slot} holds ${unitCount(groups.members(slot).length)}.`,
    );
    return true;
  };
  /** Applies a pending panel action to the group, or recalls it. */
  const recall = (slot: ControlGroupSlot) => {
    if (!enabled()) return false;
    if (mode === "clear") {
      if (!groups.clear(slot)) return false;
      setMode(undefined, `Group ${slot} cleared.`);
      return true;
    }
    return mode ? store(slot, mode) : recallGroup(slot);
  };
  const applicable = (action: GroupAction, count: number) =>
    action === "clear" ? !groups.empty() : count > 0;
  const listen = { signal: controller.signal };
  if (elements) {
    elements.toggle.addEventListener(
      "click",
      () => {
        if (enabled()) setPanelOpen(!!elements.panel.hidden);
      },
      listen,
    );
    for (const { slot, button } of elements.slots)
      button.addEventListener("click", () => recall(slot), listen);
    for (const { id, button } of elements.actions)
      button.addEventListener(
        "click",
        () => {
          if (enabled() && applicable(id, selectedUnits().length))
            setMode(mode === id ? undefined : id);
        },
        listen,
      );
  }
  return {
    recall,
    store,
    close,
    escape,
    /** Drops members the player no longer commands. */
    retain,
    uiState: () => {
      retain();
      return groups.uiState();
    },
    refresh: () => {
      if (!elements) return;
      const active = enabled();
      elements.toggle.disabled = !active;
      const selectedCount = selectedUnits().length;
      if (mode && (!active || !applicable(mode, selectedCount))) {
        mode = undefined;
        feedback = "";
      }
      const storing = mode === "assign" || mode === "add";
      for (const { slot, button, count } of elements.slots) {
        const size = groups.members(slot).length;
        setText(count, size ? String(size) : "");
        const label = `Group ${slot}, ${size ? unitCount(size) : "empty"}`;
        if (button.getAttribute("aria-label") !== label)
          button.setAttribute("aria-label", label);
        button.disabled = !active || (!storing && !size);
      }
      for (const { id, button } of elements.actions) {
        const pressed = String(mode === id);
        if (button.getAttribute("aria-pressed") !== pressed)
          button.setAttribute("aria-pressed", pressed);
        button.disabled = !active || !applicable(id, selectedCount);
      }
      const action = GROUP_ACTIONS.find(({ id }) => id === mode);
      setText(elements.status, action?.prompt(selectedCount) ?? feedback);
    },
    dispose: () => controller.abort(),
  };
}
