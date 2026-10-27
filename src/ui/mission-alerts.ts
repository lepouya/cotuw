import type { ActorRenderState } from "../simulation/actor";
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

/** Committed mission state after one tick. */
export type AlertObservation = {
  tick: number;
  tickSeconds: number;
  actors: readonly ActorRenderState[];
  attacks: readonly AttackEvent[];
  wrecks: readonly Wreck[];
  support?: SupportView;
  objectives: readonly ObjectiveView[];
  /** Economy workers; attacks on them are named and pulsed. */
  workerIds: readonly string[];
  /** Explored renewable sites. */
  sites?: readonly SiteObservation[];
};
export type SiteObservation = {
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

/**
 * Turns per-tick changes into grouped player alerts. The first observation
 * records a baseline, so loading a mission raises nothing.
 */
export function createAlertTracker({
  owns,
  nameOf,
}: {
  owns: (actor: Pick<ActorRenderState, "definitionId">) => boolean;
  nameOf: (definitionId: string) => string;
}) {
  let previous: AlertObservation | undefined;
  let previousById = new Map<string, ActorRenderState>();
  const lastHitTicks = new Map<AttackKind, number>();
  /** One alert names a single actor, or counts several of them. */
  const summarize = (actors: readonly ActorRenderState[], suffix: string) =>
    actors.length === 1
      ? `${nameOf(actors[0]!.definitionId)} ${suffix}`
      : `${plural(actors.length, "unit")} ${suffix}`;
  return {
    observe: (current: AlertObservation): MissionAlert[] => {
      const byId = new Map(current.actors.map((actor) => [actor.id, actor]));
      const before = previous;
      const beforeById = previousById;
      previous = current;
      previousById = byId;
      if (!before) return [];
      const alerts: MissionAlert[] = [];
      const own = current.actors.filter(owns);

      // A lethal hit removes the worker from the committed economy state.
      const workers = new Set([...before.workerIds, ...current.workerIds]);
      const hits = new Map<AttackKind, ActorRenderState>();
      for (const { targetId } of current.attacks) {
        const target = byId.get(targetId) ?? beforeById.get(targetId);
        if (!target || !owns(target)) continue;
        const kind = workers.has(targetId)
          ? "worker"
          : target.tilePlacement
            ? "building"
            : "unit";
        if (!hits.has(kind)) hits.set(kind, target);
      }
      const window = ATTACK_ALERT_SECONDS / current.tickSeconds;
      for (const [kind, target] of hits) {
        const last = lastHitTicks.get(kind);
        lastHitTicks.set(kind, current.tick);
        if (last !== undefined && current.tick - last <= window) continue;
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
        (actor) => owns(actor) && !byId.has(actor.id) && wrecked.has(actor.id),
      );
      if (lost.length)
        alerts.push({
          priority: "high",
          text: summarize(lost, "lost"),
          position: lost[0]!.worldPosition,
        });

      const completed = own.filter(
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

      const trained = own.filter(
        (actor) => !actor.tilePlacement && !beforeById.has(actor.id),
      );
      if (trained.length)
        alerts.push({
          priority: "normal",
          text: summarize(trained, "ready"),
          position: trained[0]!.worldPosition,
        });

      const blocked = own.filter(
        (actor) =>
          actor.movement?.blocked &&
          !beforeById.get(actor.id)?.movement?.blocked,
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
          (current.support?.nodes ?? []).filter((node) => {
            const actor = byId.get(node.actorId);
            return (
              !!actor &&
              owns(actor) &&
              node.connected === connected &&
              connectedBefore.get(node.actorId) === !connected
            );
          });
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

      const dormantBefore = new Map(
        before.sites?.map(({ id, dormant }) => [id, dormant]),
      );
      for (const site of current.sites ?? [])
        if (site.dormant && dormantBefore.get(site.id) === false)
          alerts.push({
            priority: "normal",
            text: `${site.name} is dormant. Workers deliver cargo and wait for recovery to ${site.reopensAt}%.`,
            position: site.position,
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
