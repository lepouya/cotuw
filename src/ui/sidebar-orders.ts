import { isMobileActor } from "../simulation/placement";
import { createButton, createElement as el, setText } from "./dom";
import { ordersLocked } from "./sidebar-context";
import type { SidebarContext, SidebarState } from "./sidebar-context";
import "./sidebar-orders.css";

export function createSidebarOrders({ definitionById, owns }: SidebarContext) {
  const rotateBuilding = createButton("Rotate 90° (R)", {
    id: "rotate-building",
    disabled: true,
  });
  const confirmBuilding = createButton("Place building", {
    id: "confirm-building",
    disabled: true,
  });
  const cancelBuilding = createButton("Cancel (Esc)", {
    id: "cancel-building",
    disabled: true,
  });
  const placementActions = el(
    "div",
    {
      id: "placement-actions",
      class: "action-row",
      hidden: true,
      role: "group",
      "aria-label": "Placement actions",
    },
    rotateBuilding,
    confirmBuilding,
    cancelBuilding,
  );
  const placementStatus = el("p", {
    id: "placement-status",
    class: "muted",
    role: "status",
  });
  const placementPanel = el(
    "section",
    {
      id: "placement-panel",
      class: "placement-panel",
      "aria-label": "Building placement",
      hidden: true,
    },
    placementActions,
    placementStatus,
  );
  const boxSelect = createButton("Box select", {
    id: "box-select",
    "aria-pressed": "false",
  });
  const addSelection = createButton("Add units", {
    id: "add-selection",
    "aria-pressed": "false",
  });
  const queueOrders = createButton("⋯ Queue orders", {
    id: "queue-orders",
    "aria-pressed": "false",
  });
  const attackMove = createButton("⚔ Attack Move", {
    id: "attack-move",
    "aria-pressed": "false",
    hidden: true,
  });
  const cancelAttackMove = createButton("Cancel Attack Move", {
    id: "cancel-attack-move",
    hidden: true,
  });
  const stopUnits = createButton("Stop (S)", {
    id: "stop-units",
    disabled: true,
  });
  const clearSelection = createButton("Clear", {
    id: "clear-selection",
    disabled: true,
  });
  const focusSelection = createButton("⌖ Focus", {
    id: "focus-selection",
    disabled: true,
  });
  const followSelection = createButton("⤳ Follow", {
    id: "follow-selection",
    "aria-pressed": "false",
    disabled: true,
  });
  const movementStatus = el("p", {
    id: "movement-status",
    class: "muted",
    role: "status",
  });
  const ordersRoot = el(
    "section",
    { class: "unit-controls", "aria-label": "Unit controls" },
    el(
      "div",
      {
        class: "action-row",
        role: "group",
        "aria-label": "Selection and movement",
      },
      boxSelect,
      addSelection,
      queueOrders,
      attackMove,
      cancelAttackMove,
      stopUnits,
      clearSelection,
      focusSelection,
      followSelection,
    ),
    movementStatus,
  );
  return {
    placementPanel,
    root: ordersRoot,
    controls: {
      boxSelect,
      addSelection,
      queueOrders,
      stop: stopUnits,
      attackMove,
      cancelAttackMove,
      clearSelection,
      focusSelection,
      followSelection,
      movementStatus,
      rotate: rotateBuilding,
      confirm: confirmBuilding,
      cancel: cancelBuilding,
      status: placementStatus,
    },
    update: (state: SidebarState) => {
      placementActions.hidden = !state.placementActive;
      placementPanel.hidden = !state.placementActive && !state.faulted;
      const ids = state.selectedActorIds;
      const selected = new Set(ids);
      const selectedMobile = state.actors.filter(
        (actor) =>
          selected.has(actor.id) &&
          isMobileActor(actor, definitionById.get(actor.definitionId)),
      );
      const locked = ordersLocked(state);
      boxSelect.disabled = locked;
      addSelection.disabled = locked;
      queueOrders.disabled = locked;
      queueOrders.setAttribute(
        "aria-pressed",
        String(state.queueMode ?? false),
      );
      setText(
        queueOrders,
        state.queueMode ? "✓ Done queuing" : "⋯ Queue orders",
      );
      boxSelect.setAttribute("aria-pressed", String(state.boxMode ?? false));
      addSelection.setAttribute(
        "aria-pressed",
        String(state.additiveMode ?? false),
      );
      stopUnits.disabled =
        locked || !!state.paused || !selectedMobile.some(owns);
      clearSelection.disabled = locked || ids.length === 0;
      focusSelection.disabled = ids.length === 0;
      followSelection.setAttribute(
        "aria-pressed",
        String(state.following ?? false),
      );
      followSelection.disabled =
        !state.following && selectedMobile.length === 0;
    },
  };
}
