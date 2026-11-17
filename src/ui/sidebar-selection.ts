import {
  isMobileActor,
  isTilePlacedActor,
  occupiedTilesFor,
} from "../simulation/placement";
import { footprintSize } from "../simulation/grid";
import { isSupportUnit } from "../simulation/actor";
import {
  createButton,
  createElement as el,
  createKeyedList,
  setText,
} from "./dom";
import {
  countByDefinition,
  inspectedActor,
  selectionLocked,
} from "./sidebar-context";
import type { ObservedActor } from "../simulation/owner-view";
import type { OwnerRelation } from "../simulation/ownership";
import type { UnitTypeScope } from "../render/selection";
import type { SidebarContext, SidebarState } from "./sidebar-context";
import "./sidebar-selection.css";

const TYPE_SCOPES: readonly {
  scope: UnitTypeScope;
  text: string;
  place: string;
}[] = [
  { scope: "view", text: "In view", place: "in view" },
  { scope: "map", text: "Across map", place: "across the map" },
];

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

function supportHint(state: SidebarState) {
  if (state.paused) return "Resume the mission to issue support orders.";
  if (state.boxMode) return "Turn off Box select to prioritize recovery.";
  if (state.additiveMode) return "Turn off Add units to prioritize recovery.";
  return "Tap or click a damaged eligible unit to prioritize it.";
}

export function createSidebarSelection(
  {
    definitionById,
    nameFor,
    trainedNames,
    owns,
    presentations,
    selectType,
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
  const selectionTypes = el("div", {
    id: "selection-types",
    class: "actor-list",
    "aria-label": "Selected unit types",
  });
  type TypeRow = { definitionId: string; count: number; disabled: boolean };
  const typeRows = createKeyedList<TypeRow>(
    selectionTypes,
    ({ definitionId }) => definitionId,
    ({ definitionId }) => {
      const name = nameFor(definitionId);
      const controller = new AbortController();
      const label = el("span", {});
      const listening = { signal: controller.signal };
      const buttons = selectType
        ? TYPE_SCOPES.map(({ scope, text, place }) => {
            const button = createButton(text, {
              "data-select-type": scope,
              "aria-label": `Select every ${name} ${place}`,
            });
            button.addEventListener(
              "click",
              () => selectType(definitionId, scope),
              listening,
            );
            return button;
          })
        : [];
      return {
        node: el(
          "div",
          { class: "selection-type", "data-definition-id": definitionId },
          label,
          ...buttons,
        ),
        dispose: () => controller.abort(),
        update: ({ count, disabled }) => {
          setText(label, `${name} × ${count}`);
          for (const button of buttons) button.disabled = disabled;
        },
      };
    },
    signal,
  );
  const constructionDetails = el("p", {
    id: "construction-details",
    class: "muted",
    hidden: true,
  });
  const repairActions = el("div", {
    id: "repair-actions",
    class: "actor-list",
  });
  const repairDetails = el("p", {
    id: "repair-details",
    class: "muted",
    role: "status",
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
    selectionTypes,
    constructionDetails,
    repairDetails,
    repairActions,
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
  /** A support unit's current service; undefined for other actors. */
  const supportStatus = (actor: ObservedActor, state: SidebarState) => {
    const definition = definitionById.get(actor.definitionId);
    if (!definition || !isSupportUnit(definition) || !owns(actor))
      return undefined;
    const owned = state.ownActors?.find(({ id }) => id === actor.id);
    const order = owned?.service;
    const target =
      order && state.actors.find(({ id }) => id === order.targetId);
    if (!target) return "Automatic support while idle";
    let action = "Servicing";
    if (order.blocked) action = "Route blocked";
    else if (owned.movement) action = "Approaching";
    return `${action} ${nameFor(target.definitionId)}`;
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
    const support = supportStatus(actor, state);
    if (support)
      return `${description ?? "Unit support"} · ${support} · ${supportHint(state)}`;
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
      repairDetails,
      repairActions,
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
      const selectedActors = state.actors.filter(({ id }) => selected.has(id));
      removeBuilding.hidden = !selectedActors.some(
        (actor) => owns(actor) && isTilePlacedActor(actor),
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
      const disabled = selectionLocked(state);
      const nextSelectionKey = JSON.stringify([
        actor && supportStatus(actor, state),
        ids,
        state.boxMode ?? false,
        state.additiveMode ?? false,
        state.paused ?? false,
        disabled,
        selectedActors.map((actor) => state.relationTo(actor)),
      ]);
      if (
        state.actorVersion === actorVersion &&
        selectionKey === nextSelectionKey
      )
        return;
      actorVersion = state.actorVersion;
      selectionKey = nextSelectionKey;
      openTraining.hidden = !actor || !owns(actor) || !definition?.production;
      const units = selectedActors.filter(
        (shown) =>
          owns(shown) &&
          isMobileActor(shown, definitionById.get(shown.definitionId)),
      );
      typeRows.update(
        [...countByDefinition(units)].map(([definitionId, count]) => ({
          definitionId,
          count,
          disabled,
        })),
      );
      if (ids.length > 1) {
        setText(selectionDetails, `${ids.length} units selected`);
        setText(selectionInfo, moveHint(state, "the group"));
        return;
      }
      setText(selectionDetails, titleOf(actor));
      setText(selectionInfo, infoOf(actor, state));
    },
  };
}
