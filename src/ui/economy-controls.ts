import { disconnectedBuildings } from "../simulation/support";
import {
  harvestingRecoveryCost,
  materialsCost,
  refineryOccupied,
} from "../simulation/economy";
import { ECONOMY_COMMAND_KINDS, isOutcomeOf } from "../simulation/command";
import type {
  EconomyReason,
  EconomyView,
  HarvesterState,
} from "../simulation/economy";
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

const PHASES: Record<HarvesterState["phase"], string> = {
  idle: "Idle",
  travelling: "Travelling to Materials",
  gathering: "Gathering",
  returning: "Returning cargo",
  depleted: "Patch depleted. Assign a new patch",
  blocked: "Route blocked. Clear the route or choose another patch",
  unassigned: "Unassigned. Choose an empty Refinery",
};

/** Explored sites sharing a name form one patch, shown by its first site. */
function patches(economy: EconomyView, explored: (tile: TileCoord) => boolean) {
  const byName = new Map<
    string,
    { site: EconomyView["sites"][number]; remaining: number }
  >();
  for (const site of economy.sites.filter((site) => explored(site.tile))) {
    const patch = byName.get(site.name);
    if (patch) patch.remaining += site.remainingMaterials;
    else byName.set(site.name, { site, remaining: site.remainingMaterials });
  }
  return [...byName.values()];
}

