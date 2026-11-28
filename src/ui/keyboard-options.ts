import {
  createButton,
  createElement as el,
  mountFeature,
  setText,
} from "./dom";
import {
  hostShortcut,
  KEYBOARD_LAYOUTS,
  SHORTCUT_SECTIONS,
} from "./keyboard-preferences";
import type { KeyboardPreferences } from "./keyboard-preferences";
import "./keyboard-options.css";

export function createKeyboardOptions(
  root: HTMLElement,
  preferences: KeyboardPreferences,
) {
  return mountFeature(root, "", ({ signal }) => {
    const layout = el(
      "select",
      { id: "keyboard-layout" },
      ...Object.entries(KEYBOARD_LAYOUTS).map(([value, name]) =>
        el("option", { value }, name),
      ),
    );
    const status = el("p", { role: "status", class: "muted keyboard-status" });
    const reset = createButton("Reset keyboard defaults");
    const rows = SHORTCUT_SECTIONS.map(({ name, shortcuts }, index) => {
      const bindings = shortcuts.map(({ id, name }) => {
        const button = createButton("", { "aria-label": `Rebind ${name}` });
        const element = el(
          "div",
          { class: "keyboard-binding" },
          el("span", {}, name),
          button,
        );
        return { id, name, button, element };
      });
      return {
        bindings,
        details: el(
          "details",
          { open: index === 0 },
          el("summary", {}, name),
          ...bindings.map(({ element }) => element),
        ),
      };
    });
    const bindings = rows.flatMap(({ bindings }) => bindings);
    const listen = { signal };
    let recording: (typeof bindings)[number] | undefined;
    function refresh() {
      layout.value = preferences.layout();
      for (const row of bindings) {
        const label =
          row === recording ? "Press a key…" : preferences.label(row.id);
        setText(row.button, label);
        row.button.setAttribute("aria-label", `Rebind ${row.name} (${label})`);
      }
    }
    function cancel() {
      if (!recording) return;
      recording = undefined;
      setText(status, "");
      refresh();
    }
    for (const row of bindings) {
      row.button.addEventListener(
        "click",
        () => {
          row.button.focus();
          recording = row;
          row.element.after(status);
          setText(status, `Press a key for ${row.name}, or Escape to cancel.`);
          refresh();
        },
        listen,
      );
      row.button.addEventListener("blur", cancel, listen);
      row.button.addEventListener(
        "keydown",
        (event) => {
          if (recording !== row) return;
          if (event.key === "Tab") {
            cancel();
            return;
          }
          const reserved = hostShortcut(event);
          if (!reserved) {
            event.preventDefault();
            event.stopPropagation();
          }
          if (event.repeat || event.isComposing) return;
          if (!reserved && event.code === "Escape") {
            cancel();
            return;
          }
          if (/^(Shift|Control|Meta|Alt|OS)(Left|Right)$/.test(event.code))
            return;
          const reason = preferences.rebind(row.id, event);
          if (reason) setText(status, reason);
          else {
            cancel();
            setText(
              status,
              `${row.name} bound to ${preferences.label(row.id)}.`,
            );
          }
        },
        listen,
      );
    }
    layout.addEventListener(
      "change",
      () => {
        preferences.setLayout(layout.value as keyof typeof KEYBOARD_LAYOUTS);
        setText(status, "");
      },
      listen,
    );
    reset.addEventListener(
      "click",
      () => {
        preferences.reset();
        reset.after(status);
        setText(status, "Keyboard defaults restored.");
      },
      listen,
    );
    root.append(
      el("h3", { class: "section-label" }, "Keyboard"),
      el("label", { for: layout.id }, "Keyboard layout"),
      layout,
      el(
        "p",
        { class: "muted" },
        "Without automatic labels, choose a layout or record a key to label it.",
      ),
      ...rows.map(({ details }) => details),
      reset,
      status,
    );
    preferences.subscribe(refresh, signal);
    return { cancel };
  });
}
