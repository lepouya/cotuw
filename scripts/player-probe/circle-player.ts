// A scripted Circle player against the ARC skirmish AI, standing in for a
// modest human: decisions every few seconds, a fixed opening, then Sentinels.
import { SKIRMISH_OPENINGS } from "../../src/content/skirmish";
import { SKIRMISH_MAP } from "../../src/content/skirmish-map";
import {
  assembleSkirmish,
  createSessionSimulation,
  missionTerrain,
} from "../../src/mission-loading";
import { isSkirmishResult } from "../../src/simulation/mission-result";
import { createScenarioMap } from "../../src/simulation/scenario";
import { costAmount } from "../../src/simulation/resources";
import { secondsToTicks } from "../../src/simulation/clock";
import { balanceOf } from "../../src/simulation/stockpiles";

import type { MissionCommand } from "../../src/simulation/command";
import type { MatchMilestones } from "../../src/simulation/match-metrics";
import type { SkirmishStart } from "../../src/content/skirmish-map";
import type { TileCoord } from "../../src/simulation/grid";
import type { SkirmishResult } from "../../src/simulation/skirmish";

export type Plan = {
  id: string;
  /** Home-site index (1 or 2) for each Cultivator in training order. */
  workers: readonly [1 | 2, 1 | 2, ...(1 | 2)[]];
  /** Grows one Thornspire beside the home sites after this many Sentinels. */
  thornspireAfter?: number;
  /** Seconds before the first attack, and the Sentinels it needs. */
  attackAt: number;
  attackSentinels: number;
};

export const PLANS: readonly Plan[] = [
  // A focused opening that attacks before ARC's first base assault.
  { id: "rush", workers: [1, 2, 1], attackAt: 480, attackSentinels: 7 },
  // Economy and a Thornspire first, holding until a large army is ready, as
  // 1.57 testers played.
  {
    id: "economic",
    workers: [1, 2, 1, 2, 1, 2],
    thornspireAfter: 3,
    attackAt: 720,
    attackSentinels: 12,
  },
  {
    id: "turtle",
    workers: [1, 2, 1, 2],
    thornspireAfter: 3,
    attackAt: 900,
    attackSentinels: 15,
  },
];

export const STARTS = SKIRMISH_MAP.starts;

const DECISION_SECONDS = 5;
const ATTACK_RETRY_SECONDS = 40;
const HOME_GUARD = 3;
const CUTOFF_SECONDS = 30 * 60;
const { headquarters, worker, dropoff, resource } = SKIRMISH_OPENINGS.circle;
const MUSTERHALL = "circle-musterhall";
const THORNSPIRE = "circle-thornspire";
const SENTINEL = "circle-sentinel";
const PLACEMENT_OFFSETS: readonly (readonly [number, number])[] = [
  [0, 0],
  [0, 1],
  [1, 0],
  [-1, 0],
  [0, -1],
  [1, 1],
  [-1, 1],
  [2, 0],
  [-2, 0],
  [0, 2],
  [0, -2],
];

export type PlayerReport = {
  plan: string;
  slot: string;
  result?: SkirmishResult;
  seconds: number;
  milestones?: MatchMilestones;
  peakArmy?: number;
  cultivatorsLost: number;
  sentinelsLost: number;
  lifebloomGathered?: number;
};

