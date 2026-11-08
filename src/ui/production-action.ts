import { presentResult, SIMULATION_STOPPED } from "./mission-result";
import type { MissionResult } from "../simulation/mission-result";

/** Binds a production command to a button and an optional card explanation. */
export type DefinitionButton = {
  definitionId: string;
  button: HTMLButtonElement;
  /** `hadFocus` records button focus before changing its disabled state. */
  explain?: (reason: string, hadFocus?: boolean) => void;
};

/** Session conditions that block every production order. */
type ProductionBlockers = {
  result?: MissionResult;
  faulted: boolean;
  paused: boolean;
  placing: boolean;
};

/** Why no production order can start now, or "" when one can. */
export function productionBlocker(state: ProductionBlockers, action: string) {
  const ended = state.result && presentResult(state.result).blocker;
  if (ended !== undefined) return ended;
  if (state.faulted) return SIMULATION_STOPPED;
  if (state.paused) return `Resume the mission to ${action}.`;
  if (state.placing) return "Finish or cancel the current building placement.";
  return "";
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