/** Buttons remain stable while live cargo and production progress change. */
export function createEconomyControls(
  root: HTMLElement,
  simulation: Pick<
    MissionSimulation,
    "actors" | "economy" | "tickSeconds" | "submitCommand" | "support"
  >,
  options: {
    definitions: readonly ActorDefinition[];
    names: ReadonlyMap<string, string>;
    selectedActorId: () => string | undefined;
    enabled: () => boolean;
    focus: (tile: TileCoord) => void;
    /** Undiscovered sites and salvage stay unlisted. */
    explored: (tile: TileCoord) => boolean;
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
  const secondsLeft = (work: { completedTicks: number; totalTicks: number }) =>
    Math.ceil((work.totalTicks - work.completedTicks) * simulation.tickSeconds);
  let lastResult = "";
  return {
    refresh: () => {
      const economy = simulation.economy!;
      const id = options.selectedActorId();
      const actors = new Map(
        simulation.actors.map((actor) => [actor.id, actor]),
      );
      const actor = id ? actors.get(id) : undefined;
      const resourcePatches = patches(economy, options.explored);
      const definition = actor && definitions.get(actor.definitionId);
      const worker = economy.harvesters.find((worker) => worker.actorId === id);
      const enabled = options.enabled();
      const disconnected = disconnectedBuildings(simulation.support);
      const refineries = simulation.actors.filter(
        (actor) => definitions.get(actor.definitionId)?.refinery,
      );
      const details = element("harvester-actions");
      details.hidden = !worker;
      if (worker) {
        element("harvester-details").textContent =
          `Cargo ${worker.cargo}/${definition!.harvesting!.capacity} · ${PHASES[worker.phase]}${worker.refineryId && disconnected.has(worker.refineryId) ? " · Refinery disconnected; cargo delivery paused" : ""}`;
        sync(
          element("refinery-assignments"),
          refineries
            .filter(
              (refinery) =>
                !refinery.construction &&
                definitions.get(refinery.definitionId)?.refinery
                  ?.harvesterDefinitionId === actor!.definitionId,
            )
            .map((refinery, index) => ({
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
          resourcePatches.map(({ site, remaining }) => ({
            key: `gather:${site.id}`,
            text: `Gather ${site.name} (${remaining})`,
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
      const construction = simulation.actors.filter(
        (actor) => actor.construction,
      );
      const activeConstruction = construction.find(
        (actor) => !disconnected.has(actor.id),
      );
      sync(
        element("construction-queue"),
        construction.map((actor) => ({
          key: `construction:${actor.id}`,
          text: `${options.names.get(actor.definitionId)} · ${disconnected.has(actor.id) ? "Disconnected · Paused · " : actor === activeConstruction ? "Building · " : "Queued · "}${secondsLeft(actor.construction!)}s remaining · Cancel (+${actor.construction!.paidMaterials})`,
          disabled: !enabled,
          action: () =>
            submit({ kind: "cancel-construction", actorId: actor.id }),
        })),
      );
      const selectedConstruction = construction.find(
        (actor) => actor.id === id,
      );
      const constructionDetails = element("construction-details");
      constructionDetails.hidden = !selectedConstruction;
      if (selectedConstruction)
        constructionDetails.textContent = `${disconnected.has(selectedConstruction.id) ? "Disconnected · Construction paused" : activeConstruction === selectedConstruction ? "Building" : "Queued for construction"} · ${secondsLeft(selectedConstruction.construction!)}s remaining`;
      const jobs = economy.production.filter((job) => job.producerId === id);
      const mobile = definition?.movement ? actor : undefined;
      sync(element("resource-overview"), [
        ...resourcePatches.map(({ site, remaining }) => ({
          key: `focus:${site.id}`,
          text: `Show ${site.name} (${remaining})`,
          disabled: !enabled,
          action: () => options.focus(site.tile),
        })),
        ...economy.loot
          .filter((cache) => !cache.collected && options.explored(cache.tile))
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
          text: `${options.names.get(job.definitionId)} · ${disconnected.has(job.producerId) ? `Disconnected · Paused · ${secondsLeft(job)}s remaining` : job.exitBlocked ? "Exit blocked" : `${secondsLeft(job)}s remaining`} · Cancel (+${job.paidMaterials})`,
          disabled: !enabled,
          action: () =>
            submit({ kind: "cancel-production", actorId: job.actorId }),
        })),
      );
      const warning = economy.harvesters.find((worker) =>
        ["depleted", "blocked", "unassigned"].includes(worker.phase),
      );
      const emptyRefinery = refineries.find(
        (actor) => !actor.construction && !refineryOccupied(economy, actor.id),
      );
      const recoveryCost = harvestingRecoveryCost(
        economy,
        simulation.actors,
        definitions,
      );
      // The selected, fielded, or paid Harvester explains the delivery cycle.
      const harvesting = [
        ...(worker ? [actor!.definitionId] : []),
        ...economy.harvesters.map(
          (worker) => actors.get(worker.actorId)!.definitionId,
        ),
        ...economy.production.map((job) => job.definitionId),
      ]
        .map((id) => definitions.get(id)?.harvesting)
        .find(Boolean);
      const affordable = economy.materials >= recoveryCost;
      const idleWorker = economy.harvesters.find(
        (worker) =>
          worker.phase === "idle" && !actors.get(worker.actorId)?.movement,
      );
      let status: string;
      if (warning) {
        status =
          warning.phase === "depleted"
            ? "Patch depleted: select the idle Harvester and assign a new patch."
            : warning.phase === "unassigned"
              ? "Unassigned Harvester: select it and choose an empty Refinery."
              : "Harvesting route blocked: clear the route or reassign the Harvester.";
      } else if (
        construction.some(
          (actor) => definitions.get(actor.definitionId)?.refinery,
        )
      ) {
        status =
          "Refinery under construction. Produce its Harvester when it finishes.";
      } else if (idleWorker) {
        status = idleWorker.cargo
          ? "Idle Harvester: return its cargo or assign a Materials patch."
          : "Select the idle Harvester and choose Gather in Selection.";
      } else if (harvesting) {
        status = `A full load takes ${harvesting.loadSeconds} seconds, plus travel. Materials arrive on delivery.`;
      } else if (affordable) {
        status = emptyRefinery
          ? "Select an empty Refinery and produce its Harvester."
          : "Build a Refinery, then produce its Harvester.";
      } else {
        status =
          "Economy stalled: find Materials salvage or sell a building to recover.";
      }
      element("economy-alert").textContent = status;
      const remove = element("remove-building");
      remove.textContent = actor?.construction
        ? `Cancel construction (+${actor.construction.paidMaterials} Materials)`
        : definition
          ? `Sell building (+${Math.floor(materialsCost(definition) / 2)} Materials)`
          : "Sell selected building";
      if (lastResult) element("harvester-status").textContent = lastResult;
    },
    onOutcome: (outcome: CommandOutcome) => {
      if (isOutcomeOf(outcome, ...ECONOMY_COMMAND_KINDS)) {
        lastResult = outcome.accepted
          ? "Order accepted."
          : REASONS[outcome.reason ?? "invalid-harvester"];
      }
    },
    dispose: () => {
      controller.abort();
      for (const button of buttons.values()) button.remove();
      buttons.clear();
      actions.clear();
    },
  };
}
