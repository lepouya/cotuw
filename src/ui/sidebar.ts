import {
  isMobileActor,
  isTilePlacedActor,
  occupiedTilesFor,
} from "../simulation/placement";
import { footprintSize } from "../simulation/grid";
import { costAmount, costLabel, costResource } from "../simulation/resources";
import { growthCandidates } from "../simulation/growth";
import type { Resource } from "../simulation/resources";
import { createPlayerAccess, rosterIncludes } from "../simulation/ownership";
import type { Relations } from "../simulation/ownership";
import { createGoalList } from "./goals";
import { createProductionCards } from "./production-card";
import { productionBlocker, setActionAvailability } from "./production-action";
import { trainableUnitIds } from "../simulation/production";
import { createLifetime } from "../lifetime";
import { setText } from "./dom";

import type { ActorDefinition, ActorRenderState } from "../simulation/actor";
import type { MissionResult, ObjectiveView } from "../simulation/objectives";
import type { ScenarioGoal } from "../simulation/mission-file";
import type { ActorPresentation } from "../content/content-pack";
import type { ProductionCard } from "./production-card";

export type SidebarState = {
  actors: readonly ActorRenderState[];
  actorVersion: number;
  selectedActorIds: readonly string[];
  boxMode?: boolean;
  additiveMode?: boolean;
  queueMode?: boolean;
  placementActive: boolean;
  faulted: boolean;
  paused?: boolean;
  /** Whether the camera follows actors. */
  following?: boolean;
  canRemove: boolean;
  /** Present when the mission has an economy. */
  balances?: Partial<Record<Resource, number>>;
  /** The player's spending resource, shown in the top bar. */
  resource?: Resource;
  objectives?: readonly ObjectiveView[];
  result?: MissionResult;
  relations: Pick<Relations, "relationship">;
};

const RESULT_DIRECTIVES: Record<MissionResult["kind"], string> = {
  victory: "Victory secured. Continue exploring in free play.",
  defeat: "Mission failed. Restart or load a saved mission.",
};

export type SidebarOptions = {
  definitions: readonly ActorDefinition[];
  economy?: boolean;
  presentations: ReadonlyMap<string, ActorPresentation>;
  goals: readonly ScenarioGoal[];
  selectActor: (id: string, additive?: boolean) => void;
  playerOwner: string;
  /** The player's faction, whose roster supplies the construction menu. */
  playerFaction?: string;
  factionName?: string;
};

/** Tabs and actor lists present committed simulation state only. */
export function createSidebar(root: HTMLElement, options: SidebarOptions) {
  const lifetime = createLifetime();
  try {
    return buildSidebar(root, options, lifetime);
  } catch (error) {
    lifetime.dispose();
    throw error;
  }
}

