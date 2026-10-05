import type { MissionSimulation } from "../simulation/mission";

export type NetworkControls = { networkRoot?: HTMLElement };

export function createNetworkControls(
  simulation: MissionSimulation,
  controls: NetworkControls,
  options: {
    selectedActorId: () => string | undefined;
    /** Whether the player controls the actor with this ID. */
    canControl?: (actorId: string) => boolean;
  },
) {
  const root = controls.networkRoot;
  const canControl = options.canControl ?? (() => true);
  const toggle = root?.querySelector<HTMLInputElement>("#network-view");
  return {
    get visible() {
      return toggle?.checked ?? false;
    },
    refresh: () => {
      const network = simulation.support;
      const node = network?.nodes.find(
        (node) =>
          node.actorId === options.selectedActorId() &&
          canControl(node.actorId),
      );
      for (const status of root?.querySelectorAll<HTMLElement>(
        "[data-network-status]",
      ) ?? []) {
        status.hidden = !node;
        status.textContent = !node
          ? ""
          : node.connected
            ? `Connected · ${node.complete ? `${node.radius} tile support radius` : "Blueprint does not extend coverage"}`
            : "Disconnected: no support path reaches the Command Center. Construction, production, and cargo delivery pause until reconnected.";
      }
    },
  };
}
