import type { AudioScene, AudioEmitter } from "./scene";
import type { CommandOutcome } from "../simulation/command";
import type { MissionSimulation } from "../simulation/mission";
import type { ObservedActor, OwnerView } from "../simulation/owner-view";
import type { ProductionJob } from "../simulation/production";

/**
 * Adapts what an owner may perceive of committed gameplay to the generic
 * named-event audio interface. Event feeds name hidden actors too, so their
 * participants resolve through the view.
 */
export function createMissionAudio(
  scene: Pick<AudioScene, "sync" | "emit" | "setMusic">,
  simulation: Pick<
    MissionSimulation,
    | "attacks"
    | "buildingActivity"
    | "completedTicks"
    | "objectives"
    | "result"
    | "tickSeconds"
  >,
  view: Pick<
    OwnerView,
    "actors" | "economy" | "offlineIds" | "owns" | "workingIds" | "wrecks"
  >,
  combatHoldSeconds: number,
) {
  let previous: ReadonlyMap<string, ObservedActor> = new Map();
  /** Queued jobs whose training start has sounded. */
  let started = new Set<string>();
  let objectives = new Map<string, string>();
  let result = simulation.result?.kind;
  let combatUntil = -Infinity;
  const seconds = () => simulation.completedTicks * simulation.tickSeconds;
  const emitterOf = (
    actor: Pick<ObservedActor, "id" | "definitionId" | "worldPosition">,
    states: readonly string[] = [],
  ): AudioEmitter => ({
    id: actor.id,
    definitionId: actor.definitionId,
    position: actor.worldPosition,
    states,
  });
  const observe = (
    outcomes: readonly CommandOutcome[] = [],
    alerts: readonly { priority: "high" | "normal" }[] = [],
    baseline = false,
  ) => {
    const { shown, shownById, ownById } = view.actors();
    const production = view.economy()?.production ?? [];
    const heads = new Map<string, Readonly<ProductionJob>>();
    for (const job of production)
      if (!heads.has(job.producerId)) heads.set(job.producerId, job);
    const producers = new Set(
      [...heads.values()]
        .filter((job) => job.completedTicks < job.totalTicks)
        .map((job) => job.producerId),
    );
    const workers = view.workingIds();
    const offline = view.offlineIds();
    const emitters = shown.map((actor) => {
      if (actor.construction || offline.has(actor.id))
        return emitterOf(
          actor,
          actor.construction?.active ? ["constructing"] : [],
        );
      const before = previous.get(actor.id);
      const route = ownById.get(actor.id)?.movement;
      const moving = before
        ? actor.worldPosition.x !== before.worldPosition.x ||
          actor.worldPosition.z !== before.worldPosition.z
        : !!route && !route.blocked;
      const states = [
        ...(moving ? ["moving"] : []),
        ...(workers.has(actor.id) ? ["working"] : []),
        ...(producers.has(actor.id) ? ["training"] : []),
      ];
      return emitterOf(actor, states.length ? states : ["idle"]);
    });
    // Remains keep lethal-hit sounds audible after the actor leaves.
    const remains = new Map(
      view
        .wrecks()
        .map((wreck) => [
          wreck.actorId,
          emitterOf({ ...wreck, id: wreck.actorId }),
        ]),
    );
    scene.sync([...emitters, ...remains.values()]);
    const participant = (id: string) => {
      const actor = shownById.get(id);
      return actor ? emitterOf(actor) : remains.get(id);
    };
    // Training starts when a job first advances, not when it is queued.
    const startTraining = (
      job: Pick<ProductionJob, "actorId" | "producerId">,
    ) => {
      if (started.has(job.actorId)) return;
      started.add(job.actorId);
      const producer = shownById.get(job.producerId);
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
        const attacker = participant(hit.attackerId);
        const target = participant(hit.targetId);
        if (attacker) scene.emit("attack", attacker);
        if (target) scene.emit("damage", target);
        if (attacker || target) combatUntil = seconds() + combatHoldSeconds;
      }
      let trained = false;
      for (const activity of simulation.buildingActivity) {
        const building = shownById.get(activity.buildingId);
        if (building)
          scene.emit(`activity.${activity.kind}`, emitterOf(building));
        const actor = activity.actorId && shownById.get(activity.actorId);
        // Trained units share their producer's owner.
        if (
          activity.kind !== "exit" ||
          !actor ||
          previous.has(actor.id) ||
          !view.owns(actor)
        )
          continue;
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
    previous = shownById;
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
