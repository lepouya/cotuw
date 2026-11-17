import { isTextEntry, worldKeyboardAvailable } from "../render/input-focus";

/** Returns whether it handled the key, which ends the key's routing. */
export type WorldShortcutHandler = (keys: { shiftKey: boolean }) => boolean;

/**
 * Handlers by physical key (`KeyboardEvent.code`), in precedence order.
 * `Control+` prefixes a code held with Control, on every platform.
 */
export type WorldShortcuts = Readonly<
  Partial<Record<string, readonly WorldShortcutHandler[]>>
>;

/**
 * Routes unrepeated world key presses, with or without Shift or Control, to
 * the first handler that takes them. Alt and Meta chords stay with the host.
 * Dialogs and contextual UI handle their keys first, in the capture phase,
 * and form fields keep theirs. Returns a function that unbinds.
 */
export function bindWorldShortcuts(
  document: Document,
  shortcuts: WorldShortcuts,
): () => void {
  const host = document.defaultView;
  const key = (event: KeyboardEvent) => {
    if (
      event.defaultPrevented ||
      event.repeat ||
      event.metaKey ||
      event.altKey ||
      isTextEntry(event.target) ||
      !worldKeyboardAvailable(document)
    )
      return;
    const code = event.ctrlKey ? `Control+${event.code}` : event.code;
    const keys = { shiftKey: event.shiftKey };
    if (shortcuts[code]?.some((handle) => handle(keys))) event.preventDefault();
  };
  host?.addEventListener("keydown", key);
  return () => host?.removeEventListener("keydown", key);
}
