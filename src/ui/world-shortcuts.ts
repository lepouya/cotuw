import { isTextEntry, worldKeyboardAvailable } from "../render/input-focus";

/** Returns whether it handled the key, which ends the key's routing. */
export type WorldShortcutHandler = () => boolean;

/** Handlers by physical key (`KeyboardEvent.code`), in precedence order. */
export type WorldShortcuts = Readonly<
  Partial<Record<string, readonly WorldShortcutHandler[]>>
>;

/**
 * Routes unmodified, unrepeated world key presses to the first handler that
 * takes them. Dialogs and contextual UI handle their keys first, in the
 * capture phase, and form fields keep theirs. Returns a function that unbinds.
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
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      isTextEntry(event.target) ||
      !worldKeyboardAvailable(document)
    )
      return;
    if (shortcuts[event.code]?.some((handle) => handle()))
      event.preventDefault();
  };
  host?.addEventListener("keydown", key);
  return () => host?.removeEventListener("keydown", key);
}
