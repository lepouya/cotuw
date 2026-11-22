import { cultivationStatus, workedSiteIds } from "../simulation/cultivation";

import type { ActorRenderState } from "../simulation/actor";
import type { EconomyView } from "../simulation/economy";
import type { TileCoord } from "../simulation/grid";
import type { MissionUiState, ScenarioPopup } from "../simulation/mission-file";

type PopupView = {
  ownActors: () => readonly Pick<
    ActorRenderState,
    "definitionId" | "construction"
  >[];
  cultivation: () => EconomyView["cultivation"];
  seesTile: (tile: TileCoord) => boolean;
};

/** Offers one guide at a time and remembers dismissals across saves. */
export function createPopupTracker(
  popups: readonly ScenarioPopup[],
  view: PopupView,
  saved?: MissionUiState,
) {
  const known = new Set(popups.map(({ id }) => id));
  const dismissed = new Set(saved?.dismissedPopups);
  let activeId: string | undefined;

  function hasWorkedSiteUnderStrain() {
    const cultivation = view.cultivation();
    if (!cultivation) return false;
    const worked = workedSiteIds(cultivation.workers);
    return cultivation.sites.some(
      (site) =>
        worked.has(site.id) &&
        cultivationStatus(site) !== "Healthy" &&
        view.seesTile(site.tile),
    );
  }

  return {
    /** Reserves the first eligible guide until it is dismissed. */
    next(placing?: string) {
      if (activeId !== undefined) return undefined;
      const popup = popups.find(({ id, trigger }) => {
        if (dismissed.has(id)) return false;
        switch (trigger.kind) {
          case "placement":
            return placing === trigger.definitionId;
          case "actor":
            return view
              .ownActors()
              .some(
                (actor) =>
                  actor.definitionId === trigger.definitionId &&
                  !actor.construction,
              );
          case "site-strain":
            return hasWorkedSiteUnderStrain();
        }
      });
      activeId = popup?.id;
      return popup;
    },
    /** Rejects IDs a saved mission could not load. */
    dismiss(id: string) {
      if (!known.has(id))
        throw new RangeError(`Unknown scenario popup: ${id}.`);
      dismissed.add(id);
      if (activeId === id) activeId = undefined;
    },
    /** What a save keeps; nothing until a popup is dismissed. */
    uiState: (): MissionUiState | undefined =>
      dismissed.size > 0 ? { dismissedPopups: [...dismissed] } : undefined,
  };
}
