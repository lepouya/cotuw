import { createButton, createElement as el } from "./dom";
import type { SidebarContext } from "./sidebar-context";

/** Moves focus within the tab list, given the current index and tab count. */
const TAB_MOVES = new Map<string, (index: number, count: number) => number>([
  ["ArrowRight", (index, count) => (index + 1) % count],
  ["ArrowLeft", (index, count) => (index + count - 1) % count],
  ["Home", () => 0],
  ["End", (_index, count) => count - 1],
]);

type SidebarPanels = {
  buildings: HTMLElement;
  units: HTMLElement;
  goals: HTMLElement;
};

/** Owns the header, production tabs, and which panel is showing. */
export function createSidebarNavigation(
  { root, signal, factionName, briefing }: SidebarContext,
  panels: SidebarPanels,
  onShow: () => void,
) {
  const productionTab = (label: string, panel: HTMLElement) => ({
    button: createButton(label, {
      id: `tab-${label.toLowerCase()}`,
      role: "tab",
      "aria-controls": panel.id,
    }),
    panel,
  });
  const tabs = [
    productionTab("Buildings", panels.buildings),
    productionTab("Units", panels.units),
  ];
  const goalsButton = createButton("Goals", {
    id: "tab-goals",
    "aria-controls": panels.goals.id,
  });
  const content = el(
    "div",
    { class: "sidebar-content" },
    panels.buildings,
    panels.units,
    panels.goals,
  );
  const tabList = el(
    "div",
    { class: "sidebar-tabs", role: "tablist", "aria-label": "Command panels" },
    ...tabs.map(({ button }) => button),
  );
  // Goals temporarily replaces production; closing it restores this panel.
  let productionPanel = panels.buildings;
  const show = (shown: HTMLElement) => {
    const goals = shown === panels.goals;
    if (!goals) productionPanel = shown;
    content.scrollTop = 0;
    const focused = root.ownerDocument.activeElement;
    const moveFocus = content.contains(focused) && !shown.contains(focused);
    for (const { button, panel } of tabs) {
      const current = panel === productionPanel;
      button.setAttribute("aria-selected", String(current && !goals));
      button.tabIndex = current ? 0 : -1;
    }
    for (const panel of Object.values(panels)) panel.hidden = panel !== shown;
    goalsButton.setAttribute("aria-expanded", String(goals));
    onShow();
    if (moveFocus)
      (
        tabs.find(({ panel }) => panel === shown)?.button ?? goalsButton
      ).focus();
  };
  for (const { button, panel } of tabs)
    button.addEventListener("click", () => show(panel), { signal });
  goalsButton.addEventListener(
    "click",
    () =>
      show(
        goalsButton.getAttribute("aria-expanded") === "true"
          ? productionPanel
          : panels.goals,
      ),
    { signal },
  );
  tabList.addEventListener(
    "keydown",
    (event) => {
      const index = tabs.findIndex(({ button }) => button === event.target);
      const move = TAB_MOVES.get(event.key);
      if (index < 0 || !move) return;
      event.preventDefault();
      const next = tabs[move(index, tabs.length)]!;
      show(next.panel);
      next.button.focus();
    },
    { signal },
  );
  return {
    header: el(
      "header",
      { class: "sidebar-header" },
      el(
        "p",
        { id: "faction-label", class: "eyebrow" },
        factionName ?? "Expedition",
      ),
      el("h1", {}, "Unquiet World"),
      el(
        "p",
        { class: "muted" },
        el("span", { id: "scenario-label" }, briefing?.label ?? ""),
      ),
      goalsButton,
    ),
    pane: el("div", { class: "production-pane" }, tabList, content),
    show,
    focusUnits: () => tabs[1]!.button.focus(),
  };
}
