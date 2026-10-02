import { isTilePlacedActor, occupiedTilesFor } from "../simulation/placement";
import { footprintSize } from "../simulation/grid";

import type { ActorDefinition, ActorRenderState } from "../simulation/actor";

export type ActorPresentation = {
  name: string;
  description: string;
  build?: { id: string; label: string };
  train?: { id: string; label: string };
};
export type SidebarGoal = { definitionId: string; label: string };
/** A sidebar action for one actor definition. */
export type DefinitionButton = {
  definitionId: string;
  button: HTMLButtonElement;
};
export type SidebarState = {
  actors: readonly ActorRenderState[];
  actorVersion: number;
  selectedActorId?: string;
  placementActive: boolean;
  faulted: boolean;
  canRemove: boolean;
};

/** Tabs and actor lists present committed simulation state only. */
export function createSidebar(
  root: HTMLElement,
  options: {
    definitions: readonly ActorDefinition[];
    presentations: ReadonlyMap<string, ActorPresentation>;
    goals: readonly SidebarGoal[];
    selectActor: (id: string) => void;
  },
) {
  const { definitions, presentations, goals, selectActor } = options;
  const controller = new AbortController();
  const signal = controller.signal;
  const element = <T extends HTMLElement>(id: string) =>
    root.querySelector<T>(`#${id}`)!;
  for (const id of [
    "building-options",
    "training-options",
    "unit-roster",
    "producer-roster",
    "scenario-goals",
  ])
    element(id).replaceChildren();
  const tabs = [...root.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  const panels = [...root.querySelectorAll<HTMLElement>('[role="tabpanel"]')];
  const definitionById = new Map(
    definitions.map((definition) => [definition.id, definition]),
  );
  const nameFor = (id: string) => presentations.get(id)?.name ?? id;
  const namesFor = (definition: ActorDefinition) =>
    definition.production!.unitDefinitionIds.map(nameFor);
  const selectionDetails = element("selection-details");
  const selectionInfo = element("selection-info");
  const trainingLink = element<HTMLButtonElement>("open-training");
  const placementActions = element("placement-actions");
  const remove = element<HTMLButtonElement>("remove-building");
  const showTab = (id: string) => {
    const focusedPanel = panels.find((panel) =>
      panel.contains(document.activeElement),
    );
    for (const tab of tabs) {
      const selected = tab.getAttribute("aria-controls") === id;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
    }
    for (const panel of panels) panel.hidden = panel.id !== id;
    if (focusedPanel && focusedPanel.id !== id)
      tabs.find((tab) => tab.getAttribute("aria-controls") === id)?.focus();
  };
  const optionButton = (
    container: HTMLElement,
    action: { id: string; label: string },
    details: string,
  ) => {
    const button = document.createElement("button");
    button.type = "button";
    button.id = action.id;
    button.className = "build-option";
    const label = document.createElement("strong");
    const description = document.createElement("span");
    label.textContent = action.label;
    description.textContent = details;
    button.append(label, description);
    container.append(button);
    return button;
  };
  const buildings: DefinitionButton[] = [];
  const train: DefinitionButton[] = [];
  for (const definition of definitions) {
    const presentation = presentations.get(definition.id);
    if (presentation?.build && definition.footprint) {
      const description = definition.production
        ? `Trains ${namesFor(definition).join(" & ")}`
        : presentation.description;
      buildings.push({
        definitionId: definition.id,
        button: optionButton(
          element("building-options"),
          presentation.build,
          `${description} · ${footprintSize(definition.footprint.occupiedTiles)} tiles`,
        ),
      });
    }
    if (presentation?.train && definition.movement) {
      const button = optionButton(
        element("training-options"),
        presentation.train,
        `${presentation.description} · Speed ${definition.movement.speed}`,
      );
      button.disabled = true;
      train.push({ definitionId: definition.id, button });
    }
  }
  const createActorList = (container: HTMLElement, emptyText: string) => {
    const buttons = new Map<string, HTMLButtonElement>();
    // Labels number each type separately and keep a unit's number for life.
    const nextNumbers = new Map<string, number>();
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = emptyText;
    container.append(empty);
    return {
      sync: (actors: readonly ActorRenderState[]) => {
        const present = new Set(actors.map(({ id }) => id));
        for (const [id, button] of buttons) {
          if (!present.has(id)) {
            button.remove();
            buttons.delete(id);
          }
        }
        empty.hidden = actors.length > 0;
        actors.forEach((actor, index) => {
          let button = buttons.get(actor.id);
          if (!button) {
            button = document.createElement("button");
            button.type = "button";
            button.className = "roster-item";
            button.dataset.actorId = actor.id;
            const number = nextNumbers.get(actor.definitionId) ?? 1;
            nextNumbers.set(actor.definitionId, number + 1);
            button.textContent = `${nameFor(actor.definitionId)} · ${number}`;
            buttons.set(actor.id, button);
          }
          if (container.children[index + 1] !== button)
            container.insertBefore(
              button,
              container.children[index + 1] ?? null,
            );
        });
      },
      updateSelection: (
        selectedActorId: string | undefined,
        disabled: boolean,
      ) => {
        for (const [id, button] of buttons) {
          button.setAttribute("aria-pressed", String(id === selectedActorId));
          button.disabled = disabled;
        }
      },
    };
  };
  const roster = createActorList(
    element("unit-roster"),
    "No units yet. Select a production building to train your first unit.",
  );
  const producers = createActorList(
    element("producer-roster"),
    "No production buildings yet. Open Buildings to place one.",
  );
  const goalItems = goals.map((goal) => {
    const item = document.createElement("li");
    element("scenario-goals").append(item);
    return { ...goal, item };
  });
  let actorsById = new Map<string, ActorRenderState>();
  let actorVersion: number | undefined;
  let selectedActorId: string | undefined;
  let disabled: boolean | undefined;
  /** Production buildings open their training panel; others their details. */
  const showActor = (definitionId: string) =>
    showTab(
      definitionById.get(definitionId)?.production
        ? "panel-units"
        : "panel-selection",
    );
  root.addEventListener(
    "click",
    (event) => {
      if (!(event.target instanceof Element)) return;
      const button = event.target.closest<HTMLButtonElement>("button");
      if (!button || button.disabled) return;
      if (button.getAttribute("role") === "tab")
        showTab(button.getAttribute("aria-controls")!);
      else if (button === trainingLink) showTab("panel-units");
      else if (button.dataset.actorId) {
        const actor = actorsById.get(button.dataset.actorId);
        if (!actor) return;
        selectActor(actor.id);
        showActor(actor.definitionId);
      }
    },
    { signal },
  );
  root.addEventListener(
    "keydown",
    (event) => {
      const index = tabs.indexOf(event.target as HTMLButtonElement);
      if (index < 0) return;
      const next =
        event.key === "ArrowRight"
          ? (index + 1) % tabs.length
          : event.key === "ArrowLeft"
            ? (index + tabs.length - 1) % tabs.length
            : event.key === "Home"
              ? 0
              : event.key === "End"
                ? tabs.length - 1
                : undefined;
      if (next === undefined) return;
      event.preventDefault();
      showTab(tabs[next]!.getAttribute("aria-controls")!);
      tabs[next]!.focus();
    },
    { signal },
  );
  return {
    controls: {
      buildings,
      train,
      remove,
      rotate: element<HTMLButtonElement>("rotate-building"),
      confirm: element<HTMLButtonElement>("confirm-building"),
      cancel: element<HTMLButtonElement>("cancel-building"),
      status: element("placement-status"),
      productionStatus: element("production-status"),
      animate: element<HTMLInputElement>("animate-building"),
    },
    showActor,
    update: (state: SidebarState) => {
      placementActions.hidden = !state.placementActive;
      remove.disabled = !state.canRemove;
      const membershipChanged = state.actorVersion !== actorVersion;
      if (membershipChanged) {
        actorVersion = state.actorVersion;
        actorsById = new Map(state.actors.map((actor) => [actor.id, actor]));
        roster.sync(state.actors.filter((actor) => !isTilePlacedActor(actor)));
        producers.sync(
          state.actors.filter(
            (actor) => definitionById.get(actor.definitionId)?.production,
          ),
        );
        const counts = new Map<string, number>();
        for (const actor of state.actors)
          counts.set(
            actor.definitionId,
            (counts.get(actor.definitionId) ?? 0) + 1,
          );
        for (const { definitionId, label, item } of goalItems) {
          const count = counts.get(definitionId) ?? 0;
          item.className = count ? "goal-complete" : "";
          item.textContent = `${count ? "✓" : "○"} ${label} (${count})`;
        }
      }
      const nextDisabled = state.placementActive || state.faulted;
      if (
        membershipChanged ||
        selectedActorId !== state.selectedActorId ||
        disabled !== nextDisabled
      ) {
        selectedActorId = state.selectedActorId;
        disabled = nextDisabled;
        roster.updateSelection(selectedActorId, disabled);
        producers.updateSelection(selectedActorId, disabled);
        const actor = selectedActorId
          ? actorsById.get(selectedActorId)
          : undefined;
        const definition = actor && definitionById.get(actor.definitionId)!;
        const presentation = actor && presentations.get(actor.definitionId);
        trainingLink.hidden = !definition?.production;
        selectionDetails.textContent = actor
          ? isTilePlacedActor(actor)
            ? `${nameFor(actor.definitionId)} · ${footprintSize(occupiedTilesFor(actor, definition!))} · ${actor.tilePlacement.quarterTurns * 90}°`
            : nameFor(actor.definitionId)
          : "Nothing selected";
        selectionInfo.textContent = !actor
          ? "Choose a unit or building on the map or in the Units tab."
          : definition?.production
            ? `${presentation?.description ?? "Unit production"} · Trains ${namesFor(definition).join(" and ")}.`
            : isTilePlacedActor(actor)
              ? `${presentation?.description ?? "Building"} · Select Buildings to expand your base.`
              : `${presentation?.description ?? "Unit"} · Movement speed ${definition?.movement?.speed} · Click terrain to move.`;
      }
    },
    dispose: () => controller.abort(),
  };
}