function buildSidebar(
  root: HTMLElement,
  options: SidebarOptions,
  lifetime: ReturnType<typeof createLifetime>,
) {
  const { definitions, presentations, goals, selectActor } = options;
  const controller = new AbortController();
  lifetime.defer(() => controller.abort());
  const signal = controller.signal;
  const element = <T extends HTMLElement>(id: string) =>
    root.querySelector<T>(`#${id}`)!;
  setText(element("faction-label"), options.factionName ?? "Expedition");
  for (const id of ["building-options", "training-options", "unit-roster"])
    element(id).replaceChildren();
  const tabs = [...root.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  const panels = [
    ...root.querySelectorAll<HTMLElement>(".sidebar-content > section"),
  ];
  const definitionById = new Map(
    definitions.map((definition) => [definition.id, definition]),
  );
  const nameFor = (id: string) => presentations.get(id)?.name ?? id;
  const countByDefinition = (actors: Iterable<ActorRenderState>) => {
    const counts = new Map<string, number>();
    for (const { definitionId } of actors)
      counts.set(definitionId, (counts.get(definitionId) ?? 0) + 1);
    return counts;
  };
  // Each update brings the mission's current relationships.
  let relations: Pick<Relations, "relationship"> | undefined;
  const player = createPlayerAccess(
    options.playerOwner,
    (left, right) => relations?.relationship(left, right) ?? "neutral",
  );
  const owns = player.owns;
  const playable = (definition: ActorDefinition) =>
    rosterIncludes(options.playerFaction, definition);
  const namesFor = (definition: ActorDefinition) =>
    definition.production!.unitDefinitionIds.map(nameFor);
  const selectionDetails = element("selection-details");
  const selectionInfo = element("selection-info");
  const selectionHealth = element("selection-health");
  const trainingLink = element<HTMLButtonElement>("open-training");
  const placementActions = element("placement-actions");
  const placementPanel = element("placement-panel");
  const remove = element<HTMLButtonElement>("remove-building");
  const boxSelect = element<HTMLButtonElement>("box-select");
  const addSelection = element<HTMLButtonElement>("add-selection");
  const queueOrders = element<HTMLButtonElement>("queue-orders");
  const stop = element<HTMLButtonElement>("stop-units");
  const clearSelection = element<HTMLButtonElement>("clear-selection");
  const focusSelection = element<HTMLButtonElement>("focus-selection");
  const followSelection = element<HTMLButtonElement>("follow-selection");
  const cards = createProductionCards(root, signal);
  const goalsButton = element<HTMLButtonElement>("tab-goals");
  // Goals temporarily replaces production; closing it restores this tab.
  let productionPanel = "panel-buildings";
  const showTab = (id: string) => {
    if (id !== "panel-goals") productionPanel = id;
    root.querySelector<HTMLElement>(".sidebar-content")!.scrollTop = 0;
    const focusedPanel = panels.find((panel) =>
      panel.contains(document.activeElement),
    );
    for (const tab of tabs) {
      const current = tab.getAttribute("aria-controls") === productionPanel;
      tab.setAttribute(
        "aria-selected",
        String(current && id !== "panel-goals"),
      );
      tab.tabIndex = current ? 0 : -1;
    }
    for (const panel of panels) panel.hidden = panel.id !== id;
    goalsButton.setAttribute("aria-expanded", String(id === "panel-goals"));
    cards.hide();
    if (focusedPanel && focusedPanel.id !== id)
      (
        tabs.find((tab) => tab.getAttribute("aria-controls") === id) ??
        goalsButton
      ).focus();
  };
  const addCard = (
    container: string,
    action: { id: string; label: string },
    definition: ActorDefinition,
    details: string,
    seconds = 0,
  ) =>
    cards.create(element(container), action, definition, {
      name: nameFor(definition.id),
      portrait: presentations.get(definition.id)?.portrait,
      details: [
        presentations.get(definition.id)?.description,
        details,
        ...(options.economy ? [costLabel(definition), `${seconds}s`] : []),
      ]
        .filter(Boolean)
        .join(" · "),
      cost: options.economy ? costLabel(definition) : undefined,
    });
  const buildings: ProductionCard[] = [];
  const train: ProductionCard[] = [];
  const buildOrder = (id: string) => presentations.get(id)?.build?.order ?? 0;
  for (const definition of definitions) {
    const presentation = presentations.get(definition.id);
    if (playable(definition) && presentation?.build && definition.footprint) {
      const trains = definition.production
        ? `Trains ${namesFor(definition).join(" & ")} · `
        : "";
      buildings.push(
        addCard(
          "building-options",
          presentation.build,
          definition,
          `${trains}${footprintSize(definition.footprint.occupiedTiles)} tiles`,
          definition.constructionSeconds,
        ),
      );
    }
    if (presentation?.train && definition.movement) {
      const card = addCard(
        "training-options",
        presentation.train,
        definition,
        `Speed ${definition.movement.speed}`,
        definition.trainingSeconds,
      );
      card.button.disabled = true;
      card.card.hidden = true;
      train.push(card);
    }
  }
  buildings.sort(
    (a, b) => buildOrder(a.definitionId) - buildOrder(b.definitionId),
  );
  element("building-options").append(...buildings.map(({ card }) => card));
  setText(
    element("construction-instructions"),
    buildings.length
      ? "Choose a structure to place."
      : "This scenario has no construction.",
  );
  element("production-status").hidden = !definitions.some(
    (definition) => definition.production,
  );
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
        selectedActorIds: ReadonlySet<string>,
        disabled: boolean,
      ) => {
        for (const [id, button] of buttons) {
          button.setAttribute("aria-pressed", String(selectedActorIds.has(id)));
          button.disabled = disabled;
        }
      },
    };
  };
  const roster = createActorList(
    element("unit-roster"),
    "No units yet. Select a production building to train your first unit.",
  );
  const preparation = createGoalList(element("scenario-goals"));
  const objectiveList = element("mission-objectives");
  const missionGoals = createGoalList(objectiveList, true);
  const missionDirective = element("mission-directive");
  objectiveList.hidden = true;
  missionDirective.hidden = true;
  let actorsById = new Map<string, ActorRenderState>();
  let actorVersion: number | undefined;
  let selectionKey = "";
  let disabled: boolean | undefined;
  /** Selecting an owned production building opens its training cards. */
  const showActor = (
    actor: Pick<ActorRenderState, "definitionId" | "owner">,
  ) => {
    if (owns(actor) && definitionById.get(actor.definitionId)?.production)
      showTab("panel-units");
  };
  root.addEventListener(
    "click",
    (event) => {
      if (!(event.target instanceof Element)) return;
      const button = event.target.closest<HTMLButtonElement>("button");
      if (!button || button.disabled) return;
      if (button.getAttribute("role") === "tab")
        showTab(button.getAttribute("aria-controls")!);
      else if (button === goalsButton)
        showTab(
          goalsButton.getAttribute("aria-expanded") === "true"
            ? productionPanel
            : "panel-goals",
        );
      else if (button === trainingLink) showTab("panel-units");
      else if (button.dataset.actorId) {
        const actor = actorsById.get(button.dataset.actorId);
        if (!actor) return;
        selectActor(actor.id, event.shiftKey);
        showActor(actor);
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
  showTab(buildings.length ? "panel-buildings" : "panel-units");
  return {
    controls: {
      rallyRoot: root,
      networkRoot: options.economy ? root : undefined,
      economyRoot: options.economy ? root : undefined,
      buildings,
      train,
      remove,
      boxSelect,
      addSelection,
      queueOrders,
      stop,
      attackMove: element<HTMLButtonElement>("attack-move"),
      cancelAttackMove: element<HTMLButtonElement>("cancel-attack-move"),
      clearSelection,
      focusSelection,
      followSelection,
      movementStatus: element("movement-status"),
      rotate: element<HTMLButtonElement>("rotate-building"),
      confirm: element<HTMLButtonElement>("confirm-building"),
      cancel: element<HTMLButtonElement>("cancel-building"),
      status: element("placement-status"),
      productionStatus: element("production-status"),
      animate: element<HTMLInputElement>("animate-building"),
    },
    showActor,
    showGoals: () => showTab("panel-goals"),
    update: (state: SidebarState) => {
      relations = state.relations;
      const objectives = state.objectives ?? [];
      objectiveList.hidden = objectives.length === 0;
      missionDirective.hidden = !state.result;
      setText(
        missionDirective,
        state.result ? RESULT_DIRECTIVES[state.result.kind] : "",
      );
      missionGoals.update(objectives);
      placementActions.hidden = !state.placementActive;
      placementPanel.hidden = !state.placementActive && !state.faulted;
      remove.disabled = !state.canRemove;
      const blocker = productionBlocker(
        {
          defeated: state.result?.kind === "defeat",
          faulted: state.faulted,
          paused: !!state.paused,
          placing: state.placementActive,
        },
        "build",
      );
      for (const action of buildings) {
        const definition = definitionById.get(action.definitionId)!;
        const cost = costAmount(definition);
        const balance = state.balances?.[costResource(definition)];
        const workerSelected =
          !definition.growth ||
          growthCandidates(
            { definitionId: definition.id, owner: options.playerOwner },
            state.selectedActorIds,
            state.actors,
            definitionById,
          ).length > 0;
        setActionAvailability(
          action,
          blocker ||
            (!workerSelected
              ? `Select a ${nameFor(definition.growth!.workerDefinitionId)} to tend construction.`
              : balance !== undefined && balance < cost
                ? `Need ${costLabel(definition)}; available ${balance}.`
                : ""),
        );
      }
      const ids = state.selectedActorIds;
      const selected = new Set(ids);
      remove.hidden = !state.actors.some(
        (actor) =>
          selected.has(actor.id) && owns(actor) && isTilePlacedActor(actor),
      );
      // Box mode changes how terrain taps behave, so it changes the hint;
      // relationship events change what a selected actor's hint offers.
      const nextSelectionKey = JSON.stringify([
        ids,
        state.boxMode ?? false,
        state.paused ?? false,
        state.actors
          .filter((actor) => selected.has(actor.id))
          .map(player.relationTo),
      ]);
      const unavailable = state.placementActive || state.faulted;
      boxSelect.disabled = unavailable;
      addSelection.disabled = unavailable;
      queueOrders.disabled = unavailable;
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
      stop.disabled =
        unavailable ||
        !!state.paused ||
        !state.actors.some(
          (actor) =>
            selected.has(actor.id) &&
            owns(actor) &&
            isMobileActor(actor, definitionById.get(actor.definitionId)),
        );
      const inspected =
        ids.length === 1
          ? state.actors.find((actor) => actor.id === ids[0])
          : undefined;
      const trainable =
        inspected && owns(inspected)
          ? trainableUnitIds(inspected, definitionById)
          : [];
      for (const { definitionId, card } of train) {
        card.hidden = !trainable.includes(definitionId);
        if (!card.hidden) continue;
        cards.hide(card);
        if (card.contains(document.activeElement)) element("tab-units").focus();
      }
      const maximum =
        inspected && definitionById.get(inspected.definitionId)?.health;
      selectionHealth.hidden = !maximum;
      if (inspected && maximum)
        setText(
          selectionHealth,
          `Health ${Math.ceil(inspected.health ?? maximum)} / ${maximum}`,
        );
      clearSelection.disabled = unavailable || ids.length === 0;
      focusSelection.disabled = ids.length === 0;
      followSelection.setAttribute(
        "aria-pressed",
        String(state.following ?? false),
      );
      followSelection.disabled =
        !state.following &&
        !state.actors.some(
          (actor) =>
            selected.has(actor.id) &&
            isMobileActor(actor, definitionById.get(actor.definitionId)),
        );
      const membershipChanged = state.actorVersion !== actorVersion;
      if (membershipChanged) {
        actorVersion = state.actorVersion;
        actorsById = new Map(state.actors.map((actor) => [actor.id, actor]));
        roster.sync(
          state.actors.filter(
            (actor) => !isTilePlacedActor(actor) && owns(actor),
          ),
        );
        const counts = countByDefinition(state.actors.filter(owns));
        preparation.update(
          goals.map(({ definitionId, label, directive }) => {
            const current = counts.get(definitionId) ?? 0;
            return {
              id: definitionId,
              label,
              directive,
              status: current ? "complete" : "active",
              progress: { current },
            };
          }),
        );
      }
      if (
        membershipChanged ||
        selectionKey !== nextSelectionKey ||
        disabled !== unavailable
      ) {
        selectionKey = nextSelectionKey;
        const selectedActorId = ids.length === 1 ? ids[0] : undefined;
        disabled = unavailable;
        roster.updateSelection(selected, disabled);
        const actor = selectedActorId
          ? actorsById.get(selectedActorId)
          : undefined;
        const definition = actor && definitionById.get(actor.definitionId)!;
        const presentation = actor && presentations.get(actor.definitionId);
        trainingLink.hidden = !actor || !owns(actor) || !definition?.production;
        const moveSubject = ids.length > 1 ? "the group" : "this unit";
        const moveHint = state.paused
          ? "Resume the mission to issue orders."
          : state.boxMode
            ? `Turn off Box select to move ${moveSubject}.`
            : `Tap or click terrain to move ${moveSubject}.`;
        if (ids.length > 1) {
          const counts = countByDefinition(
            ids.flatMap((id) => actorsById.get(id) ?? []),
          );
          selectionDetails.textContent = `${ids.length} units selected`;
          selectionInfo.textContent = `${[...counts].map(([id, count]) => `${nameFor(id)} × ${count}`).join(" · ")}. ${moveHint}`;
          return;
        }
        selectionDetails.textContent = actor
          ? isTilePlacedActor(actor)
            ? `${nameFor(actor.definitionId)} · ${footprintSize(occupiedTilesFor(actor, definition!))} · ${actor.tilePlacement.quarterTurns * 90}°`
            : nameFor(actor.definitionId)
          : "Nothing selected";
        const relation = actor && player.relationTo(actor);
        if (!actor) {
          selectionInfo.textContent =
            "Choose a unit or building on the map, or a field unit in Units.";
        } else if (relation !== "own") {
          let label = "Neutral";
          if (relation === "hostile") label = "Hostile";
          else if (relation === "allied") label = "Allied";
          selectionInfo.textContent = [
            label,
            presentation?.description,
            relation === "hostile"
              ? "Select your units, then click or tap it to attack."
              : "Not under your command.",
          ]
            .filter(Boolean)
            .join(" · ");
        } else if (definition?.production) {
          selectionInfo.textContent = `${presentation?.description ?? "Unit production"} · Trains ${namesFor(definition).join(" and ")}.`;
        } else if (isTilePlacedActor(actor)) {
          selectionInfo.textContent = `${presentation?.description ?? "Building"} · Select Buildings to expand your base.`;
        } else {
          selectionInfo.textContent = `${presentation?.description ?? "Unit"} · Movement speed ${definition?.movement?.speed} · ${moveHint}`;
        }
      }
    },
    dispose: lifetime.dispose,
  };
}
