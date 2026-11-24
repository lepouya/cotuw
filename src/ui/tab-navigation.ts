const TAB_MOVES = new Map<string, (index: number, count: number) => number>([
  ["ArrowRight", (index, count) => (index + 1) % count],
  ["ArrowLeft", (index, count) => (index + count - 1) % count],
  ["Home", () => 0],
  ["End", (_index, count) => count - 1],
]);

/** Binds keyboard focus and automatic activation for a horizontal tab list. */
export function bindTabNavigation(
  list: HTMLElement,
  buttons: readonly HTMLButtonElement[],
  activate: (index: number) => void,
  signal: AbortSignal,
) {
  list.addEventListener(
    "keydown",
    (event) => {
      const move = TAB_MOVES.get(event.key);
      if (!move) return;
      const index = buttons.findIndex((button) => button === event.target);
      if (index < 0) return;
      event.preventDefault();
      const next = move(index, buttons.length);
      activate(next);
      buttons[next]!.focus();
    },
    { signal },
  );
}
