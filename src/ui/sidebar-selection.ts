import { isTilePlacedActor, occupiedTilesFor } from "../simulation/placement";
import { footprintSize } from "../simulation/grid";
import { createButton, createElement as el, setText } from "./dom";
import { countByDefinition, inspectedActor } from "./sidebar-context";
import type { ObservedActor } from "../simulation/owner-view";
import type { OwnerRelation } from "../simulation/ownership";
import type { SidebarContext, SidebarState } from "./sidebar-context";
import "./sidebar-selection.css";

const RELATION_LABELS: Record<Exclude<OwnerRelation, "own">, string> = {
  allied: "Allied",
  neutral: "Neutral",
  hostile: "Hostile",
};

function moveHint({ paused, boxMode }: SidebarState, subject: string) {
  if (paused) return "Resume the mission to issue orders.";
  return boxMode
    ? `Turn off Box select to move ${subject}.`
    : `Tap or click terrain to move ${subject}.`;
}

export function createSidebarSelection(
  {
    definitionById,
    nameFor,
    trainedNames,
    owns,
    presentations,
    signal,
  }: SidebarContext,
  showTraining: () => void,
) {
  const selectionHeading = el(
    "p",
    { id: "selection-heading", class: "eyebrow" },
    "Current selection",
  );
  const selectionDetails = el(
    "h2",
    { id: "selection-details" },
    "Nothing selected",
  );
  const selectionHealth = el("p", { id: "selection-health", hidden: true });
  const networkStatus = el("p", {
    "data-network-status": true,
    class: "muted",
    hidden: true,
  });
  const selectionInfo = el("p", { id: "selection-info", class: "muted" });
  const constructionDetails = el("p", {
    id: "construction-details",
    class: "muted",
    hidden: true,
  });
  const workerActivityHeading = el("h3", { id: "worker-activity-heading" });
  const harvesterDetails = el("p", { id: "harvester-details", class: "muted" });
  const gatherSites = el("div", { id: "gather-sites", class: "actor-list" });
  const refineryAssignmentHeading = el("h3", {
    id: "refinery-assignment-heading",
  });
  const refineryAssignments = el("div", {
    id: "refinery-assignments",
    class: "actor-list",
  });
  const returnCargoActions = el("div", {
    id: "return-cargo-actions",
    class: "actor-list",
  });
  const harvesterStatus = el("p", {
    id: "harvester-status",
    class: "muted",
    role: "status",
  });
  const harvesterActions = el(
    "section",
    {
      id: "harvester-actions",
      hidden: true,
      "aria-label": "Harvesting controls",
    },
    workerActivityHeading,
    harvesterDetails,
    gatherSites,
    refineryAssignmentHeading,
    refineryAssignments,
    returnCargoActions,
    harvesterStatus,
  );
  const rallyStatus = el("p", {
    "data-rally-status": true,
    class: "muted",
    role: "status",
  });
  const setRally = createButton("Set Rally Point", {
    "data-rally-action": "set",
  });
  const clearRally = createButton("Clear Rally Point", {
    "data-rally-action": "clear",
  });
  const cancelRally = createButton("Cancel rally point", {
    "data-rally-action": "cancel",
    hidden: true,
  });
  const rallyControls = el(
    "section",
    { "data-rally-controls": true, hidden: true, "aria-label": "Rally point" },
    setRally,
    clearRally,
    cancelRally,
    rallyStatus,
  );
  const productionQueue = el("div", {
    id: "production-queue",
    class: "actor-list",
    "aria-label": "Paid production orders",
  });
  const openTraining = createButton("Train units", {
    id: "open-training",
    hidden: true,
  });
  const removeBuilding = createButton("Remove selected building", {
    id: "remove-building",
    disabled: true,
  });
  const panelSelection = el(
    "section",
    { id: "panel-selection", "aria-label": "Current selection" },
    selectionHeading,
    selectionDetails,
    selectionHealth,
    networkStatus,
    selectionInfo,
    constructionDetails,
    harvesterActions,
    rallyControls,
    productionQueue,
    openTraining,
    removeBuilding,
  );
  const root = el("div", { class: "selection-pane" }, panelSelection);
  let selectionKey = "";
  let actorVersion: number | undefined;
  openTraining.addEventListener("click", showTraining, { signal });
  const titleOf = (actor: ObservedActor | undefined) => {
    if (!actor) return "Nothing selected";
    const name = nameFor(actor.definitionId);
    if (!isTilePlacedActor(actor)) return name;
    const tiles = occupiedTilesFor(
      actor,
      definitionById.get(actor.definitionId)!,
    );
    return `${name} · ${footprintSize(tiles)} · ${actor.tilePlacement.quarterTurns * 90}°`;
  };
  const infoOf = (actor: ObservedActor | undefined, state: SidebarState) => {
    if (!actor)
      return "Choose a unit or building on the map, or a field unit in Units.";
    const relation = state.relationTo(actor);
    const description = presentations.get(actor.definitionId)?.description;
    if (relation !== "own")
      return [
        RELATION_LABELS[relation],
        description,
        relation === "hostile"
          ? "Select your units, then click or tap it to attack."
          : "Not under your command.",
      ]
        .filter(Boolean)
        .join(" · ");
    const definition = definitionById.get(actor.definitionId);
    if (definition?.production)
      return `${description ?? "Unit production"} · Trains ${trainedNames(definition).join(" and ")}.`;
    if (isTilePlacedActor(actor))
      return `${description ?? "Building"} · Select Buildings to expand your base.`;
    if (definition?.movement)
      return `${description ?? "Unit"} · Movement speed ${definition.movement.speed} · ${moveHint(state, "this unit")}`;
    return description ?? "Unit";
  };
  return {
    root,
    remove: removeBuilding,
    networkStatus,
    rally: {
      section: rallyControls,
      set: setRally,
      clear: clearRally,
      cancel: cancelRally,
      status: rallyStatus,
    },
    economy: {
      constructionDetails,
      workerActivityHeading,
      harvesterDetails,
      gatherSites,
      refineryAssignmentHeading,
      refineryAssignments,
      returnCargoActions,
      harvesterStatus,
      harvesterActions,
      productionQueue,
      removeBuilding,
    },
    update: (state: SidebarState) => {
      const ids = state.selectedActorIds;
      const selected = new Set(ids);
      removeBuilding.hidden = !state.actors.some(
        (shown) =>
          selected.has(shown.id) && owns(shown) && isTilePlacedActor(shown),
      );
      const actor = inspectedActor(state);
      const definition = actor && definitionById.get(actor.definitionId);
      const maximum = definition?.health;
      selectionHealth.hidden = !maximum;
      if (actor && maximum)
        setText(
          selectionHealth,
          `Health ${Math.ceil(actor.health ?? maximum)} / ${maximum}`,
        );
      const nextSelectionKey = JSON.stringify([
        ids,
        state.boxMode ?? false,
        state.paused ?? false,
        state.actors
          .filter(({ id }) => selected.has(id))
          .map((shown) => state.relationTo(shown)),
      ]);
      if (
        state.actorVersion === actorVersion &&
        selectionKey === nextSelectionKey
      )
        return;
      actorVersion = state.actorVersion;
      selectionKey = nextSelectionKey;
      openTraining.hidden = !actor || !owns(actor) || !definition?.production;
      if (ids.length > 1) {
        const actorsById = new Map(
          state.actors.map((shown) => [shown.id, shown]),
        );
        const counts = countByDefinition(
          ids.flatMap((id) => actorsById.get(id) ?? []),
        );
        setText(selectionDetails, `${ids.length} units selected`);
        setText(
          selectionInfo,
          `${[...counts].map(([id, count]) => `${nameFor(id)} × ${count}`).join(" · ")}. ${moveHint(state, "the group")}`,
        );
        return;
      }
      setText(selectionDetails, titleOf(actor));
      setText(selectionInfo, infoOf(actor, state));
    },
  };
}