export function runPlayer(plan: Plan, start: SkirmishStart): PlayerReport {
  const { id: slot } = start;
  const rival = SKIRMISH_MAP.starts.find(({ id }) => id !== slot)!;
  const enemy = rival.id;
  const mission = assembleSkirmish({
    playerSlot: slot,
    difficulty: "normal",
    factions: { [slot]: "circle", [enemy]: "arc" },
    ai: [{ owner: enemy, profileId: "arc-skirmish" }],
  });
  const map = createScenarioMap(missionTerrain(mission));
  const sim = createSessionSimulation(mission, map);
  try {
    const seconds = () => sim.completedTicks * sim.tickSeconds;
    const cost = (id: string) =>
      costAmount(mission.definitions.find((entry) => entry.id === id)!);
    const view = sim.viewOf(slot);
    const ownOf = (id: string) =>
      view.actors().own.filter(({ definitionId }) => definitionId === id);
    const canBuy = (id: string) =>
      (balanceOf(sim.economy!, slot, resource) ?? 0) >= cost(id);
    const cultivation = () => sim.economy!.cultivation!;
    const busy = (producerId: string) =>
      sim.economy!.production.filter((job) => job.producerId === producerId)
        .length;
    const ready = (id: string) => {
      const actor = view.ownActor(id);
      return !!actor && actor.construction === undefined;
    };
    const tracked = () =>
      new Map(
        sim.actors.flatMap(({ id, owner, definitionId }) =>
          owner === slot &&
          (definitionId === worker || definitionId === SENTINEL)
            ? [[id, definitionId] as const]
            : [],
        ),
      );
    let living = tracked();
    const lost = { [worker]: 0, [SENTINEL]: 0 };
    const cutoff = secondsToTicks(CUTOFF_SECONDS, sim.tickSeconds);
    const active = () => sim.completedTicks < cutoff && !sim.result;
    const step = (command?: MissionCommand) => {
      if (!active()) return;
      if (command) sim.submitCommand(command, { owner: slot });
      const version = sim.actorVersion;
      const outcomes = sim.tick();
      if (sim.actorVersion !== version) {
        const next = tracked();
        for (const [id, definitionId] of living)
          if (!next.has(id)) lost[definitionId]++;
        living = next;
      }
      // Group orders report one outcome per unit.
      if (
        command &&
        !outcomes.some(
          ({ accepted, issuer }) => accepted && issuer.owner === slot,
        )
      )
        throw new Error(
          `${plan.id} ${slot}: rejected ${command.kind} ${JSON.stringify(outcomes.filter(({ issuer }) => issuer.owner === slot))}`,
        );
    };
    const train = (actorId: string, producerId: string, definitionId: string) =>
      step({ kind: "train-unit", actorId, producerId, definitionId });
    const placed = new Set<string>();
    const grow = (
      actorId: string,
      definitionId: string,
      workerId: string,
      origin: TileCoord,
    ) => {
      if (!active()) return;
      for (const [dx, dz] of PLACEMENT_OFFSETS) {
        const command: MissionCommand = {
          kind: "place-actor",
          actorId,
          definitionId,
          origin: { x: origin.x + dx, z: origin.z + dz },
          workerIds: [workerId],
        };
        if (view.evaluatePlacement(command).accepted) {
          step(command);
          placed.add(actorId);
          return;
        }
      }
      throw new Error(
        `${plan.id} ${slot}: no valid ${definitionId} placement.`,
      );
    };

    const target = rival.headquartersOrigins.arc;
    const home = ownOf(headquarters)[0]!.id;
    const dropoffOrigin = start.dropoffOrigins.circle;
    const homeSites = cultivation().sites.filter(({ id }) =>
      mission.scenario.skirmish!.startingResourceSites[slot]!.includes(id),
    );
    const workers = plan.workers.map((site, index) => ({
      id: `worker-${index + 1}`,
      siteId: homeSites[site - 1]!.id,
    }));
    const [firstSite, secondSite] = homeSites;
    // Between the two home sites.
    const rally = {
      x: Math.floor((firstSite!.tile.x + secondSite!.tile.x) / 2),
      z: Math.floor((firstSite!.tile.z + secondSite!.tile.z) / 2),
    };
    const musterhallOrigin = {
      x: dropoffOrigin.x,
      z: dropoffOrigin.z - 5 * Math.sign(firstSite!.tile.z - dropoffOrigin.z),
    };
    const thornspireOrigin = {
      x: rally.x + Math.sign(target.x - rally.x),
      z: rally.z,
    };
    const tender = workers[0]!.id;
    let trained = 1;
    let sentinels = 0;
    let rallied = false;
    let nextAttack = plan.attackAt;
    train(tender, home, worker);

    const develop = () => {
      if (
        view.ownActor(tender) &&
        !placed.has("conservatory") &&
        canBuy(dropoff)
      )
        grow("conservatory", dropoff, tender, dropoffOrigin);
      if (!ready("conservatory")) return;
      for (const { id: actorId, siteId } of workers) {
        const actor = view.ownActor(actorId);
        const assignment = cultivation().workers.find(
          (entry) => entry.actorId === actorId,
        );
        if (
          actor &&
          !actor.orders?.length &&
          !assignment?.siteId &&
          !assignment?.tendingId
        )
          step({ kind: "gather", actorId, siteId });
      }
      // The second Cultivator comes before the Musterhall; the rest follow
      // the first two Sentinels.
      const wantsWorker =
        trained < workers.length && (trained < 2 || sentinels >= 2);
      if (wantsWorker && view.ownActor(home) && !busy(home) && canBuy(worker))
        train(workers[trained++]!.id, home, worker);
      if (
        trained >= 2 &&
        !placed.has("musterhall") &&
        view.ownActor(tender) &&
        canBuy(MUSTERHALL)
      )
        grow("musterhall", MUSTERHALL, tender, musterhallOrigin);
      if (!ready("musterhall")) return;
      if (!rallied) {
        step({
          kind: "set-rally-point",
          actorId: "musterhall",
          target: map.tileCenter(rally.x, rally.z),
        });
        rallied = true;
      }
      const wantsThornspire =
        plan.thornspireAfter !== undefined &&
        !placed.has("thornspire") &&
        sentinels >= plan.thornspireAfter;
      if (wantsThornspire && view.ownActor(tender)) {
        if (!canBuy(THORNSPIRE)) return;
        grow("thornspire", THORNSPIRE, tender, thornspireOrigin);
      }
      if (wantsWorker && trained >= 2) return;
      while (
        active() &&
        ready("musterhall") &&
        busy("musterhall") < 2 &&
        canBuy(SENTINEL)
      )
        train(`sentinel-${++sentinels}`, "musterhall", SENTINEL);
    };
    const attack = () => {
      if (seconds() >= nextAttack) {
        nextAttack += ATTACK_RETRY_SECONDS;
        const army = ownOf(SENTINEL);
        if (army.length >= plan.attackSentinels)
          step({
            kind: "group-attack-move",
            actorIds: army.slice(0, -HOME_GUARD).map(({ id }) => id),
            target: map.tileCenter(target.x, target.z),
          });
      }
    };

    const decisionTicks = secondsToTicks(DECISION_SECONDS, sim.tickSeconds);
    for (let decision = decisionTicks; active(); decision += decisionTicks) {
      while (active() && sim.completedTicks < decision) step();
      if (!active()) break;
      develop();
      if (active()) attack();
    }
    const metrics = sim.metrics?.owners.find(({ owner }) => owner === slot);
    const result = sim.result;
    return {
      plan: plan.id,
      slot,
      result: result && isSkirmishResult(result) ? result : undefined,
      seconds: Math.round(seconds()),
      milestones: metrics?.milestones,
      peakArmy: metrics?.peakArmy,
      cultivatorsLost: lost[worker],
      sentinelsLost: lost[SENTINEL],
      lifebloomGathered: metrics?.gathered.lifebloom,
    };
  } finally {
    sim.dispose();
  }
}
