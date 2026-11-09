import {
  cultivationEfficiency,
  cultivationStatus,
} from "../simulation/cultivation";
import {
  collectsLoot,
  lootAmount,
  lootResource,
  saleRefund,
} from "../simulation/economy";
import { harvestingStalled } from "../simulation/harvesting";
import { refineryOccupied } from "../simulation/production";
import { costCurrency, costLabel, resourceName } from "../simulation/resources";
import type {
  CultivationSite,
  CultivatorState,
} from "../simulation/cultivation";
import { ECONOMY_COMMAND_KINDS, isOutcomeOf } from "../simulation/command";
import { contentRoles } from "./content-roles";
import { createButton, createKeyedList, setText } from "./dom";
import type { EconomyReason, EconomyView } from "../simulation/economy";
import type { HarvesterState } from "../simulation/harvesting";
import type { MissionSimulation } from "../simulation/mission";
import type { ActorDefinition, ActorRenderState } from "../simulation/actor";
import type {
  AuthorityReason,
  CommandOutcome,
  MissionCommand,
} from "../simulation/command";
import type { TileCoord } from "../simulation/grid";
import type { WorldPosition } from "../simulation/world";

type EconomyRoles = ReturnType<typeof contentRoles>;

const commandReasons = ({
  harvester,
  refinery,
}: EconomyRoles): Record<EconomyReason | AuthorityReason, string> => ({
  unauthorized: "You cannot command this unit.",
  "invalid-cultivator": "Select a cultivating worker first.",
  "invalid-growth": "Choose an unfinished growing building.",
  "tender-occupied": "This building already has a tending worker.",
  "unreachable-growth": "No selected worker can reach this building.",
  "invalid-harvester": `Select a ${harvester} first.`,
  "missing-site": "Choose a resource site.",
  "missing-refinery": `Assign this ${harvester} to an empty ${refinery} first.`,
  "refinery-occupied": `This ${refinery} already has an assigned ${harvester} or paid order.`,
  "empty-cargo": "This worker has no cargo to deliver.",
  "missing-order":
    "This production order has already finished or been cancelled.",
});

const harvesterPhases = (
  materials: string,
  { refinery }: EconomyRoles,
): Record<HarvesterState["phase"], string> => ({
  idle: "Idle",
  travelling: `Travelling to ${materials}`,
  gathering: "Gathering",
  returning: "Returning cargo",
  depleted: "Patch depleted. Assign a new patch",
  blocked: "Route blocked. Clear the route or choose another patch",
  unassigned: `Unassigned. Choose an empty ${refinery}`,
});

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

/** Known sites sharing a name form one patch, shown by its first site. */
function patches(economy: EconomyView) {
  const byName = new Map<
    string,
    { site: EconomyView["sites"][number]; remaining: number }
  >();
  for (const site of economy.sites) {
    const patch = byName.get(site.name);
    if (patch) patch.remaining += site.remainingMaterials;
    else byName.set(site.name, { site, remaining: site.remainingMaterials });
  }
  return [...byName.values()];
}

/** A keyed worker, queue, or site button. */
type EconomyAction = {
  key: string;
  text: string;
  disabled: boolean;
  action: (shiftKey: boolean) => void;
};

export type EconomyElements = {
  constructionDetails: HTMLElement;
  workerActivityHeading: HTMLElement;
  harvesterDetails: HTMLElement;
  gatherSites: HTMLElement;
  refineryAssignmentHeading: HTMLElement;
  refineryAssignments: HTMLElement;
  returnCargoActions: HTMLElement;
  harvesterStatus: HTMLElement;
  harvesterActions: HTMLElement;
  productionQueue: HTMLElement;
  removeBuilding: HTMLButtonElement;
  constructionQueue: HTMLElement;
  resourceOverview: HTMLElement;
  economyAlert: HTMLElement;
};

