import { LEVEL_SOURCES } from "../../src/content/levels";
import {
  createSessionSimulation,
  loadMission,
} from "../../src/mission-loading";
import { cultivationStatus } from "../../src/simulation/cultivation";
import { costAmount } from "../../src/simulation/resources";
import { balanceOf, depositedBy } from "../../src/simulation/stockpiles";
import { isCount } from "../../src/simulation/validation";

import type { MissionCommand } from "../../src/simulation/command";
import type {
  CultivationSite,
  CultivatorPhase,
} from "../../src/simulation/cultivation";
import type { MissionSimulation } from "../../src/simulation/mission";

/** Worker site assignments in training order on the Circle introduction. */
type Plan = {
  id: string;
  sites: readonly string[];
  /** Moves the last-trained worker here once its assigned site strains. */
  rotateTo?: string;
};

const NEAR = "near-lifebloom";
const SOUTH = "south-lifebloom";
const CULTIVATOR = "circle-cultivator";

export const PLANS: readonly Plan[] = [
  { id: "one-near", sites: [NEAR] },
  { id: "one-per-site", sites: [NEAR, SOUTH] },
  { id: "two-near", sites: [NEAR, NEAR] },
  { id: "two-near-rotate", sites: [NEAR, NEAR], rotateTo: SOUTH },
  { id: "three-near", sites: [NEAR, NEAR, NEAR] },
  { id: "two-per-site", sites: [NEAR, NEAR, SOUTH, SOUTH] },
];

type SiteReport = {
  minReservePercent: number;
  strainedSeconds: number;
  dormantSeconds: number;
  dormancies: number;
};

export type StaffingReport = {
  plan: string;
  minutes: number;
  firstIncomeSeconds?: number;
  staffedSeconds: number;
  lifebloom: { deposited: number; perMinuteAfterStaffed: number };
  sites: Record<string, SiteReport>;
  /** Share of worker time per cultivation phase after staffing. */
  phases: Partial<Record<CultivatorPhase, number>>;
  deliveriesPerWorkerMinute: number;
};

const round = (value: number, places = 1) =>
  Math.round(value * 10 ** places) / 10 ** places;

/**
 * Plays the authored opening (Cultivator, then a Conservatory), staffs sites
 * by `plan` as Lifebloom allows, and measures income and site strain.
 */
export function runStaffing(plan: Plan, minutes = 10): StaffingReport {
  const mission = loadMission(LEVEL_SOURCES.get("circle-wolf-den")!);
  const workerCost = costAmount(
    mission.definitions.find(({ id }) => id === CULTIVATOR)!,
  );
  const sim = createSessionSimulation(mission);
  try {
    return measureStaffing(sim, plan, minutes, workerCost);
  } finally {
    sim.dispose();
  }
}

