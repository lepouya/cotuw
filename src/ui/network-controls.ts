import type { MissionSimulation } from "../simulation/mission";
import type { WorldPosition } from "../simulation/world";

export type NetworkControls = { networkRoot?: HTMLElement };

const ALERT_LIMIT = 6;

export function createNetworkControls(
  simulation: MissionSimulation,
  controls: NetworkControls,
  options: {
    selectedActorId: () => string | undefined;
    focus: (point: Readonly<WorldPosition>) => void;
  },
) {
  const root = controls.networkRoot;
  const toggle = root?.querySelector<HTMLInputElement>("#network-view");
  const controller = new AbortController();
  let previousNetwork = simulation.support;
  let previous = new Map(
    previousNetwork?.nodes.map((node) => [node.actorId, node.connected]),
  );
  const pending: { ids: string[]; connected: boolean }[] = [];
  const capture = () => {
    const network = simulation.support;
    if (network === previousNetwork) return;
    previousNetwork = network;
    const lost: string[] = [],
      restored: string[] = [];
    for (const node of network?.nodes ?? []) {
      const before = previous.get(node.actorId);
      if (before === true && !node.connected) lost.push(node.actorId);
      if (before === false && node.connected) restored.push(node.actorId);
    }
    if (lost.length) pending.push({ ids: lost, connected: false });
    if (restored.length) pending.push({ ids: restored, connected: true });
    pending.splice(0, Math.max(0, pending.length - ALERT_LIMIT));
    previous = new Map(
      network?.nodes.map((node) => [node.actorId, node.connected]),
    );
  };
  const alerts = root?.querySelector<HTMLElement>("#network-alerts");
  const notify = (ids: string[], connected: boolean) => {
    if (!ids.length || !alerts) return;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `${ids.length} building${ids.length === 1 ? "" : "s"} ${connected ? "reconnected" : "disconnected"}`;
    button.addEventListener(
      "click",
      () => {
        const actor = ids
          .map((id) => simulation.actors.find((actor) => actor.id === id))
          .find(Boolean);
        if (actor) options.focus(actor.worldPosition);
      },
      { signal: controller.signal },
    );
    alerts.prepend(button);
    while (alerts.children.length > ALERT_LIMIT)
      alerts.lastElementChild!.remove();
  };
  return {
    capture,
    get visible() {
      return toggle?.checked ?? false;
    },
    refresh: () => {
      capture();
      const network = simulation.support;
      const node = network?.nodes.find(
        (node) => node.actorId === options.selectedActorId(),
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
      for (const { ids, connected } of pending) notify(ids, connected);
      pending.length = 0;
    },
    dispose: () => {
      controller.abort();
      alerts?.replaceChildren();
    },
  };
}
