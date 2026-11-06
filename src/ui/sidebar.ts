import { mountFeature } from "./dom";
import { createSidebarContext } from "./sidebar-context";
import { createSidebarGoals } from "./sidebar-goals";
import { createSidebarNavigation } from "./sidebar-navigation";
import { createSidebarOrders } from "./sidebar-orders";
import { createSidebarProduction } from "./sidebar-production";
import { createSidebarSelection } from "./sidebar-selection";
import type { ActorRenderState } from "../simulation/actor";
import type {
  SidebarOptions,
  SidebarSection,
  SidebarState,
} from "./sidebar-context";
import "./sidebar.css";

export type { SidebarOptions, SidebarState } from "./sidebar-context";

/** Composes mission-owned sections from content and player-visible state. */
export function createSidebar(root: HTMLElement, options: SidebarOptions) {
  return mountFeature(root, "", ({ signal }) => {
    const context = createSidebarContext(root, options, signal);
    const production = createSidebarProduction(context, () =>
      navigation.focusUnits(),
    );
    const goals = createSidebarGoals(context);
    const selection = createSidebarSelection(context, () =>
      navigation.show(production.panelUnits),
    );
    const orders = createSidebarOrders(context);
    const navigation = createSidebarNavigation(
      context,
      {
        buildings: production.panelBuildings,
        units: production.panelUnits,
        goals: goals.root,
      },
      production.hideTooltip,
    );
    root.append(
      navigation.header,
      navigation.pane,
      selection.root,
      orders.placementPanel,
      orders.root,
    );
    navigation.show(
      production.buildings.length
        ? production.panelBuildings
        : production.panelUnits,
    );
    const sections: readonly SidebarSection[] = [
      production,
      goals,
      selection,
      orders,
    ];
    return {
      controls: {
        ...orders.controls,
        buildings: production.buildings,
        train: production.train,
        productionStatus: production.productionStatus,
        remove: selection.remove,
        animate: goals.animate,
        rally: selection.rally,
        network: options.economy
          ? { toggle: goals.networkView, status: selection.networkStatus }
          : undefined,
        economy: options.economy
          ? {
              ...selection.economy,
              constructionQueue: production.constructionQueue,
              resourceOverview: production.resourceOverview,
              economyAlert: production.economyAlert,
            }
          : undefined,
      },
      showActor: (actor: Pick<ActorRenderState, "definitionId" | "owner">) => {
        if (
          context.owns(actor) &&
          context.definitionById.get(actor.definitionId)?.production
        )
          navigation.show(production.panelUnits);
      },
      showGoals: () => navigation.show(goals.root),
      update: (state: SidebarState) => {
        for (const section of sections) section.update(state);
      },
    };
  });
}
