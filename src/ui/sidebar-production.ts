import { footprintSize } from "../simulation/grid";
import {
  costAmount,
  costLabel,
  costResource,
  resourceName,
} from "../simulation/resources";
import { growthCandidates } from "../simulation/growth";
import { rosterIncludes } from "../simulation/ownership";
import { isTilePlacedActor } from "../simulation/placement";
import { trainableUnitIds } from "../simulation/production";
import { createProductionCards } from "./production-card";
import { productionBlocker, setActionAvailability } from "./production-action";
import { createButton, createElement as el, createKeyedList } from "./dom";
import { inspectedActor, ordersLocked } from "./sidebar-context";
import type { ActorDefinition, ActorRenderState } from "../simulation/actor";
import type { SidebarContext, SidebarState } from "./sidebar-context";
import "./sidebar-production.css";

type RosterRow = {
  actor: ActorRenderState;
  selected: boolean;
  disabled: boolean;
};

function createRoster(
  { nameFor, selectActor, signal }: SidebarContext,
  container: HTMLElement,
) {
  // Labels number each type separately and keep a unit's number for life.
  const nextNumbers = new Map<string, number>();
  return createKeyedList<RosterRow>(
    container,
    ({ actor }) => actor.id,
    ({ actor }) => {
      const number = nextNumbers.get(actor.definitionId) ?? 1;
      nextNumbers.set(actor.definitionId, number + 1);
      const node = createButton(`${nameFor(actor.definitionId)} · ${number}`, {
        class: "roster-item",
        "data-actor-id": actor.id,
      });
      const select = (event: MouseEvent) =>
        selectActor(actor.id, event.shiftKey);
      node.addEventListener("click", select);
      return {
        node,
        dispose: () => node.removeEventListener("click", select),
        update: ({ selected, disabled }) => {
          node.setAttribute("aria-pressed", String(selected));
          node.disabled = disabled;
        },
      };
    },
    signal,
  );
}

