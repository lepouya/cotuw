/** Binds a production command to a button and an optional card explanation. */
export type DefinitionButton = {
  definitionId: string;
  button: HTMLButtonElement;
  /** `hadFocus` records button focus before changing its disabled state. */
  explain?: (reason: string, hadFocus?: boolean) => void;
};

/** Session conditions that block every production order. */
export type ProductionBlockers = {
  defeated: boolean;
  faulted: boolean;
  paused: boolean;
  placing: boolean;
};

/** Why no production order can start now, or "" when one can. */
export function productionBlocker(state: ProductionBlockers, action: string) {
  return state.defeated
    ? "Mission ended in defeat."
    : state.faulted
      ? "Simulation stopped. Restart or load a mission from the menu."
      : state.paused
        ? `Resume the mission to ${action}.`
        : state.placing
          ? "Finish or cancel the current building placement."
          : "";
}

/** Disables the action with a player-facing reason; "" enables it. */
export function setActionAvailability(
  action: DefinitionButton,
  reason: string,
) {
  const focused = action.button.ownerDocument?.activeElement === action.button;
  action.button.disabled = reason !== "";
  if (action.explain) action.explain(reason, focused);
  else action.button.title = reason;
}
