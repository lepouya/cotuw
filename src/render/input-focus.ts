/** Pointer and continuous input need focus and an uncovered world. */
export function worldInputAvailable(document: Document | undefined): boolean {
  return document?.hasFocus?.() !== false && worldKeyboardAvailable(document);
}

/** Use for delivered keys; browsers can misreport document focus. */
export function worldKeyboardAvailable(
  document: Document | undefined,
): boolean {
  return (
    !document?.hidden &&
    !document?.querySelector(
      'dialog[open], [role="menu"]:not([hidden]), [data-world-input-blocking]:not([hidden])',
    )
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