/** Buttons remain stable while live cargo and production progress change. */
export function createEconomyControls(
  elements: EconomyElements,
  simulation: Pick<MissionSimulation, "tickSeconds" | "submitCommand">,
  options: {
    definitions: readonly ActorDefinition[];
    names: ReadonlyMap<string, string>;
    /** The player's owner ID. */
    owner: string;
    /** The player's faction, for its roles and cultivation status. */
    faction: string | undefined;
    /** The player's own committed actors. */
    ownActors: () => readonly ActorRenderState[];
    selectedActorId: () => string | undefined;
    enabled: () => boolean;
    queueMode?: () => boolean;
    focus: (tile: TileCoord) => void;
    /**
     * The player's own workers, production, and balances, with sites and
     * salvage as the player last saw them.
     */
    economy: () => EconomyView | undefined;
    /** Shown buildings cut off from support. */
    offlineIds: () => ReadonlySet<string>;
    positionForTile: (tile: TileCoord) => WorldPosition;
  },
) {
  const controller = new AbortController();
  const definitions = new Map(
    options.definitions.map((definition) => [definition.id, definition]),
  );
  const nameOf = (id: string | undefined) =>
    (id && options.names.get(id)) || "";
  const definitionWith = (
    has: (definition: ActorDefinition) => unknown,
    faction?: string,
  ) =>
    options.definitions.find(
      (definition) =>
        (faction === undefined || definition.faction === faction) &&
        has(definition),
    );
  /** The headquarters kind that hosts a building's construction. */
  const headquartersFor = (definitionId: string) => {
    const building = definitions.get(definitionId);
    return (
      nameOf(
        building?.growth?.headquartersDefinitionId ??
          definitionWith(
            ({ infrastructure, faction }) =>
              infrastructure && faction === building?.faction,
            building?.faction,
          )?.id,
      ) || "headquarters"
    );
  };
  const rolesFor = (definitionId?: string) =>
    contentRoles(options.definitions, options.names, {
      definitionId,
      faction: options.faction,
    });
  const materials = resourceName("materials");
  const percent = (amount: number, total: number) =>
    Math.round((amount / total) * 100);
  const siteSummary = (site: CultivationSite) =>
    `${site.name} · ${cultivationStatus(site)} · ${percent(site.reserve, site.capacity)}% reserve · ${percent(cultivationEfficiency(site), 1)}% efficiency${site.dormant ? ` · Reopens at ${percent(site.recoverAt, site.capacity)}%` : ""}`;
  const actionList = (container: HTMLElement) =>
    createKeyedList<EconomyAction>(
      container,
      ({ key }) => key,
      ({ key }) => {
        const node = createButton("", { "data-economy-action": key });
        let run: EconomyAction["action"];
        const activate = (event: MouseEvent) => run(event.shiftKey);
        node.addEventListener("click", activate);
        return {
          node,
          dispose: () => node.removeEventListener("click", activate),
          update: ({ text, disabled, action }) => {
            setText(node, text);
            node.disabled = disabled;
            run = action;
          },
        };
      },
      controller.signal,
    );
  const lists = {
    gatherSites: actionList(elements.gatherSites),
    refineryAssignments: actionList(elements.refineryAssignments),
    returnCargoActions: actionList(elements.returnCargoActions),
    constructionQueue: actionList(elements.constructionQueue),
    resourceOverview: actionList(elements.resourceOverview),
    productionQueue: actionList(elements.productionQueue),
  };
  const submit = (command: MissionCommand, shiftKey = false) => {
    if (!options.enabled()) return;
    simulation.submitCommand(
      (command.kind === "move" || command.kind === "gather") &&
        (shiftKey || options.queueMode?.())
        ? { ...command, queued: true }
        : command,
      { owner: options.owner },
    );
    setText(elements.harvesterStatus, "Order submitted.");
  };
  const secondsLeft = (work: { completedTicks: number; totalTicks: number }) =>
    Math.ceil((work.totalTicks - work.completedTicks) * simulation.tickSeconds);
  let lastResult = "";
  return {
    refresh: () => {
      const economy = options.economy()!;
      const id = options.selectedActorId();
      const owned = options.ownActors();
      const actors = new Map(owned.map((actor) => [actor.id, actor]));
      const actor = id ? actors.get(id) : undefined;
      const resourcePatches = patches(economy);
      const definition = actor && definitions.get(actor.definitionId);
      const roles = rolesFor(definition?.id);
      const { harvester, refinery } = roles;
      const phases = harvesterPhases(materials, roles);
      const faction = definition?.faction ?? options.faction;
      const cultivatorDefinition = definition?.cultivation
        ? definition
        : definitionWith(({ cultivation }) => cultivation, faction);
      const cultivator =
        nameOf(cultivatorDefinition?.id) || "cultivating worker";
      const dropoff =
        nameOf(
          definitionWith(
            ({ cultivationDropoff }) => cultivationDropoff,
            faction,
          )?.id,
        ) || "drop-off building";
      const headquarters =
        nameOf(
          definitionWith(
            ({ growth }) =>
              growth && growth.workerDefinitionId === cultivatorDefinition?.id,
            faction,
          )?.growth?.headquartersDefinitionId,
        ) || "headquarters";
      const worker =
        actor &&
        economy.harvesters.find((worker) => worker.actorId === actor.id);
      const cultivation = economy.cultivation;
      const cultivating = cultivation?.workers.find(
        (worker) => worker.actorId === actor?.id,
      );
      const cultivationSites = cultivation?.sites ?? [];
      const enabled = options.enabled();
      const disconnected = options.offlineIds();
      const refineries = owned.filter(
        (actor) => definitions.get(actor.definitionId)?.refinery,
      );
      const details = elements.harvesterActions;
      details.hidden = !worker && !cultivating;
      setText(
        elements.workerActivityHeading,
        cultivating ? "Cultivation and tending" : `${materials} gathering`,
      );
      setText(elements.refineryAssignmentHeading, `Assigned ${refinery}`);
      elements.refineryAssignmentHeading.hidden = !!cultivating;
      details.setAttribute(
        "aria-label",
        cultivating ? "Cultivation controls" : "Harvesting controls",
      );
      const cultivatorPhase = ({
        phase,
        tendingId,
      }: Pick<CultivatorState, "phase" | "tendingId">) => {
        if (phase === "no-dropoff")
          return `Delivery blocked: no reachable ${dropoff}`;
        if (phase !== "tending") return CULTIVATOR_PHASES[phase];
        const tending = actors.get(tendingId ?? "");
        if (tending?.construction?.active) return "Tending growth";
        if (!tending?.headquartersId)
          return `Waiting for an operational ${headquarters}`;
        if (actor?.movement?.blocked) return "Tending route blocked";
        if (actor?.movement) return "Travelling to tend growth";
        return `Waiting for ${headquarters} capacity`;
      };
      if (cultivating) {
        setText(
          elements.harvesterDetails,
          `Cargo ${cultivating.cargo}/${definition!.cultivation!.capacity} ${resourceName("lifebloom")} · ${cultivatorPhase(cultivating)}`,
        );
        lists.refineryAssignments.update([]);
        lists.gatherSites.update([
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
          ...owned
            .filter(
              (building) =>
                building.construction &&
                definitions.get(building.definitionId)?.growth,
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
        setText(
          elements.harvesterDetails,
          `Cargo ${worker.cargo}/${definition!.harvesting!.capacity} · ${phases[worker.phase]}${worker.refineryId && disconnected.has(worker.refineryId) ? ` · ${refinery} disconnected; cargo delivery paused` : ""}`,
        );
        lists.refineryAssignments.update(
          refineries
            .filter(
              (refinery) =>
                !refinery.construction &&
                definitions.get(refinery.definitionId)?.refinery
                  ?.harvesterDefinitionId === actor!.definitionId,
            )
            .map((building, index) => ({
              key: `assign:${building.id}`,
              text: `${worker.refineryId === building.id ? "Assigned to" : "Assign to"} ${nameOf(building.definitionId) || refinery} ${index + 1}`,
              disabled:
                !enabled ||
                worker.refineryId === building.id ||
                refineryOccupied(economy, building.id),
              action: () =>
                submit({
                  kind: "assign-refinery",
                  actorId: worker.actorId,
                  refineryId: building.id,
                }),
            })),
        );
        lists.gatherSites.update(
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
      lists.returnCargoActions.update(
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
        lists.refineryAssignments.update([]);
        lists.gatherSites.update([]);
      }
      const construction = owned.filter((actor) => actor.construction);
      const constructionStatus = ({
        id,
        definitionId,
        construction,
        headquartersId,
      }: ActorRenderState) => {
        const growth = !!definitions.get(definitionId)?.growth;
        if (construction?.active) return growth ? "Growing" : "Building";
        const tended = cultivation?.workers.some(
          (worker) => worker.tendingId === id,
        );
        if (growth && !tended) return "Untended · Paused";
        if (!growth && disconnected.has(id)) return "Disconnected · Paused";
        if (!headquartersId)
          return `No ${headquartersFor(definitionId)} · Paused`;
        return growth
          ? "Worker travelling or waiting for infrastructure"
          : "Queued";
      };
      lists.constructionQueue.update(
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
      const constructionDetails = elements.constructionDetails;
      constructionDetails.hidden = !selectedConstruction;
      if (selectedConstruction)
        setText(
          constructionDetails,
          `${constructionStatus(selectedConstruction)} · ${secondsLeft(selectedConstruction.construction!)}s remaining`,
        );
      const jobs = economy.production.filter(
        (job) => job.producerId === actor?.id,
      );
      const mobile = definition?.movement ? actor : undefined;
      lists.resourceOverview.update([
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
        ...economy.loot.map((cache) => {
          const collector =
            mobile && collectsLoot(economy, options.owner, cache)
              ? mobile
              : undefined;
          return {
            key: `loot:${cache.id}`,
            text: `${collector ? "Collect" : "Show"} ${lootResource(cache) === "materials" ? "salvage" : cache.name} (+${lootAmount(cache)} ${resourceName(lootResource(cache))})`,
            disabled: !enabled,
            action: (shiftKey: boolean) => {
              options.focus(cache.tile);
              if (collector)
                submit(
                  {
                    kind: "move",
                    actorId: collector.id,
                    target: options.positionForTile(cache.tile),
                  },
                  shiftKey,
                );
            },
          };
        }),
      ]);
      lists.productionQueue.update(
        jobs.map((job) => ({
          key: `cancel:${job.actorId}`,
          text: `${options.names.get(job.definitionId)} · ${disconnected.has(job.producerId) ? `Disconnected · Paused · ${secondsLeft(job)}s remaining` : job.exitBlocked ? "Exit blocked" : `${secondsLeft(job)}s remaining`} · Cancel (+${job.paidCost})`,
          disabled: !enabled,
          action: () =>
            submit({ kind: "cancel-production", actorId: job.actorId }),
        })),
      );
      const harvesters = economy.harvesters;
      const warning = harvesters.find((worker) =>
        ["depleted", "blocked", "unassigned"].includes(worker.phase),
      );
      const emptyRefinery = refineries.find(
        (actor) => !actor.construction && !refineryOccupied(economy, actor.id),
      );
      // The selected, fielded, or paid Harvester explains the delivery cycle.
      const harvesting = [
        ...(worker ? [actor!.definitionId] : []),
        ...harvesters.map((worker) => actors.get(worker.actorId)!.definitionId),
        ...economy.production.map((job) => job.definitionId),
      ]
        .map((id) => definitions.get(id)?.harvesting)
        .find(Boolean);
      const stalled = harvestingStalled(
        economy,
        options.owner,
        owned,
        definitions,
      );
      const idleWorker = harvesters.find(
        (worker) =>
          worker.phase === "idle" && !actors.get(worker.actorId)?.movement,
      );
      const cultivators = cultivation?.workers ?? [];
      let status: string;
      const ownsCultivation = owned.some(
        (actor) => definitions.get(actor.definitionId)?.growth,
      );
      const playsCultivation =
        options.faction !== undefined &&
        options.definitions.some(
          (definition) =>
            definition.faction === options.faction && definition.cultivation,
        );
      if (cultivators.length || ownsCultivation || playsCultivation) {
        const hasPhase = (phase: string) =>
          cultivators.some((worker) => worker.phase === phase);
        if (hasPhase("no-dropoff"))
          status = `Delivery blocked: grow a reachable ${dropoff}. Cargo is retained.`;
        else if (hasPhase("waiting"))
          status = `${cultivator}s are waiting for site recovery. Rotate sites for faster income.`;
        else if (hasPhase("blocked"))
          status = `A ${cultivator} route is blocked. Clear the route or issue a new order.`;
        else if (cultivators.length === 0) {
          status = cultivatorDefinition
            ? `Select the ${headquarters} and train a ${cultivator} for ${costLabel(cultivatorDefinition)}.`
            : "No cultivation workers are available in this mission.";
        } else if (
          !owned.some(
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
            ? `Patch depleted: select the idle ${harvester} and assign a new patch.`
            : warning.phase === "unassigned"
              ? `Unassigned ${harvester}: select it and choose an empty ${refinery}.`
              : `Harvesting route blocked: clear the route or reassign the ${harvester}.`;
      } else if (
        construction.some(
          (actor) => definitions.get(actor.definitionId)?.refinery,
        )
      ) {
        status = `${refinery} under construction. Produce its ${harvester} when it finishes.`;
      } else if (idleWorker) {
        status = idleWorker.cargo
          ? `Idle ${harvester}: return its cargo or assign a ${materials} patch.`
          : `Select the idle ${harvester} and choose Gather in Selection.`;
      } else if (harvesting) {
        status = `A full load takes ${harvesting.loadSeconds} seconds, plus travel. ${materials} arrive on delivery.`;
      } else if (!stalled) {
        status = emptyRefinery
          ? `Select an empty ${refinery} and produce its ${harvester}.`
          : `Build a ${refinery}, then produce its ${harvester}.`;
      } else {
        status = `Economy stalled: find ${materials} salvage or sell a building to recover.`;
      }
      setText(elements.economyAlert, status);
      const currency = definition ? costCurrency(definition) : "";
      const remove = elements.removeBuilding;
      setText(
        remove,
        actor?.construction
          ? `Cancel construction (+${actor.construction.paidCost} ${currency})`
          : definition && actor!.tilePlacement
            ? `Sell building (+${saleRefund(actor!, definition)} ${currency})`
            : "Sell selected building",
      );
      if (lastResult) setText(elements.harvesterStatus, lastResult);
    },
    onOutcome: (outcome: CommandOutcome) => {
      if (isOutcomeOf(outcome, ...ECONOMY_COMMAND_KINDS)) {
        const actor = options
          .ownActors()
          .find(({ id }) => id === outcome.command.actorId);
        const reasons = commandReasons(rolesFor(actor?.definitionId));
        lastResult = outcome.accepted
          ? outcome.queued
            ? "Order queued."
            : "Order accepted."
          : reasons[outcome.reason ?? "invalid-harvester"];
      }
    },
    dispose: () => {
      controller.abort();
    },
  };
}
