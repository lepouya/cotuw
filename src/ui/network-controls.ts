import type { MissionSimulation } from "../simulation/mission";
import { setText } from "./dom";

export type NetworkControls = {
  network?: { toggle: HTMLInputElement; status: HTMLElement };
};

export function createNetworkControls(
  simulation: MissionSimulation,
  controls: NetworkControls,
  options: {
    selectedActorId: () => string | undefined;
    /** Whether the player controls the actor with this ID. */
    canControl?: (actorId: string) => boolean;
    /** World units per tile, for showing support radii in tiles. */
    tileSize: number;
    /** The headquarters name that support paths lead to. */
    supportHub: (actorId: string) => string;
  },
) {
  const elements = controls.network;
  const canControl = options.canControl ?? (() => true);
  const toggle = elements?.toggle;
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
      const tiles = (radius: number) =>
        Math.round((radius / options.tileSize) * 10) / 10;
      const status = elements?.status;
      if (status) {
        status.hidden = !node;
        setText(
          status,
          !node
            ? ""
            : node.connected
              ? `Connected · ${node.complete ? `${tiles(node.radius)} tile support radius` : "Blueprint does not extend coverage"}`
              : `Disconnected: no support path reaches the ${options.supportHub(node.actorId)}. Construction, production, and cargo delivery pause until reconnected.`,
        );
      }
    },
  };
}
