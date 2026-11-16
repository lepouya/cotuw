import { costAmount, costResource } from "./resources";
import { stockpileOf } from "./stockpiles";
import { isCount, isPositive, isRecord } from "./validation";
import { healthOf } from "./actor";
import { isValidQueuePosition } from "./infrastructure-queue";
import type { Actor, ActorDefinition, ActorRenderState } from "./actor";
import type { Ledger, LedgerView } from "./stockpiles";

/** Paid steps that restore full health, one per simulated second. */
const FULL_REPAIR_STEPS = 100;
/** Share of the original price that restoring full health costs. */
const FULL_REPAIR_COST_SHARE = 0.5;
const MAX_ROUNDING_CORRECTION = 1e-9;

type RepairJob = NonNullable<ActorRenderState["repair"]>;

export type RepairReason =
  | "invalid-building"
  | "undamaged"
  | "already-repairing"
  | "missing-resource"
  | "missing-repair";

/** Admission does not require funds or a connection; those pause the job. */
export function repairRejection(
  actor: ActorRenderState | undefined,
  definition: ActorDefinition | undefined,
  ledger: LedgerView | undefined,
): RepairReason | undefined {
  if (
    !actor?.tilePlacement ||
    actor.construction ||
    !definition?.health ||
    !ledger
  )
    return "invalid-building";
  if (actor.repair) return "already-repairing";
  if (healthOf(actor, definition.health) >= definition.health)
    return "undamaged";
  if (!stockpileOf(ledger, actor.owner, costResource(definition)))
    return "missing-resource";
  return undefined;
}

export const repairRestored = (
  job: RepairJob,
  definition: ActorDefinition,
  steps = job.completedSteps,
) =>
  Math.min(job.missingHealth, definition.health! * (steps / FULL_REPAIR_STEPS));

/** Rounds cumulative payments up, so small steps never add rounding costs. */
export function repairCharge(restored: number, definition: ActorDefinition) {
  const cost =
    costAmount(definition) *
    FULL_REPAIR_COST_SHARE *
    (restored / definition.health!);
  // Floating-point error at a whole-unit boundary must not add a resource.
  const correction = Math.min(
    cost * 4 * Number.EPSILON,
    MAX_ROUNDING_CORRECTION,
  );
  return Math.ceil(cost - correction);
}

/** The most one step can charge. */
export const repairRate = (definition: ActorDefinition) =>
  repairCharge(definition.health! / FULL_REPAIR_STEPS, definition);

/** Requires a validated repair job; caps healing at current missing health. */
export function nextRepairStep(
  actor: ActorRenderState,
  definition: ActorDefinition,
) {
  const job = actor.repair!;
  const before = repairRestored(job, definition);
  const planned = repairRestored(job, definition, job.completedSteps + 1);
  const missing = definition.health! - healthOf(actor, definition.health!);
  const health = Math.min(planned - before, missing);
  const restored = health < planned - before ? before + health : planned;
  return {
    health,
    cost: repairCharge(restored, definition) - job.paidCost,
    complete: planned === job.missingHealth || health === missing,
  };
}

/** Pays and applies the next step; callers check affordability first. */
export function applyRepairStep(
  building: Actor,
  definition: ActorDefinition,
  ledger: Ledger,
) {
  const job = building.repair!;
  const step = nextRepairStep(building, definition);
  const maximum = definition.health!;
  stockpileOf(ledger, building.owner, costResource(definition))!.amount -=
    step.cost;
  job.paidCost += step.cost;
  job.completedSteps += 1;
  const health = Math.min(maximum, healthOf(building, maximum) + step.health);
  // The final step must not leave a rounding-sized wound behind.
  if (step.complete && maximum - health <= maximum * (8 * Number.EPSILON))
    delete building.health;
  else building.health = health;
  if (step.complete) delete building.repair;
  return step.cost;
}

export function validateRepair(
  actor: Actor,
  definition: ActorDefinition,
  hasEconomy: boolean,
  tick: number,
) {
  const job = actor.repair;
  if (job === undefined) return;
  if (
    !isRecord(job) ||
    !hasEconomy ||
    !actor.tilePlacement ||
    actor.construction ||
    !definition.health ||
    !isPositive(job.missingHealth) ||
    job.missingHealth >= definition.health ||
    !isCount(job.completedSteps) ||
    repairRestored(job, definition) >= job.missingHealth ||
    !isCount(job.paidCost) ||
    job.paidCost !==
      repairCharge(repairRestored(job, definition), definition) ||
    !isValidQueuePosition(job, tick, true) ||
    (job.unaffordable !== undefined && job.unaffordable !== true) ||
    (job.active && job.unaffordable)
  )
    throw new RangeError(`Actor ${actor.id} has invalid repair state.`);
}
