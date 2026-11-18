import { createElement as el } from "./dom";
import type { KeyboardBindings, ShortcutId } from "./keyboard-preferences";
import "./shortcut-hint.css";

export function createShortcutHint(host: HTMLElement, container = host) {
  const hint = el("kbd", {
    class: "shortcut-hint",
    "aria-hidden": "true",
    hidden: true,
  });
  container.append(hint);
  return (label: string) => {
    if ((hint.dataset.key ?? "") === label) return;
    hint.hidden = !label;
    hint.dataset.key = label;
    if (!label) {
      host.removeAttribute("aria-keyshortcuts");
      return;
    }
    let spoken = label.replace(/^Ctrl\+/, "Control+");
    if (spoken === "Esc") spoken = "Escape";
    if (spoken.endsWith("+")) spoken = `${spoken.slice(0, -1)}Plus`;
    host.setAttribute("aria-keyshortcuts", spoken);
  };
}

export function bindShortcutHint(
  host: HTMLElement,
  preferences: KeyboardBindings,
  action: ShortcutId,
  signal: AbortSignal,
) {
  const set = createShortcutHint(host);
  preferences.subscribe(() => set(preferences.label(action)), signal);
}
