import type { ScenarioPopup } from "../simulation/mission-file";

/** The first undismissed popup whose trigger currently holds. */
export function duePopup(
  popups: readonly ScenarioPopup[],
  dismissed: ReadonlySet<string>,
  current: {
    /** The building definition being placed, if any. */
    placing?: string;
    owns: (definitionId: string) => boolean;
  },
): ScenarioPopup | undefined {
  return popups.find(
    ({ id, trigger }) =>
      !dismissed.has(id) &&
      (trigger.kind === "placement"
        ? current.placing === trigger.definitionId
        : current.owns(trigger.definitionId)),
  );
}