function measureStaffing(
  sim: MissionSimulation,
  plan: Plan,
  minutes: number,
  workerCost: number,
): StaffingReport {
  const cutoff = Math.ceil((minutes * 60) / sim.tickSeconds);
  if (!isCount(cutoff) || cutoff === 0)
    throw new RangeError(
      "Duration must resolve to a positive, safe tick count.",
    );
  const owner = sim.playerOwner;
  const seconds = () => sim.completedTicks * sim.tickSeconds;
  const lifebloom = () => balanceOf(sim.economy!, owner, "lifebloom") ?? 0;
  const delivered = () => depositedBy(sim.economy!, owner, "lifebloom");
  const economy = () => sim.economy!.cultivation!;

  const reservePercent = ({ reserve, capacity }: CultivationSite) =>
    (100 * reserve) / capacity;
  const sites = Object.fromEntries(
    economy().sites.map((site): [string, SiteReport] => [
      site.id,
      {
        minReservePercent: reservePercent(site),
        strainedSeconds: 0,
        dormantSeconds: 0,
        dormancies: 0,
      },
    ]),
  );
  const unknown = [
    ...plan.sites,
    ...(plan.rotateTo ? [plan.rotateTo] : []),
  ].filter((id) => !sites[id]);
  if (unknown.length)
    throw new Error(`${plan.id}: unknown sites ${unknown.join(", ")}.`);
  const phaseTicks: Partial<Record<CultivatorPhase, number>> = {};
  const workers = new Set(plan.sites.map((_, index) => `worker-${index + 1}`));
  let firstIncome: number | undefined;
  let staffedAt: number | undefined;
  let staffedDelivered = 0;
  let rotated = false;
  const wasDormant = new Map(
    economy().sites.map(({ id, dormant }) => [id, dormant]),
  );
  let deliveries = 0;
  const sample = () => {
    if (firstIncome === undefined && delivered() > 0) firstIncome = seconds();
    for (const site of economy().sites) {
      const report = sites[site.id]!;
      report.minReservePercent = Math.min(
        report.minReservePercent,
        reservePercent(site),
      );
      const status = cultivationStatus(site);
      if (status === "Strained") report.strainedSeconds += sim.tickSeconds;
      if (status === "Dormant") report.dormantSeconds += sim.tickSeconds;
      if (site.dormant && !wasDormant.get(site.id)) report.dormancies++;
      wasDormant.set(site.id, site.dormant);
    }
    if (staffedAt === undefined) return;
    for (const { kind, actorId } of sim.buildingActivity)
      if (kind === "delivery" && actorId && workers.has(actorId)) deliveries++;
    for (const { actorId, phase } of economy().workers)
      if (workers.has(actorId))
        phaseTicks[phase] = (phaseTicks[phase] ?? 0) + 1;
  };
  const requireWindow = () => {
    if (sim.completedTicks >= cutoff)
      throw new Error(`${plan.id}: staffing exhausted the measurement window.`);
  };
  const step = (command?: MissionCommand) => {
    requireWindow();
    if (command) sim.submitCommand(command, { owner });
    const [outcome] = sim.tick();
    if (command && !outcome?.accepted)
      throw new Error(`Rejected ${command.kind}: ${JSON.stringify(outcome)}`);
    sample();
  };
  const run = (condition: () => boolean) => {
    while (!condition()) step();
  };
  const train = (actorId: string) => {
    run(() => lifebloom() >= workerCost);
    step({
      kind: "train-unit",
      actorId,
      producerId: "starting-heartgrove",
      definitionId: CULTIVATOR,
    });
    run(() => !!sim.actorById(actorId));
  };

  const orderedWorkers = [...workers];
  const firstWorker = orderedWorkers[0]!;
  train(firstWorker);
  step({
    kind: "place-actor",
    actorId: "conservatory",
    definitionId: "circle-conservatory",
    origin: { x: 16, z: 50 },
    workerIds: [firstWorker],
  });
  run(() => sim.actorById("conservatory")?.construction === undefined);

  for (const [index, siteId] of plan.sites.entries()) {
    const actorId = orderedWorkers[index]!;
    if (index > 0) train(actorId);
    step({ kind: "gather", actorId, siteId });
  }
  requireWindow();
  staffedAt = seconds();
  staffedDelivered = delivered();
  const lastIndex = orderedWorkers.length - 1;
  const rotationSiteId = plan.sites[lastIndex];
  while (sim.completedTicks < cutoff) {
    if (
      plan.rotateTo &&
      !rotated &&
      cultivationStatus(
        economy().sites.find(({ id }) => id === rotationSiteId)!,
      ) === "Strained"
    ) {
      rotated = true;
      step({
        kind: "gather",
        actorId: orderedWorkers[lastIndex]!,
        siteId: plan.rotateTo,
      });
    } else step();
  }

  const staffedMinutes = (seconds() - staffedAt) / 60;
  const workerTicks = Object.values(phaseTicks).reduce((a, b) => a + b, 0);
  if (!workerTicks) throw new Error(`${plan.id}: no worker time to measure.`);
  return {
    plan: plan.id,
    minutes,
    firstIncomeSeconds: firstIncome && round(firstIncome),
    staffedSeconds: round(staffedAt),
    lifebloom: {
      deposited: delivered(),
      perMinuteAfterStaffed: round(
        (delivered() - staffedDelivered) / staffedMinutes,
      ),
    },
    sites: Object.fromEntries(
      Object.entries(sites).map(([id, site]) => [
        id,
        {
          ...site,
          minReservePercent: round(site.minReservePercent),
          strainedSeconds: round(site.strainedSeconds),
          dormantSeconds: round(site.dormantSeconds),
        },
      ]),
    ),
    phases: Object.fromEntries(
      Object.entries(phaseTicks).map(([phase, ticks]) => [
        phase,
        round((100 * ticks) / workerTicks),
      ]),
    ),
    deliveriesPerWorkerMinute: round(
      deliveries / ((workerTicks * sim.tickSeconds) / 60),
      2,
    ),
  };
}
