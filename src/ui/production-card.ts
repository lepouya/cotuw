import { createActorPortrait } from "./actor-portrait";

import type { ActorDefinition } from "../simulation/actor";
import type { DefinitionButton } from "./production-action";

let nextDescriptionId = 0;

/** A picture card whose details and reason share one hover or focus tooltip. */
export type ProductionCard = DefinitionButton & {
  card: HTMLElement;
  explain: NonNullable<DefinitionButton["explain"]>;
};

/** Creates production cards under `root` and their shared tooltip. */
export function createProductionCards(root: HTMLElement, parent: AbortSignal) {
  const document = root.ownerDocument;
  const window = document.defaultView!;
  const controller = new AbortController();
  const { signal } = controller;
  const tooltip = document.createElement("div");
  tooltip.className = "production-tooltip";
  tooltip.setAttribute("role", "tooltip");
  tooltip.hidden = true;
  document.body.append(tooltip);
  let active: { card: HTMLElement; text: () => string } | undefined;
  let touchInput = false;
  let hideTimer: number | undefined;
  const cancelHide = () => {
    window.clearTimeout(hideTimer);
    hideTimer = undefined;
  };
  const hide = () => {
    cancelHide();
    tooltip.hidden = true;
    active = undefined;
  };
  const show = (shown: NonNullable<typeof active>) => {
    if (signal.aborted || shown.card.hidden) return;
    cancelHide();
    active = shown;
    tooltip.textContent = shown.text();
    tooltip.hidden = false;
    const bounds = shown.card.getBoundingClientRect();
    const rootBounds = root.getBoundingClientRect();
    tooltip.style.left = `${Math.max(8, Math.min(rootBounds.right + 8, window.innerWidth - tooltip.offsetWidth - 8))}px`;
    tooltip.style.top = `${Math.max(8, Math.min(bounds.top, window.innerHeight - tooltip.offsetHeight - 8))}px`;
  };
  const leave = () => {
    cancelHide();
    // Allow crossing the gap between a card and its tooltip.
    hideTimer = window.setTimeout(hide, 150);
  };
  root.addEventListener(
    "scroll",
    () => {
      // Keyboard focus can scroll a card into view after its tooltip opens.
      if (active?.card.contains(document.activeElement)) show(active);
      else hide();
    },
    { signal, capture: true },
  );
  document.addEventListener(
    "keydown",
    (event) => {
      touchInput = false;
      if (event.key !== "Escape" || !active) return;
      hide();
      event.preventDefault();
      event.stopPropagation();
    },
    { signal, capture: true },
  );
  const contains = (element: HTMLElement, target: EventTarget | null) =>
    target instanceof Node && element.contains(target);
  document.addEventListener(
    "focusin",
    (event) => {
      if (
        active &&
        !contains(root, event.target) &&
        !contains(tooltip, event.target)
      )
        hide();
    },
    { signal },
  );
  tooltip.addEventListener("pointerenter", cancelHide, { signal });
  window.addEventListener("resize", hide, { signal });
  window.addEventListener("blur", hide, { signal });
  document.addEventListener(
    "pointerdown",
    (event) => {
      touchInput = event.pointerType === "touch";
      if (
        active &&
        !contains(active.card, event.target) &&
        !contains(tooltip, event.target)
      )
        hide();
    },
    { signal, capture: true },
  );
  tooltip.addEventListener(
    "pointerleave",
    (event) => {
      if (
        active &&
        !active.card.contains(document.activeElement) &&
        !contains(active.card, event.relatedTarget)
      )
        leave();
    },
    { signal },
  );
  const dispose = () => {
    hide();
    controller.abort();
    tooltip.remove();
  };
  parent.addEventListener("abort", dispose, { signal, once: true });
  if (parent.aborted) dispose();
  return {
    create: (
      container: HTMLElement,
      action: { id: string; label: string },
      definition: ActorDefinition,
      content: { name: string; details: string; cost?: number },
    ): ProductionCard => {
      const card = document.createElement("div");
      card.className = "production-card";
      const button = document.createElement("button");
      button.type = "button";
      button.id = action.id;
      button.className = "build-option";
      button.setAttribute("aria-label", action.label);
      const label = document.createElement("strong");
      label.textContent = content.name;
      button.append(createActorPortrait(definition), label);
      if (content.cost !== undefined) {
        const cost = document.createElement("span");
        cost.className = "option-cost";
        cost.textContent = `${content.cost} Materials`;
        button.append(cost);
      }
      const description = document.createElement("span");
      description.className = "sr-only";
      do {
        description.id = `production-description-${++nextDescriptionId}`;
      } while (
        description.id === button.id ||
        document.getElementById(description.id)
      );
      description.textContent = content.details;
      button.setAttribute("aria-describedby", description.id);
      card.setAttribute("role", "group");
      card.setAttribute("aria-label", action.label);
      card.setAttribute("aria-describedby", description.id);
      card.append(button, description);
      container.append(card);
      const shown = {
        card,
        text: () => `${content.name}. ${description.textContent}`,
      };
      card.addEventListener(
        "pointerenter",
        (event) => {
          if (event.pointerType === "touch") return;
          touchInput = false;
          show(shown);
        },
        { signal },
      );
      card.addEventListener(
        "focusin",
        () => {
          if (!touchInput) show(shown);
        },
        { signal },
      );
      card.addEventListener(
        "pointerdown",
        (event) => {
          if (event.pointerType === "touch") {
            if (button.disabled) {
              card.focus({ preventScroll: true });
              show(shown);
            } else hide();
          }
        },
        { signal },
      );
      card.addEventListener(
        "pointerleave",
        (event) => {
          if (
            event.pointerType !== "touch" &&
            active === shown &&
            !card.contains(document.activeElement) &&
            !contains(tooltip, event.relatedTarget)
          )
            leave();
        },
        { signal },
      );
      card.addEventListener(
        "focusout",
        (event) => {
          if (
            active === shown &&
            !card.matches(":hover") &&
            !contains(tooltip, event.relatedTarget)
          )
            hide();
        },
        { signal },
      );
      card.addEventListener(
        "click",
        (event) => {
          // The action can disable its button before this event bubbles.
          if (contains(button, event.target)) hide();
        },
        { signal },
      );
      return {
        definitionId: definition.id,
        button,
        card,
        explain: (reason, hadFocus = false) => {
          // Disabled buttons cannot take focus, so their card does instead.
          card.tabIndex = button.disabled ? 0 : -1;
          const text = reason
            ? `${content.details} · ${reason}`
            : content.details;
          if (description.textContent !== text) {
            description.textContent = text;
            if (active === shown) show(shown);
          }
          if (button.disabled && hadFocus) card.focus({ preventScroll: true });
          else if (!button.disabled && document.activeElement === card)
            button.focus({ preventScroll: true });
        },
      };
    },
    /** Hides the tooltip if it belongs to `card`, or always without one. */
    hide: (card?: HTMLElement) => {
      if (!card || active?.card === card) hide();
    },
    dispose,
  };
}
