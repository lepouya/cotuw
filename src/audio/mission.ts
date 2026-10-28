import { workingWorkerIds } from "../simulation/economy";
import type { AudioScene, AudioEmitter } from "./scene";
import type { MissionSimulation } from "../simulation/mission";
import type { CommandOutcome } from "../simulation/command";
import type { MissionAlert } from "../ui/mission-alerts";
import type { ActorRenderState } from "../simulation/actor";
import type { Detectable, PlayerAccess } from "../simulation/ownership";
import { disconnectedBuildings } from "../simulation/support";
import type { ProductionJob } from "../simulation/economy";

/** Adapts committed gameplay to the generic named-event audio interface. */
export function createMissionAudio(
  scene: AudioScene,
  simulation: MissionSimulation,
  access: Pick<PlayerAccess, "owns" | "shows">,
  combatHoldSeconds: number,
) {
  let previous = new Map<string, ActorRenderState>();
  /** Queued jobs whose training start has sounded. */
  let started = new Set<string>();
  let objectives = new Map<string, string>();
  let result = simulation.result?.kind;
  let combatUntil = -Infinity;
  const seconds = () => simulation.completedTicks * simulation.tickSeconds;
  const emitterOf = (
    actor: Detectable & { id: string; owner: string },
    states: readonly string[] = [],
  ): AudioEmitter => ({
    id: actor.id,
    definitionId: actor.definitionId,
    position: actor.worldPosition,
    audible: access.shows(actor),
    states,
  });
  const observe = (
    outcomes: readonly CommandOutcome[] = [],
    alerts: readonly MissionAlert[] = [],
    baseline = false,
  ) => {
    const current = new Map(
      simulation.actors.map((actor) => [actor.id, actor]),
    );
    // Queues are private, so only the player's producers sound their work.
    const production = (simulation.economy?.production ?? []).filter((job) => {
      const producer = current.get(job.producerId);
      return !!producer && access.owns(producer);
    });
    const heads = new Map<string, Readonly<ProductionJob>>();
    for (const job of production)
      if (!heads.has(job.producerId)) heads.set(job.producerId, job);
    const producers = new Set(
      [...heads.values()]
        .filter((job) => job.completedTicks < job.totalTicks)
        .map((job) => job.producerId),
    );
    const workers = workingWorkerIds(simulation.economy, simulation.actors);
    const offline = disconnectedBuildings(simulation.support);
    const emitters = simulation.actors.map((actor) => {
      if (actor.construction || offline.has(actor.id))
        return emitterOf(
          actor,
          actor.construction?.active ? ["constructing"] : [],
        );
      const before = previous.get(actor.id);
      const moving = before
        ? actor.worldPosition.x !== before.worldPosition.x ||
          actor.worldPosition.z !== before.worldPosition.z
        : !!actor.movement && !actor.movement.blocked;
      const states = [
        ...(moving ? ["moving"] : []),
        ...(workers.has(actor.id) ? ["working"] : []),
        ...(producers.has(actor.id) ? ["training"] : []),
      ];
      return emitterOf(actor, states.length ? states : ["idle"]);
    });
    // Remains keep lethal-hit sounds audible after the actor leaves.
    for (const wreck of simulation.wrecks)
      if (!current.has(wreck.actorId))
        emitters.push(emitterOf({ ...wreck, id: wreck.actorId }));
    scene.sync(emitters);
    // Training starts when a job first advances, not when it is queued.
    const startTraining = (
      job: Pick<ProductionJob, "actorId" | "producerId">,
    ) => {
      if (started.has(job.actorId)) return;
      started.add(job.actorId);
      const producer = current.get(job.producerId);
      if (producer && !baseline)
        scene.emit("production.start", emitterOf(producer));
    };
    for (const job of production) if (job.completedTicks) startTraining(job);
    if (!baseline) {
      if (outcomes.length)
        scene.emit(
          outcomes.some((outcome) => !outcome.accepted)
            ? "command.invalid"
            : "command.accepted",
        );
      for (const hit of simulation.attacks) {
        const attacker =
          current.get(hit.attackerId) ?? previous.get(hit.attackerId);
        const target = current.get(hit.targetId) ?? previous.get(hit.targetId);
        if (attacker) scene.emit("attack", emitterOf(attacker));
        if (target) scene.emit("damage", emitterOf(target));
        if (
          (attacker && access.shows(attacker)) ||
          (target && access.shows(target))
        )
          combatUntil = seconds() + combatHoldSeconds;
      }
      let trained = false;
      for (const activity of simulation.buildingActivity) {
        const building = current.get(activity.buildingId);
        if (building)
          scene.emit(`activity.${activity.kind}`, emitterOf(building));
        const actor = activity.actorId && current.get(activity.actorId);
        if (activity.kind !== "exit" || !actor || previous.has(actor.id))
          continue;
        // Trained units share their producer's owner.
        if (!access.owns(actor)) continue;
        startTraining({ actorId: actor.id, producerId: activity.buildingId });
        scene.emit("trained", emitterOf(actor));
        trained = true;
      }
      const completed = simulation.objectives.some(
        (objective) =>
          objective.status === "complete" &&
          objectives.get(objective.id) !== "complete",
      );
      // A tick's most specific player feedback replaces the generic alert.
      if (simulation.result && simulation.result.kind !== result)
        scene.emit(simulation.result.kind);
      else {
        if (completed) scene.emit("objective.complete");
        if (
          alerts.some(
            (alert) => alert.priority === "high" || !(completed || trained),
          )
        )
          scene.emit("alert");
      }
    }
    scene.setMusic(seconds() < combatUntil);
    previous = current;
    started = new Set(
      production
        .filter((job) => started.has(job.actorId))
        .map((job) => job.actorId),
    );
    objectives = new Map(
      simulation.objectives.map((objective) => [
        objective.id,
        objective.status,
      ]),
    );
    result = simulation.result?.kind;
  };
  observe([], [], true);
  return { observe };
}
