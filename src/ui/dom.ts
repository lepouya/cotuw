/**
 * Replaces an element's text only when it differs, so unchanged nodes keep
 * their selection, focus, and screen-reader position.
 */
export function setText(element: HTMLElement | undefined, text: string) {
  if (element && element.textContent !== text) element.textContent = text;
}
