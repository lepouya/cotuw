import { isTextEntry, worldKeyboardAvailable } from "../render/input-focus";

/** Fixed actions by physical key, ordered by which action gets first use. */
export type WorldShortcuts = Readonly<
  Partial<Record<string, readonly (() => boolean)[]>>
>;

/** Applies the world input guard before fixed keys and gameplay bindings. */
export function bindWorldShortcuts(
  document: Document,
  shortcuts: WorldShortcuts,
  gameplay?: (event: KeyboardEvent) => boolean,
): () => void {
  const host = document.defaultView;
  const key = (event: KeyboardEvent) => {
    if (
      event.defaultPrevented ||
      event.repeat ||
      event.isComposing ||
      event.metaKey ||
      event.altKey ||
      isTextEntry(event.target) ||
      !worldKeyboardAvailable(document)
    )
      return;
    const fixed =
      !event.ctrlKey && shortcuts[event.code]?.some((handle) => handle());
    if (fixed || gameplay?.(event)) event.preventDefault();
  };
  host?.addEventListener("keydown", key);
  return () => host?.removeEventListener("keydown", key);
}
