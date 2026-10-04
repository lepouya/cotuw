/** World input pauses for dialogs, hidden pages, and lost window focus. */
export function worldInputAvailable(document: Document | undefined): boolean {
  return (
    !document?.hidden &&
    document?.hasFocus?.() !== false &&
    !document?.querySelector("dialog[open]")
  );
}

/** Form fields and editable content own their keys. */
export function isTextEntry(element: unknown): boolean {
  const target = element as Partial<HTMLElement> | null | undefined;
  return (
    !!target?.isContentEditable ||
    !!target?.closest?.("input, textarea, select")
  );
}
