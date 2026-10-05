/** Dialogs, menus and visible `data-world-input-blocking` popups own input. */
export function worldInputAvailable(document: Document | undefined): boolean {
  return (
    !document?.hidden &&
    document?.hasFocus?.() !== false &&
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