export function createSidebarProduction(
  context: SidebarContext,
  focusUnits: () => void,
) {
  const { definitions, presentations, definitionById, nameFor, owns } = context;
  const { trainedNames, economy, playerFaction, playerOwner } = context;
  const buildOrder = ({ id }: ActorDefinition) =>
    presentations.get(id)?.build?.order ?? 0;
  const buildable = definitions
    .filter(
      (definition) =>
        rosterIncludes(playerFaction, definition) &&
        presentations.get(definition.id)?.build &&
        definition.footprint,
    )
    .sort((left, right) => buildOrder(left) - buildOrder(right));
  const constructionInstructions = el(
    "p",
    { id: "construction-instructions", class: "muted" },
    buildable.length
      ? "Choose a structure to place."
      : "This scenario has no construction.",
  );
  const buildingOptions = el("div", {
    id: "building-options",
    class: "production-grid",
  });
  const constructionQueue = el("div", {
    id: "construction-queue",
    class: "actor-list",
    "aria-label": "Paid building construction",
  });
  const panelBuildings = el(
    "section",
    {
      id: "panel-buildings",
      role: "tabpanel",
      "aria-labelledby": "tab-buildings",
    },
    constructionInstructions,
    buildingOptions,
    constructionQueue,
  );
  const trainingOptions = el("div", {
    id: "training-options",
    class: "production-grid",
    role: "group",
    "aria-label": "Unit training",
  });
  const productionStatus = el("p", {
    id: "production-status",
    class: "muted",
    role: "status",
    hidden: !definitions.some((definition) => definition.production),
  });
  const economyAlert = el("p", {
    id: "economy-alert",
    class: "muted",
    role: "status",
  });
  const resourceOverview = el("div", {
    id: "resource-overview",
    class: "actor-list",
  });
  const economyOverview = el(
    "details",
    { id: "economy-overview", hidden: !economy, open: true },
    el("summary", {}, "Resource sites & salvage"),
    economyAlert,
    resourceOverview,
  );
  const unitRoster = el("div", {
    id: "unit-roster",
    class: "actor-list",
    "aria-label": "Field units",
  });
  const panelUnits = el(
    "section",
    {
      id: "panel-units",
      role: "tabpanel",
      "aria-labelledby": "tab-units",
      hidden: true,
    },
    trainingOptions,
    productionStatus,
    economyOverview,
    el(
      "details",
      { class: "roster-disclosure", open: true },
      el("summary", {}, "Field units"),
      unitRoster,
    ),
  );
  const emptyRoster = el(
    "p",
    { class: "muted" },
    "No units yet. Select a production building to train your first unit.",
  );
  unitRoster.append(emptyRoster);
  const roster = createRoster(context, unitRoster);
  const cards = createProductionCards(context.root, context.signal);
  const addCard = (
    container: HTMLElement,
    action: { id: string; label: string },
    definition: ActorDefinition,
    details: string,
    seconds = 0,
  ) =>
    cards.create(container, action, definition, {
      name: nameFor(definition.id),
      portrait: presentations.get(definition.id)?.portrait,
      details: [
        presentations.get(definition.id)?.description,
        details,
        ...(economy ? [costLabel(definition), `${seconds}s`] : []),
      ]
        .filter(Boolean)
        .join(" · "),
      cost: economy ? costLabel(definition) : undefined,
    });
  const buildings = buildable.map((definition) => {
    const trains = definition.production
      ? `Trains ${trainedNames(definition).join(" & ")} · `
      : "";
    return addCard(
      buildingOptions,
      presentations.get(definition.id)!.build!,
      definition,
      `${trains}${footprintSize(definition.footprint!.occupiedTiles)} tiles`,
      definition.constructionSeconds,
    );
  });
  const train = definitions
    .filter(
      (definition) =>
        presentations.get(definition.id)?.train && definition.movement,
    )
    .map((definition) => {
      const card = addCard(
        trainingOptions,
        presentations.get(definition.id)!.train!,
        definition,
        `Speed ${definition.movement!.speed}`,
        definition.trainingSeconds,
      );
      card.button.disabled = true;
      card.card.hidden = true;
      return card;
    });
  let shownRoster = "";
  return {
    panelBuildings,
    panelUnits,
    constructionQueue,
    resourceOverview,
    economyAlert,
    buildings,
    train,
    productionStatus,
    hideTooltip: cards.hide,
    update: (state: SidebarState) => {
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
        const resource = costResource(definition);
        const balance = state.balances?.[resource];
        const workerSelected =
          !definition.growth ||
          growthCandidates(
            { definitionId: definition.id, owner: playerOwner },
            state.selectedActorIds,
            state.actors,
            definitionById,
          ).length > 0;
        setActionAvailability(
          action,
          blocker ||
            (!workerSelected
              ? `Select a ${nameFor(definition.growth!.workerDefinitionId)} to tend construction.`
              : economy && balance === undefined
                ? `${resourceName(resource)} is unavailable.`
                : balance !== undefined && balance < cost
                  ? `Need ${costLabel(definition)}; available ${balance}.`
                  : ""),
        );
      }
      const inspected = inspectedActor(state);
      const trainable =
        inspected && owns(inspected)
          ? trainableUnitIds(inspected, definitionById)
          : [];
      for (const { definitionId, card } of train) {
        const hadFocus = card.contains(document.activeElement);
        card.hidden = !trainable.includes(definitionId);
        if (!card.hidden) continue;
        cards.hide(card);
        if (hadFocus) focusUnits();
      }
      const ids = state.selectedActorIds;
      const disabled = ordersLocked(state);
      const rosterKey = JSON.stringify([state.actorVersion, ids, disabled]);
      if (rosterKey === shownRoster) return;
      shownRoster = rosterKey;
      const selected = new Set(ids);
      const units = state.actors.filter(
        (actor) => !isTilePlacedActor(actor) && owns(actor),
      );
      emptyRoster.hidden = units.length > 0;
      roster.update(
        units.map((actor) => ({
          actor,
          selected: selected.has(actor.id),
          disabled,
        })),
      );
    },
  };
}
