import type { ActorRenderState } from "../simulation/actor";
import type { CultivatorState } from "../simulation/cultivation";
import type { GrowthStatus } from "./cultivation-feedback";
import type { ContentRoles } from "./content-roles";
import type { AttackEvent, Wreck } from "../simulation/combat";
import type { ObjectiveView } from "../simulation/objectives";
import type { SupportView } from "../simulation/support";
import type { WorldPosition } from "../simulation/world";

/** Hits on the same kind of target within this long count as one attack. */
export const ATTACK_ALERT_SECONDS = 15;

export type MissionAlert = {
  /** Attacks, losses, failures, and outages need the player's attention. */
  priority: "high" | "normal";
  text: string;
  /** Where Focus takes the camera. */
  position?: WorldPosition;
  /** Also pulses the position on the minimap. */
  pulse?: boolean;
};

/** What the player may know of the committed mission after one tick. */
export type AlertObservation = {
  tick: number;
  tickSeconds: number;
  /** The player's own actors. */
  actors: readonly ActorRenderState[];
  /** This tick's hits; those on other owners' actors raise nothing. */
  attacks: readonly Pick<AttackEvent, "targetId">[];
  wrecks: readonly Pick<Wreck, "actorId">[];
  support?: SupportView;
  objectives: readonly ObjectiveView[];
  /** The player's economy workers; attacks on them are named and pulsed. */
  workerIds: readonly string[];
  /** Renewable sites currently in view. */
  sites?: readonly SiteObservation[];
  /** The player's Cultivators. */
  cultivators?: readonly Pick<
    CultivatorState,
    "actorId" | "phase" | "siteId"
  >[];
  /** Workers whose assigned route is blocked, even without a movement order. */
  blockedWorkerIds?: readonly string[];
  growth?: ReadonlyMap<string, GrowthStatus>;
};
type SiteObservation = {
  id: string;
  name: string;
  dormant: boolean;
  /** Reserve percentage at which a dormant site reopens. */
  reopensAt: number;
  position: WorldPosition;
};

type AttackKind = "worker" | "building" | "unit";

const ATTACK_TEXT: Record<Exclude<AttackKind, "worker">, string> = {
  building: "Base under attack",
  unit: "Units under attack",
};

const plural = (count: number, noun: string) =>
  `${count} ${noun}${count === 1 ? "" : "s"}`;

function attackKind(
  target: ActorRenderState,
  workers: ReadonlySet<string>,
): AttackKind {
  if (workers.has(target.id)) return "worker";
  return target.tilePlacement ? "building" : "unit";
}

/**
 * Turns per-tick changes into grouped player alerts. The first observation
 * records a baseline, so loading a mission raises nothing.
 */
