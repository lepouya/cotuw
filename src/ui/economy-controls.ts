import { materialsCost, refineryOccupied } from "../simulation/economy";
import { isOutcomeOf } from "../simulation/command";
import type { EconomyReason } from "../simulation/economy";
import type { MissionSimulation } from "../simulation/mission";
import type { ActorDefinition } from "../simulation/actor";
import type { CommandOutcome, MissionCommand } from "../simulation/command";
import type { TileCoord } from "../simulation/grid";
import type { WorldPosition } from "../simulation/world";

const REASONS: Record<EconomyReason, string> = {
  "invalid-harvester": "Select a Harvester first.",
  "missing-site": "Choose a Materials site.",
  "missing-refinery": "Assign this Harvester to an empty Refinery first.",
  "refinery-occupied":
    "This Refinery already has an assigned Harvester or paid order.",
  "empty-cargo": "This Harvester has no cargo to deliver.",
  "missing-order":
    "This production order has already finished or been cancelled.",
};

/** Buttons remain stable while live cargo and production progress change. */
export function createEconomyControls(
  root: HTMLElement,
  simulation: MissionSimulation,
  options: {
    definitions: readonly ActorDefinition[];
    names: ReadonlyMap<string, string>;
    selectedActorId: () => string | undefined;
    enabled: () => boolean;
    focus: (tile: TileCoord) => void;
    positionForTile: (tile: TileCoord) => WorldPosition;
  },
) {
  const controller = new AbortController();
  const element = (id: string) => root.querySelector<HTMLElement>(`#${id}`)!;
  const definitions = new Map(
    options.definitions.map((definition) => [definition.id, definition]),
  );
  const actions = new Map<string, () => void>();
  const buttons = new Map<string, HTMLButtonElement>();
  const sync = (
    container: HTMLElement,
    entries: {
      key: string;
      text: string;
      disabled: boolean;
      action: () => void;
    }[],
  ) => {
    const keys = new Set(entries.map((entry) => entry.key));
    for (const [key, button] of buttons) {
      if (button.parentElement === container && !keys.has(key)) {
        button.remove();
        buttons.delete(key);
        actions.delete(key);
      }
    }
    entries.forEach((entry, index) => {
      let button = buttons.get(entry.key);
      if (!button) {
        button = document.createElement("button");
        button.type = "button";
        button.dataset.economyAction = entry.key;
        buttons.set(entry.key, button);
      }
      if (button.textContent !== entry.text) button.textContent = entry.text;
      button.disabled = entry.disabled;
      actions.set(entry.key, entry.action);
      if (container.children[index] !== button)
        container.insertBefore(button, container.children[index] ?? null);
    });
  };
  const submit = (command: MissionCommand) => {
    if (!options.enabled()) return;
    simulation.submitCommand(command);
    element("harvester-status").textContent = "Order submitted.";
  };
  root.addEventListener(
    "click",
    (event) => {
      if (!(event.target instanceof Element)) return;
      const button = event.target.closest<HTMLButtonElement>(
        "[data-economy-action]",
      );
      if (button && !button.disabled)
        actions.get(button.dataset.economyAction!)?.();
    },
    { signal: controller.signal },
  );
  let lastResult = "";
  return {
    refresh: () => {
      const economy = simulation.economy!;
      const id = options.selectedActorId();
      const worker = economy.harvesters.find((worker) => worker.actorId === id);
      const enabled = options.enabled();
      const details = element("harvester-actions");
      details.hidden = !worker;
      if (worker) {
        const actor = simulation.actors.find((actor) => actor.id === id)!;
        const capacity = definitions.get(actor.definitionId)!.harvesting!
          .capacity;
        const phases = {
          idle: "Idle",
          travelling: "Travelling to Materials",
          gathering: "Gathering",
          returning: "Returning cargo",
          depleted: "Patch depleted. Assign a new patch",
          blocked: "Route blocked. Clear the route or choose another patch",
          unassigned: "Unassigned. Choose an empty Refinery",
        };
        element("harvester-details").textContent =
          `Cargo ${worker.cargo}/${capacity} · ${phases[worker.phase]}`;
        const refineries = simulation.actors.filter(
          (actor) => definitions.get(actor.definitionId)?.refinery,
        );
        sync(
          element("refinery-assignments"),
          refineries.map((refinery, index) => ({
            key: `assign:${refinery.id}`,
            text: `${worker.refineryId === refinery.id ? "Assigned to" : "Assign to"} Refinery ${index + 1}`,
            disabled:
              !enabled ||
              worker.refineryId === refinery.id ||
              refineryOccupied(economy, refinery.id),
            action: () =>
              submit({
                kind: "assign-refinery",
                actorId: worker.actorId,
                refineryId: refinery.id,
              }),
          })),
        );
        sync(
          element("gather-sites"),
          economy.sites
            .filter(
              (site, index, sites) =>
                sites.findIndex((other) => other.name === site.name) === index,
            )
            .map((site) => ({
              key: `gather:${site.id}`,
              text: `Gather ${site.name} (${economy.sites.filter((other) => other.name === site.name).reduce((sum, other) => sum + other.remainingMaterials, 0)})`,
              disabled: !enabled || !worker.refineryId,
              action: () =>
                submit({
                  kind: "gather",
                  actorId: worker.actorId,
                  siteId: site.id,
                }),
            })),
        );
        sync(element("return-cargo-actions"), [
          {
            key: "return-cargo",
            text: "Return cargo",
            disabled: !enabled || !worker.cargo || !worker.refineryId,
            action: () =>
              submit({ kind: "return-cargo", actorId: worker.actorId }),
          },
        ]);
      }
      const jobs = economy.production.filter((job) => job.producerId === id);
      const mobile = simulation.actors.find(
        (actor) =>
          actor.id === id && definitions.get(actor.definitionId)?.movement,
      );
      sync(element("resource-overview"), [
        ...economy.sites
          .filter(
            (site, index, sites) =>
              sites.findIndex((other) => other.name === site.name) === index,
          )
          .map((site) => ({
            key: `focus:${site.id}`,
            text: `Show ${site.name} (${economy.sites.filter((other) => other.name === site.name).reduce((sum, other) => sum + other.remainingMaterials, 0)})`,
            disabled: !enabled,
            action: () => options.focus(site.tile),
          })),
        ...economy.loot
          .filter((cache) => !cache.collected)
          .map((cache) => ({
            key: `loot:${cache.id}`,
            text: `${mobile ? "Collect" : "Show"} salvage (+${cache.materials} Materials)`,
            disabled: !enabled,
            action: () => {
              options.focus(cache.tile);
              if (mobile) {
                submit({
                  kind: "move",
                  actorId: mobile.id,
                  target: options.positionForTile(cache.tile),
                });
              }
            },
          })),
      ]);
      sync(
        element("production-queue"),
        jobs.map((job) => ({
          key: `cancel:${job.actorId}`,
          text: `${options.names.get(job.definitionId)} · ${job.exitBlocked ? "Exit blocked" : `${Math.ceil((job.totalTicks - job.completedTicks) * simulation.tickSeconds)}s remaining`} · Cancel (+${job.paidMaterials})`,
          disabled: !enabled,
          action: () =>
            submit({ kind: "cancel-production", actorId: job.actorId }),
        })),
      );
      const warning = economy.harvesters.find((worker) =>
        ["depleted", "blocked", "unassigned"].includes(worker.phase),
      );
      const refineries = simulation.actors.filter(
        (actor) => definitions.get(actor.definitionId)?.refinery,
      );
      const emptyRefinery = refineries.find(
        (actor) => !refineryOccupied(economy, actor.id),
      );
      const recoveryCost = Math.min(
        ...options.definitions
          .filter((definition) => definition.refinery)
          .map(
            (definition) =>
              (emptyRefinery ? 0 : materialsCost(definition)) +
              materialsCost(
                definitions.get(definition.refinery!.harvesterDefinitionId)!,
              ),
          ),
      );
      const affordable = economy.materials >= recoveryCost;
      const idleWorker = economy.harvesters.find(
        (worker) =>
          worker.phase === "idle" &&
          !simulation.actors.find((actor) => actor.id === worker.actorId)
            ?.movement,
      );
      element("economy-alert").textContent = warning
        ? warning.phase === "depleted"
          ? "Patch depleted: select the idle Harvester and assign a new patch."
          : warning.phase === "unassigned"
            ? "Unassigned Harvester: select it and choose an empty Refinery."
            : "Harvesting route blocked: clear the route or reassign the Harvester."
        : idleWorker
          ? idleWorker.cargo
            ? "Idle Harvester: return its cargo or assign a Materials patch."
            : "Select the idle Harvester and choose Gather in Selection."
          : economy.harvesters.length ||
              economy.production.some(
                (job) => definitions.get(job.definitionId)?.harvesting,
              )
            ? "A full load takes 60 seconds, plus travel. Materials arrive on delivery."
            : affordable
              ? emptyRefinery
                ? "Select an empty Refinery and produce its Harvester."
                : "Build a Refinery, then produce its Harvester."
              : "Economy stalled: find Materials salvage or sell a building to recover.";
      const actor = simulation.actors.find((actor) => actor.id === id);
      const definition = actor && definitions.get(actor.definitionId);
      const remove = element("remove-building");
      remove.textContent = definition
        ? `Sell building (+${Math.floor(materialsCost(definition) / 2)} Materials)`
        : "Sell selected building";
      if (lastResult) element("harvester-status").textContent = lastResult;
    },
    onOutcome: (outcome: CommandOutcome) => {
      if (
        isOutcomeOf(outcome, "gather") ||
        isOutcomeOf(outcome, "assign-refinery") ||
        isOutcomeOf(outcome, "return-cargo") ||
        isOutcomeOf(outcome, "cancel-production")
      ) {
        lastResult = outcome.accepted
          ? "Order accepted."
          : REASONS[outcome.reason ?? "invalid-harvester"];
      }
    },
    dispose: () => controller.abort(),
  };
}
