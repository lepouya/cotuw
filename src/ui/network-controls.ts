import type { OwnerView } from "../simulation/owner-view";
import { setText } from "./dom";

export type NetworkControls = {
  network?: { toggle: HTMLInputElement; status: HTMLElement };
};

export function createNetworkControls(
  player: Pick<OwnerView, "support">,
  controls: NetworkControls,
  options: {
    /** The selected actor the player controls. */
    selectedActorId: () => string | undefined;
    /** World units per tile, for showing support radii in tiles. */
    tileSize: number;
    /** The headquarters name that support paths lead to. */
    supportHub: (actorId: string) => string;
  },
) {
  const elements = controls.network;
  const toggle = elements?.toggle;
  return {
    get visible() {
      return toggle?.checked ?? false;
    },
    refresh: () => {
      const id = options.selectedActorId();
      const node = player.support()?.nodes.find((node) => node.actorId === id);
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
