import type { MissionUiState, ScenarioPopup } from "../simulation/mission-file";

/** A scenario's popups and which ones the player has dismissed. */
export function createPopupTracker(
  popups: readonly ScenarioPopup[],
  saved?: MissionUiState,
) {
  const known = new Set(popups.map(({ id }) => id));
  const dismissed = new Set(saved?.dismissedPopups);
  return {
    /** The first undismissed popup whose trigger currently holds. */
    due: (current: {
      /** The building definition being placed, if any. */
      placing?: string;
      owns: (definitionId: string) => boolean;
    }) =>
      popups.find(
        ({ id, trigger }) =>
          !dismissed.has(id) &&
          (trigger.kind === "placement"
            ? current.placing === trigger.definitionId
            : current.owns(trigger.definitionId)),
      ),
    /** Rejects IDs a saved mission could not load. */
    dismiss(id: string) {
      if (!known.has(id))
        throw new RangeError(`Unknown scenario popup: ${id}.`);
      dismissed.add(id);
    },
    /** What a save keeps; nothing until a popup is dismissed. */
    uiState: (): MissionUiState | undefined =>
      dismissed.size > 0 ? { dismissedPopups: [...dismissed] } : undefined,
  };
}
