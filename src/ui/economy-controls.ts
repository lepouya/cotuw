import {
  cultivationEfficiency,
  cultivationStatus,
} from "../simulation/cultivation";
import {
  costCurrency,
  costLabel,
  harvestingRecoveryCost,
  lootAmount,
  lootResource,
  refineryOccupied,
  resourceName,
  saleRefund,
} from "../simulation/economy";
import type {
  CultivationSite,
  CultivatorState,
} from "../simulation/cultivation";
import { disconnectedBuildings } from "../simulation/support";
import { ECONOMY_COMMAND_KINDS, isOutcomeOf } from "../simulation/command";
import { setText } from "./dom";
import type {
  EconomyReason,
  EconomyView,
  HarvesterState,
} from "../simulation/economy";
import type { MissionSimulation } from "../simulation/mission";
import type { ActorDefinition, ActorRenderState } from "../simulation/actor";
import type { CommandOutcome, MissionCommand } from "../simulation/command";
import type { TileCoord } from "../simulation/grid";
import type { WorldPosition } from "../simulation/world";

const REASONS: Record<EconomyReason, string> = {
  "invalid-cultivator": "Select a cultivating worker first.",
  "invalid-growth": "Choose an unfinished growing building.",
  "tender-occupied": "This building already has a tending worker.",
  "invalid-harvester": "Select a Harvester first.",
  "missing-site": "Choose a resource site.",
  "missing-refinery": "Assign this Harvester to an empty Refinery first.",
  "refinery-occupied":
    "This Refinery already has an assigned Harvester or paid order.",
  "empty-cargo": "This worker has no cargo to deliver.",
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

const CULTIVATOR_PHASES: Record<
  Exclude<CultivatorState["phase"], "tending" | "no-dropoff">,
  string
> = {
  idle: "Idle",
  travelling: "Travelling to site",
  gathering: "Cultivating",
  returning: "Returning cargo",
  waiting: "Waiting for site recovery",
  blocked: "Route blocked",
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
    queueMode?: () => boolean;
    canControl?: (actor: ActorRenderState) => boolean;
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
  const canControl = options.canControl ?? (() => true);
  const nameOf = (id: string | undefined) =>
    (id && options.names.get(id)) || "";
  const definitionWith = (has: (definition: ActorDefinition) => unknown) =>
    options.definitions.find(has);
  // Growth and cultivation roles come from content rather than faction names.
  const cultivatorDefinition = definitionWith(({ cultivation }) => cultivation);
  const cultivator = nameOf(cultivatorDefinition?.id) || "cultivating worker";
  const dropoff =
    nameOf(
      definitionWith(({ cultivationDropoff }) => cultivationDropoff)?.id,
    ) || "drop-off building";
  const headquarters =
    nameOf(
      definitionWith(({ growth }) => growth)?.growth?.headquartersDefinitionId,
    ) || "headquarters";
  const percent = (amount: number, total: number) =>
    Math.round((amount / total) * 100);
  const siteSummary = (site: CultivationSite) =>
    `${site.name} · ${cultivationStatus(site)} · ${percent(site.reserve, site.capacity)}% reserve · ${percent(cultivationEfficiency(site), 1)}% efficiency${site.dormant ? ` · Reopens at ${percent(site.recoverAt, site.capacity)}%` : ""}`;
  const actions = new Map<string, (shiftKey: boolean) => void>();
  const buttons = new Map<string, HTMLButtonElement>();
  const sync = (
    container: HTMLElement,
    entries: {
      key: string;
      text: string;
      disabled: boolean;
      action: (shiftKey: boolean) => void;
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
      setText(button, entry.text);
      button.disabled = entry.disabled;
      actions.set(entry.key, entry.action);
      if (container.children[index] !== button)
        container.insertBefore(button, container.children[index] ?? null);
    });
  };
  const submit = (command: MissionCommand, shiftKey = false) => {
    if (!options.enabled()) return;
    simulation.submitCommand(
      (command.kind === "move" || command.kind === "gather") &&
        (shiftKey || options.queueMode?.())
        ? { ...command, queued: true }
        : command,
    );
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
        actions.get(button.dataset.economyAction!)?.(event.shiftKey);
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
      const selected = id ? actors.get(id) : undefined;
      const actor = selected && canControl(selected) ? selected : undefined;
      const resourcePatches = patches(economy, options.explored);
      const definition = actor && definitions.get(actor.definitionId);
      const worker =
        actor &&
        economy.harvesters.find((worker) => worker.actorId === actor.id);
      const cultivation = economy.cultivation;
      const cultivating = cultivation?.workers.find(
        (worker) => worker.actorId === actor?.id,
      );
      const cultivationSites =
        cultivation?.sites.filter((site) => options.explored(site.tile)) ?? [];
      const enabled = options.enabled();
      const disconnected = disconnectedBuildings(simulation.support);
      const refineries = simulation.actors.filter(
        (actor) =>
          canControl(actor) && definitions.get(actor.definitionId)?.refinery,
      );
      const details = element("harvester-actions");
      details.hidden = !worker && !cultivating;
      setText(
        element("worker-activity-heading"),
        cultivating ? "Cultivation and tending" : "Materials gathering",
      );
      element("refinery-assignment-heading").hidden = !!cultivating;
      details.setAttribute(
        "aria-label",
        cultivating ? "Cultivation controls" : "Harvesting controls",
      );
      if (cultivating) {
        const tending = actors.get(cultivating.tendingId ?? "")?.construction;
        const phase =
          cultivating.phase === "no-dropoff"
            ? `Delivery blocked: no reachable ${dropoff}`
            : cultivating.phase !== "tending"
              ? CULTIVATOR_PHASES[cultivating.phase]
              : tending?.active
                ? "Tending growth"
                : !tending?.headquartersId
                  ? `Waiting for an operational ${headquarters}`
                  : actor?.movement?.blocked
                    ? "Tending route blocked"
                    : actor?.movement
                      ? "Travelling to tend growth"
                      : `Waiting for ${headquarters} capacity`;
        setText(
          element("harvester-details"),
          `Cargo ${cultivating.cargo}/${definition!.cultivation!.capacity} ${resourceName("lifebloom")} · ${phase}`,
        );
        sync(element("refinery-assignments"), []);
        sync(element("gather-sites"), [
          ...cultivationSites.map((site) => ({
            key: `cultivate:${site.id}`,
            text: `Gather ${siteSummary(site)}`,
            disabled: !enabled,
            action: (shiftKey: boolean) =>
              submit(
                {
                  kind: "gather",
                  actorId: cultivating.actorId,
                  siteId: site.id,
                },
                shiftKey,
              ),
          })),
          ...simulation.actors
            .filter(
              (building) =>
                building.construction &&
                definitions.get(building.definitionId)?.growth &&
                canControl(building),
            )
            .map((building) => ({
              key: `tend:${building.id}`,
              text: `Tend ${options.names.get(building.definitionId)}`,
              disabled:
                !enabled ||
                cultivation!.workers.some(
                  (worker) => worker.tendingId === building.id,
                ),
              action: () =>
                submit({
                  kind: "tend",
                  actorId: cultivating.actorId,
                  buildingId: building.id,
                }),
            })),
        ]);
      }
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
            action: (shiftKey) =>
              submit(
                {
                  kind: "gather",
                  actorId: worker.actorId,
                  siteId: site.id,
                },
                shiftKey,
              ),
          })),
        );
      }
      const selectedWorker = worker ?? cultivating;
      sync(
        element("return-cargo-actions"),
        selectedWorker
          ? [
              {
                key: "return-cargo",
                text: "Return cargo",
                disabled:
                  !enabled ||
                  !selectedWorker.cargo ||
                  (!!worker && !worker.refineryId),
                action: () =>
                  submit({
                    kind: "return-cargo",
                    actorId: selectedWorker.actorId,
                  }),
              },
            ]
          : [],
      );
      if (!selectedWorker) {
        sync(element("refinery-assignments"), []);
        sync(element("gather-sites"), []);
      }
      const construction = simulation.actors.filter(
        (actor) => canControl(actor) && actor.construction,
      );
      const constructionStatus = ({
        id,
        definitionId,
        construction,
      }: ActorRenderState) =>
        definitions.get(definitionId)?.growth
          ? !cultivation?.workers.some((worker) => worker.tendingId === id)
            ? "Untended · Paused"
            : !construction?.headquartersId
              ? `No ${headquarters} capacity · Paused`
              : construction.active
                ? "Growing"
                : "Worker travelling or waiting for infrastructure"
          : disconnected.has(id)
            ? "Disconnected · Paused"
            : construction?.active
              ? "Building"
              : "Queued";
      sync(
        element("construction-queue"),
        construction.map((actor) => ({
          key: `construction:${actor.id}`,
          text: `${options.names.get(actor.definitionId)} · ${constructionStatus(actor)} · ${secondsLeft(actor.construction!)}s remaining · Cancel (+${actor.construction!.paidCost})`,
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
        constructionDetails.textContent = `${constructionStatus(selectedConstruction)} · ${secondsLeft(selectedConstruction.construction!)}s remaining`;
      const jobs = economy.production.filter(
        (job) => job.producerId === actor?.id,
      );
      const mobile = definition?.movement ? actor : undefined;
      sync(element("resource-overview"), [
        ...cultivationSites.map((site) => ({
          key: `show-cultivation:${site.id}`,
          text: `Show ${siteSummary(site)}`,
          disabled: !enabled,
          action: () => options.focus(site.tile),
        })),
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
            text: `${mobile ? "Collect" : "Show"} ${lootResource(cache) === "materials" ? "salvage" : cache.name} (+${lootAmount(cache)} ${resourceName(lootResource(cache))})`,
            disabled: !enabled,
            action: (shiftKey: boolean) => {
              options.focus(cache.tile);
              if (mobile) {
                submit(
                  {
                    kind: "move",
                    actorId: mobile.id,
                    target: options.positionForTile(cache.tile),
                  },
                  shiftKey,
                );
              }
            },
          })),
      ]);
      sync(
        element("production-queue"),
        jobs.map((job) => ({
          key: `cancel:${job.actorId}`,
          text: `${options.names.get(job.definitionId)} · ${disconnected.has(job.producerId) ? `Disconnected · Paused · ${secondsLeft(job)}s remaining` : job.exitBlocked ? "Exit blocked" : `${secondsLeft(job)}s remaining`} · Cancel (+${job.paidCost})`,
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
      if (cultivation) {
        const hasPhase = (phase: string) =>
          cultivation.workers.some((worker) => worker.phase === phase);
        if (hasPhase("no-dropoff"))
          status = `Delivery blocked: grow a reachable ${dropoff}. Cargo is retained.`;
        else if (hasPhase("waiting"))
          status = `${cultivator}s are waiting for site recovery. Rotate sites for faster income.`;
        else if (hasPhase("blocked"))
          status = `A ${cultivator} route is blocked. Clear the route or issue a new order.`;
        else if (cultivation.workers.length === 0) {
          status = cultivatorDefinition
            ? `Select the ${headquarters} and train a ${cultivator} for ${costLabel(cultivatorDefinition)}.`
            : "No cultivation workers are available in this mission.";
        } else if (
          !simulation.actors.some(
            (actor) =>
              !actor.construction &&
              definitions.get(actor.definitionId)?.cultivationDropoff,
          )
        )
          status = `Select a ${cultivator} and grow a ${dropoff}. Keep it nearby to tend growth, then choose Gather.`;
        else
          status = `One ${cultivator} per site is sustainable. Additional workers increase immediate income and can trigger dormancy. Rotate sites or wait for recovery.`;
      } else if (warning) {
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
      setText(element("economy-alert"), status);
      const currency = definition ? costCurrency(definition) : "";
      const remove = element("remove-building");
      remove.textContent = actor?.construction
        ? `Cancel construction (+${actor.construction.paidCost} ${currency})`
        : definition && actor!.tilePlacement
          ? `Sell building (+${saleRefund(actor!, definition)} ${currency})`
          : "Sell selected building";
      if (lastResult) element("harvester-status").textContent = lastResult;
    },
    onOutcome: (outcome: CommandOutcome) => {
      if (isOutcomeOf(outcome, ...ECONOMY_COMMAND_KINDS)) {
        lastResult = outcome.accepted
          ? outcome.queued
            ? "Order queued."
            : "Order accepted."
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
