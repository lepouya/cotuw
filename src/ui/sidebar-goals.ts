import { createGoalList } from "./goals";
import { createElement as el, setText } from "./dom";
import { presentResult } from "./mission-result";
import { countByDefinition } from "./sidebar-context";
import { rosterIncludes } from "../simulation/ownership";
import type { SidebarContext, SidebarState } from "./sidebar-context";
import "./sidebar-goals.css";

export function createSidebarGoals({
  briefing,
  definitions,
  definitionById,
  playerFaction,
  economy,
  goals,
  owns,
}: SidebarContext) {
  const rosterHasSupport = definitions.some(
    (definition) =>
      rosterIncludes(playerFaction, definition) && definition.support,
  );
  const missionDirective = el("p", {
    id: "mission-directive",
    class: "muted",
    role: "status",
    hidden: true,
  });
  const missionObjectives = el("ul", {
    id: "mission-objectives",
    class: "scenario-goals",
    hidden: true,
  });
  const scenarioGoals = el("ul", {
    id: "scenario-goals",
    class: "scenario-goals",
  });
  const networkView = el("input", { id: "network-view", type: "checkbox" });
  const networkViewControl = el(
    "label",
    {
      id: "network-view-control",
      class: "animation-control",
      hidden: !economy || !rosterHasSupport,
    },
    networkView,
    "Network View",
  );
  const animateBuilding = el("input", {
    id: "animate-building",
    type: "checkbox",
    checked: true,
  });
  const panelGoals = el(
    "section",
    {
      id: "panel-goals",
      role: "region",
      "aria-labelledby": "tab-goals",
      hidden: true,
    },
    el("p", { class: "eyebrow" }, "Scenario goals"),
    el("h2", { id: "scenario-title" }, briefing?.title ?? ""),
    el(
      "p",
      { class: "muted" },
      el("span", { id: "scenario-description" }, briefing?.description ?? ""),
    ),
    missionDirective,
    missionObjectives,
    el("h3", { id: "preparation-heading" }, briefing?.goalsHeading ?? ""),
    scenarioGoals,
    el(
      "p",
      { id: "scenario-goals-note", class: "muted" },
      briefing?.goalsNote ?? "",
    ),
    el("p", { id: "scenario-rules", class: "muted" }, briefing?.rules ?? ""),
    networkViewControl,
    el(
      "label",
      { class: "animation-control" },
      animateBuilding,
      "Building idle animation",
    ),
  );
  const preparation = createGoalList(scenarioGoals);
  const missionGoals = createGoalList(missionObjectives, true);
  let actorVersion: number | undefined;
  return {
    root: panelGoals,
    animate: animateBuilding,
    networkView,
    update: (state: SidebarState) => {
      networkViewControl.hidden =
        !economy ||
        !(
          rosterHasSupport ||
          state.actors.some(
            (actor) =>
              owns(actor) && definitionById.get(actor.definitionId)?.support,
          )
        );
      if (networkViewControl.hidden) networkView.checked = false;
      const objectives = state.objectives ?? [];
      missionObjectives.hidden = objectives.length === 0;
      missionDirective.hidden = !state.result;
      setText(
        missionDirective,
        state.result ? presentResult(state.result).directive : "",
      );
      missionGoals.update(objectives);
      if (state.actorVersion === actorVersion) return;
      actorVersion = state.actorVersion;
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
    },
  };
}