export function createAlertTracker({
  nameOf,
  roles = {},
}: {
  nameOf: (definitionId: string) => string;
  roles?: Partial<
    Pick<ContentRoles, "cultivator" | "dropoff" | "growthHeadquarters">
  >;
}) {
  const {
    dropoff = "drop-off building",
    growthHeadquarters: headquarters = "headquarters",
  } = roles;
  let previous: AlertObservation | undefined;
  let previousById = new Map<string, ActorRenderState>();
  const lastHitTicks = new Map<AttackKind, number>();
  /** One alert names a single actor, or counts several of them. */
  const summarize = (
    actors: readonly ActorRenderState[],
    suffix: string,
    noun = "unit",
  ) =>
    actors.length === 1
      ? `${nameOf(actors[0]!.definitionId)} ${suffix}`
      : `${plural(actors.length, noun)} ${suffix}`;
  return {
    observe: (current: AlertObservation): MissionAlert[] => {
      const byId = new Map(current.actors.map((actor) => [actor.id, actor]));
      const before = previous;
      const beforeById = previousById;
      previous = current;
      previousById = byId;
      if (!before) return [];
      const alerts: MissionAlert[] = [];

      // A lethal hit removes the worker from the committed economy state.
      const workers = new Set([...before.workerIds, ...current.workerIds]);
      const hits = new Map<AttackKind, ActorRenderState>();
      for (const { targetId } of current.attacks) {
        const target = byId.get(targetId) ?? beforeById.get(targetId);
        if (!target) continue;
        const kind = attackKind(target, workers);
        if (!hits.has(kind)) hits.set(kind, target);
      }
      const groupTicks = ATTACK_ALERT_SECONDS / current.tickSeconds;
      for (const [kind, target] of hits) {
        const last = lastHitTicks.get(kind);
        lastHitTicks.set(kind, current.tick);
        if (last !== undefined && current.tick - last <= groupTicks) continue;
        alerts.push({
          priority: "high",
          text:
            kind === "worker"
              ? `${nameOf(target.definitionId)} under attack`
              : ATTACK_TEXT[kind],
          position: target.worldPosition,
          // Losing a worker can stall the economy.
          pulse: kind === "worker",
        });
      }

      const wrecked = new Set(current.wrecks.map(({ actorId }) => actorId));
      const lost = [...beforeById.values()].filter(
        (actor) => !byId.has(actor.id) && wrecked.has(actor.id),
      );
      if (lost.length)
        alerts.push({
          priority: "high",
          text: summarize(lost, "lost"),
          position: lost[0]!.worldPosition,
        });

      const completed = current.actors.filter(
        (actor) =>
          actor.tilePlacement &&
          !actor.construction &&
          (!beforeById.has(actor.id) || beforeById.get(actor.id)?.construction),
      );
      for (const building of completed)
        alerts.push({
          priority: "normal",
          text: `${nameOf(building.definitionId)} complete`,
          position: building.worldPosition,
        });

      const trained = current.actors.filter(
        (actor) => !actor.tilePlacement && !beforeById.has(actor.id),
      );
      if (trained.length)
        alerts.push({
          priority: "normal",
          text: summarize(trained, "ready"),
          position: trained[0]!.worldPosition,
        });

      const blockedBefore = new Set(before.blockedWorkerIds);
      const blockedWorkers = new Set(current.blockedWorkerIds);
      const blocked = current.actors.filter(
        ({ id, movement }) =>
          (movement?.blocked || blockedWorkers.has(id)) &&
          !beforeById.get(id)?.movement?.blocked &&
          !blockedBefore.has(id),
      );
      if (blocked.length)
        alerts.push({
          priority: "normal",
          text: summarize(blocked, "cannot reach the destination"),
          position: blocked[0]!.worldPosition,
        });

      if (current.support !== before.support) {
        const connectedBefore = new Map(
          before.support?.nodes.map((node) => [node.actorId, node.connected]),
        );
        const changed = (connected: boolean) =>
          (current.support?.nodes ?? []).filter(
            (node) =>
              byId.has(node.actorId) &&
              node.connected === connected &&
              connectedBefore.get(node.actorId) === !connected,
          );
        for (const connected of [false, true]) {
          const nodes = changed(connected);
          if (!nodes.length) continue;
          alerts.push({
            priority: connected ? "normal" : "high",
            text: `${plural(nodes.length, "building")} ${connected ? "reconnected" : "disconnected"}`,
            position: nodes[0]!.center,
          });
        }
      }

      const repairsPaused = current.actors.filter(
        (actor) =>
          actor.repair?.unaffordable &&
          !beforeById.get(actor.id)?.repair?.unaffordable,
      );
      if (repairsPaused.length)
        alerts.push({
          priority: "normal",
          text: `${plural(repairsPaused.length, "building")} awaiting repair resources. Repairs resume automatically.`,
          position: repairsPaused[0]!.worldPosition,
        });

      const cultivators = current.cultivators ?? [];
      const previousPhases = new Map(
        before.cultivators?.map(({ actorId, phase }) => [actorId, phase]),
      );
      const workedSites = new Set(cultivators.map(({ siteId }) => siteId));
      const dormantBefore = new Map(
        before.sites?.map(({ id, dormant }) => [id, dormant]),
      );
      // Only sites the player works announce dormancy.
      for (const site of current.sites ?? [])
        if (
          site.dormant &&
          dormantBefore.get(site.id) === false &&
          workedSites.has(site.id)
        )
          alerts.push({
            priority: "normal",
            text: `${site.name} is dormant. Workers deliver cargo and wait for recovery to ${site.reopensAt}%.`,
            position: site.position,
          });

      const undeliverable = cultivators.flatMap(({ actorId, phase }) => {
        const worker = byId.get(actorId);
        return worker &&
          phase === "no-dropoff" &&
          previousPhases.get(actorId) !== "no-dropoff"
          ? [worker]
          : [];
      });
      if (undeliverable.length)
        alerts.push({
          priority: "high",
          text: `${summarize(undeliverable, "cannot deliver cargo", "worker")}: no reachable ${dropoff}. Cargo is retained.`,
          position: undeliverable[0]!.worldPosition,
        });

      const growthEntering = (status: GrowthStatus) =>
        current.actors.filter(
          ({ id }) =>
            current.growth?.get(id) === status &&
            before.growth?.has(id) &&
            before.growth.get(id) !== status,
        );
      const untended = growthEntering("untended");
      if (untended.length)
        alerts.push({
          priority: "normal",
          text: `${summarize(untended, "untended", "building")}. Growth paused; choose Tend with a ${roles.cultivator ?? "worker"} to resume.`,
          position: untended[0]!.worldPosition,
        });
      const unhosted = growthEntering("unhosted");
      if (unhosted.length)
        alerts.push({
          priority: "normal",
          text: `No ${headquarters} for ${unhosted.length === 1 ? nameOf(unhosted[0]!.definitionId) : plural(unhosted.length, "building")}. Growth paused until one is available.`,
          position: unhosted[0]!.worldPosition,
        });

      const statusBefore = new Map(
        before.objectives.map(({ id, status }) => [id, status]),
      );
      for (const objective of current.objectives) {
        if (objective.status === statusBefore.get(objective.id)) continue;
        if (objective.status === "complete")
          alerts.push({
            priority: "normal",
            text: `Objective complete: ${objective.label}`,
          });
        if (objective.status === "failed")
          alerts.push({
            priority: "high",
            text: `Objective failed: ${objective.label}`,
          });
      }
      return alerts;
    },
  };
}
