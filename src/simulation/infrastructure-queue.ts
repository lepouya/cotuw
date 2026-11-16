import { compareIds } from "./actor";
import { isCount } from "./validation";
import type { ActorRenderState, InfrastructureJob } from "./actor";

type QueuedWork = Pick<ActorRenderState, "owner" | "construction" | "repair">;

/** A building's construction or repair; the two never coexist. */
export const infrastructureJob = <A extends QueuedWork>(
  actor: A,
): A["construction"] | A["repair"] => actor.construction ?? actor.repair;

/** The owner's next priority, after all of its outstanding work. */
export const nextInfrastructurePriority = (
  actors: readonly QueuedWork[],
  owner: string,
) =>
  actors.reduce(
    (last, actor) =>
      actor.owner === owner
        ? Math.max(last, infrastructureJob(actor)?.priority ?? 0)
        : last,
    0,
  ) + 1;

/**
 * Oldest first. Authored work precedes submitted work and keeps authored
 * order; same-tick work orders by owner ID, then owner-local priority.
 */
export function compareInfrastructure(a: QueuedWork, b: QueuedWork) {
  const left = infrastructureJob(a);
  const right = infrastructureJob(b);
  const age = (left?.queuedTick ?? -1) - (right?.queuedTick ?? -1);
  if (age || left?.queuedTick === undefined) return age;
  return a.owner === b.owner
    ? left.priority! - right!.priority!
    : compareIds(a.owner, b.owner);
}

/** Whether saved queue fields are well formed; submitted work needs both. */
export const isValidQueuePosition = (
  job: InfrastructureJob,
  tick: number,
  submitted: boolean,
) =>
  (job.priority === undefined
    ? !submitted && job.queuedTick === undefined
    : isCount(job.priority) &&
      job.priority > 0 &&
      isCount(job.queuedTick) &&
      job.queuedTick <= tick) &&
  (job.active === undefined || job.active === true);
