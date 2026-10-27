import type { ContextAction, ContextActionKind } from "../render/command-input";

/** Distance from the menu center to each action, in CSS pixels. */
const RADIUS = 64;
const EDGE_MARGIN = 8;

// Shape as well as color tells the actions apart.
const ICONS: Record<ContextActionKind, string> = {
  tend: "❧",
  attack: "⚔",
  select: "◉",
  add: "+",
  remove: "−",
  move: "➜",
  "attack-move": "⚔➜",
  clear: "✕",
  focus: "⌖",
  follow: "⤳",
};

/** Actions ringed around a world point; Escape or a press outside closes. */
export function createRadialMenu(
  host: HTMLElement,
  /** The world view, which regains focus when the menu closes. */
  returnFocus?: HTMLElement,
) {
  const menu = document.createElement("div");
  menu.className = "radial-menu";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", "Context actions");
  menu.hidden = true;
  host.append(menu);
  const controller = new AbortController();
  const signal = controller.signal;
  const fit = () => {
    const bounds = [...menu.children].map((item) =>
      item.getBoundingClientRect(),
    );
    const offset = (low: number, high: number, size: number) =>
      Math.max(EDGE_MARGIN - low, Math.min(0, size - EDGE_MARGIN - high));
    const left = Math.min(...bounds.map(({ left }) => left));
    const right = Math.max(...bounds.map(({ right }) => right));
    const top = Math.min(...bounds.map(({ top }) => top));
    const bottom = Math.max(...bounds.map(({ bottom }) => bottom));
    menu.style.left = `${parseFloat(menu.style.left) + offset(left, right, window.innerWidth)}px`;
    menu.style.top = `${parseFloat(menu.style.top) + offset(top, bottom, window.innerHeight)}px`;
  };
  const close = () => {
    if (menu.hidden) return false;
    menu.hidden = true;
    menu.replaceChildren();
    return true;
  };
  const button = (className: string, run: () => void) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = className;
    item.tabIndex = className.includes("radial-default") ? 0 : -1;
    item.setAttribute("role", "menuitem");
    item.addEventListener("click", () => {
      close();
      returnFocus?.focus({ preventScroll: true });
      run();
    });
    return item;
  };
  window.addEventListener(
    "keydown",
    (event) => {
      if (menu.hidden) return;
      if (event.key === "Tab") {
        close();
        returnFocus?.focus({ preventScroll: true });
        return;
      }
      if (event.key === "Escape") {
        close();
        returnFocus?.focus({ preventScroll: true });
      } else {
        const buttons = [...menu.querySelectorAll<HTMLButtonElement>("button")];
        const current = buttons.indexOf(
          document.activeElement as HTMLButtonElement,
        );
        const next = {
          ArrowDown: (current + 1) % buttons.length,
          ArrowRight: (current + 1) % buttons.length,
          ArrowUp: (current + buttons.length - 1) % buttons.length,
          ArrowLeft: (current + buttons.length - 1) % buttons.length,
          Home: 0,
          End: buttons.length - 1,
        }[event.key];
        if (next === undefined || !menu.contains(event.target as Node)) return;
        buttons[next]?.focus({ preventScroll: true });
      }
      event.preventDefault();
      event.stopImmediatePropagation();
    },
    { capture: true, signal },
  );
  window.addEventListener(
    "pointerdown",
    (event) => {
      if (menu.contains(event.target as Node) || !close()) return;
      // Closing by pressing the world issues no command there.
      if (event.target === returnFocus) event.stopPropagation();
    },
    { capture: true, signal },
  );
  for (const type of ["blur", "wheel", "resize"])
    window.addEventListener(type, close, { signal });
  document.addEventListener("visibilitychange", close, { signal });
  return {
    show: (
      clientX: number,
      clientY: number,
      actions: readonly ContextAction[],
    ) => {
      close();
      const x = Math.min(
        Math.max(clientX, EDGE_MARGIN),
        window.innerWidth - EDGE_MARGIN,
      );
      const y = Math.min(
        Math.max(clientY, EDGE_MARGIN),
        window.innerHeight - EDGE_MARGIN,
      );
      menu.style.left = `${x}px`;
      menu.style.top = `${y}px`;
      actions.forEach((action, index) => {
        // The default action sits at the top; the rest follow clockwise.
        const angle = (index / actions.length) * 2 * Math.PI;
        const item = button(
          `radial-action${index === 0 ? " radial-default" : ""}`,
          action.run,
        );
        item.dataset.contextAction = action.kind;
        const icon = document.createElement("span");
        icon.setAttribute("aria-hidden", "true");
        icon.textContent = ICONS[action.kind];
        item.append(icon, action.label);
        item.style.transform = `translate(-50%, -50%) translate(${Math.sin(angle) * RADIUS}px, ${-Math.cos(angle) * RADIUS}px)`;
        menu.append(item);
      });
      const cancel = button("radial-cancel", () => {});
      cancel.textContent = "✕";
      cancel.setAttribute("aria-label", "Close menu");
      menu.append(cancel);
      menu.hidden = false;
      fit();
      menu.querySelector<HTMLButtonElement>(".radial-default")?.focus({
        preventScroll: true,
      });
    },
    close,
    dispose: () => {
      controller.abort();
      menu.remove();
    },
  };
}
