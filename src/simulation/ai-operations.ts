// Group controller for faction operations: assembly, advance, and return.
import {
  compareIds,
  healthOf,
  isArmyUnit,
  isWorkerDefinition,
  nearestTo,
} from "./actor";
import {
  armyProducer,
  definitionOf,
  headquarters,
  idleProvider,
  usableBuildings,
} from "./ai-planning";
import { secondsToTicks } from "./clock";
import {
  isCount,
  isId,
  isIdList,
  isNonnegative,
  isOneOf,
  isRecord,
} from "./validation";
import { distance, isFinitePosition } from "./world";

import type { ActorRenderState } from "./actor";
import type { AiConcernContext, AiWithdrawalContext } from "./director";
import type { TerrainView } from "./terrain";
import type { WorldPosition } from "./world";

const OPERATION_KINDS = ["defend", "raid", "attack"] as const;
const OPERATION_PHASES = ["assemble", "advance", "return"] as const;
const OPERATION_OUTCOMES = [
  "completed",
  "failed",
  "cancelled",
  "recalled",
] as const;
export type OperationKind = (typeof OPERATION_KINDS)[number];
export type OperationOutcome = (typeof OPERATION_OUTCOMES)[number];

/**
 * A group's objective and progress, saved in its concern's memory as one
 * entry of `operations`. Units return to `rally` once it ends.
 */
export type Operation = {
  id: string;
  kind: OperationKind;
  phase: (typeof OPERATION_PHASES)[number];
  /** The objective's last-known position. */
  target: WorldPosition;
  /** The reported building the objective names, if any. */
  targetId?: string;
  /** The home gathering point and return destination. */
  rally: WorldPosition;
  /** A temporary assembly point during an advance. */
  regroup?: WorldPosition;
  units: string[];
  /** Providers following the group; they never count toward its strength. */
  support?: string[];
  /** Fighting strength as the advance began; losses are judged against it. */
  strength?: number;
  outcome?: OperationOutcome;
  /** The phase's group order is out. */
  issued?: true;
  /** The phase's start or the group's latest progress. */
  progressTick: number;
  /** The group's closest mean distance to its destination this phase. */
  closest?: number;
  /** Stalls and refusals replanned; the phase gives up past the limit. */
  retries: number;
  regroups: number;
};

/** Planning turns can run before operations exist; absent means none. */
export type OperationsMemory = { operations?: Operation[] };

export const operationMembers = ({
  units,
  support,
}: {
  units: readonly string[];
  support?: readonly string[];
}) => (support ? [...units, ...support] : units);

const movingMembers = (operation: Operation) =>
  operation.phase === "return" ? operationMembers(operation) : operation.units;

/** Checks saved operations before either planning or diagnostics reads them. */
export function isOperation(value: unknown): value is Operation {
  return (
    isRecord(value) &&
    isId(value.id) &&
    isOneOf(OPERATION_KINDS, value.kind) &&
    isOneOf(OPERATION_PHASES, value.phase) &&
    isFinitePosition(value.target) &&
    isFinitePosition(value.rally) &&
    (value.regroup === undefined || isFinitePosition(value.regroup)) &&
    (value.targetId === undefined || isId(value.targetId)) &&
    isIdList(value.units) &&
    (value.support === undefined || isIdList(value.support)) &&
    (value.strength === undefined || isNonnegative(value.strength)) &&
    (value.outcome === undefined ||
      isOneOf(OPERATION_OUTCOMES, value.outcome)) &&
    (value.issued === undefined || value.issued === true) &&
    isCount(value.progressTick) &&
    (value.closest === undefined || isNonnegative(value.closest)) &&
    isCount(value.retries) &&
    isCount(value.regroups)
  );
}

export const hasValidOperations = (memory: Record<string, unknown>) =>
  memory.operations === undefined ||
  (Array.isArray(memory.operations) && memory.operations.every(isOperation));

/** The group-step result its concern acts on. */
export type OperationEvent = "failed" | "ended" | undefined;

/** Fighting strength by the square law: total health times damage rate. */
export function strengthOf(
  context: AiConcernContext,
  actors: readonly Pick<ActorRenderState, "definitionId" | "health">[],
) {
  let health = 0;
  let damage = 0;
  for (const actor of actors) {
    const definition = context.definitions.get(actor.definitionId);
    const weapon = definition?.weapon;
    if (!weapon) continue;
    health += healthOf(actor, definition.health ?? 0);
    damage += weapon.damage / weapon.cooldownSeconds;
  }
  return health * damage;
}

/** Hostile armed actors the owner detects now. */
export const visibleHostiles = (context: AiConcernContext) =>
  context.view
    .actors()
    .shown.filter(
      (actor) =>
        context.view.relationTo(actor) === "hostile" &&
        !!context.definitions.get(actor.definitionId)?.weapon,
    );

/** Detected armed hostiles near own buildings and workers. */
export function baseThreats(context: AiConcernContext, terrain: TerrainView) {
  const assets = context.view
    .actors()
    .own.filter(
      (actor) =>
        !!actor.tilePlacement ||
        isWorkerDefinition(definitionOf(context, actor)),
    );
  const range = context.tuning.defense.threatTiles * terrain.tileSize;
  return visibleHostiles(context).filter((hostile) =>
    assets.some(
      (asset) => distance(asset.worldPosition, hostile.worldPosition) <= range,
    ),
  );
}

/** Own fielded army units, in ID order. */
export const armyUnits = (context: AiConcernContext) =>
  context.view
    .actors()
    .ownMobile.filter(
      (actor) =>
        context.view.isMobile(actor) &&
        isArmyUnit(definitionOf(context, actor)),
    )
    .sort((a, b) => compareIds(a.id, b.id));

/** Where new units gather: the first army rally point, else headquarters. */
export function stagingPoint(context: AiConcernContext) {
  const rally = usableBuildings(context, armyProducer(context)).find(
    ({ rallyPoint }) => rallyPoint,
  )?.rallyPoint;
  return rally ?? headquarters(context)?.worldPosition;
}

const centerOf = (actors: readonly ActorRenderState[]) => ({
  x:
    actors.reduce((sum, { worldPosition }) => sum + worldPosition.x, 0) /
    actors.length,
  z:
    actors.reduce((sum, { worldPosition }) => sum + worldPosition.z, 0) /
    actors.length,
});

export function launchOperation(
  context: AiConcernContext,
  operation: Pick<
    Operation,
    "id" | "kind" | "phase" | "target" | "targetId" | "rally" | "units"
  >,
): Operation {
  return {
    ...operation,
    target: { ...operation.target },
    rally: { ...operation.rally },
    units: [...operation.units].sort(compareIds),
    progressTick: context.tick,
    retries: 0,
    regroups: 0,
  };
}

/** Starts a phase with a fresh order and progress record. */
function enterPhase(
  context: AiConcernContext,
  operation: Operation,
  phase: Operation["phase"],
) {
  operation.phase = phase;
  operation.progressTick = context.tick;
  operation.retries = 0;
  delete operation.issued;
  delete operation.closest;
}

/** Sends the group home; it disbands there. */
export function endOperation(
  context: AiConcernContext,
  operation: Operation,
  outcome: OperationOutcome,
) {
  operation.outcome = outcome;
  delete operation.regroup;
  enterPhase(context, operation, "return");
}

/** Points the operation at a new objective; an assembling group stays put. */
export function redirectOperation(
  context: AiConcernContext,
  operation: Operation,
  target: WorldPosition,
  targetId?: string,
) {
  operation.target = { ...target };
  if (targetId === undefined) delete operation.targetId;
  else operation.targetId = targetId;
  delete operation.outcome;
  if (operation.phase !== "assemble") enterPhase(context, operation, "advance");
}

/**
 * Adds claimed units. They follow the group's current order, so units
 * already under way keep theirs; otherwise the whole order goes out again.
 */
export function reinforceOperation(
  context: AiConcernContext,
  operation: Operation,
  unitIds: string[],
) {
  operation.units = [...operation.units, ...unitIds].sort(compareIds);
  if (
    !operation.issued ||
    !context.issue(groupOrder(operation, [...unitIds].sort(compareIds)))
  )
    delete operation.issued;
}

/** The current phase's group order for `actorIds`. */
function groupOrder(operation: Operation, actorIds: string[]) {
  const advancing = operation.phase === "advance";
  return {
    kind: advancing ? ("group-attack-move" as const) : ("group-move" as const),
    actorIds,
    target: {
      ...(advancing
        ? operation.target
        : (operation.regroup ?? operation.rally)),
    },
  };
}

/** Whether the group should give way to the visible hostiles near it. */
function outmatched(
  context: AiConcernContext,
  operation: Operation,
  units: readonly ActorRenderState[],
  range: number,
) {
  const own = strengthOf(context, units);
  const center = centerOf(units);
  const threat = strengthOf(
    context,
    visibleHostiles(context).filter(
      (actor) => distance(actor.worldPosition, center) <= range,
    ),
  );
  const { depletedShare, retreatOdds } = context.tuning.operations;
  const depleted = own < (operation.strength ?? 0) * depletedShare;
  return threat > own * (depleted ? 1 / retreatOdds : retreatOdds);
}

/** Advancing, fighting, and near its target, so a recall would waste it. */
export function isCommitted(
  context: AiConcernContext,
  terrain: TerrainView,
  operation: Operation,
  held: ReadonlySet<string>,
) {
  if (operation.phase !== "advance") return false;
  const units = operation.units.flatMap((id) => {
    const unit = held.has(id) && context.view.ownMobileActor(id);
    return unit ? [unit] : [];
  });
  return (
    units.some((unit) => unit.combat?.attack) &&
    distance(centerOf(units), operation.target) <=
      context.tuning.operations.engagementTiles * terrain.tileSize
  );
}

/** Begins the advance, recording the strength that sets out. */
function beginAdvance(
  context: AiConcernContext,
  operation: Operation,
  units: readonly ActorRenderState[],
) {
  operation.strength ??= strengthOf(context, units);
  delete operation.regroup;
  enterPhase(context, operation, "advance");
}

/**
 * Claims providers for an assembling group or a defense, one per
 * `supportUnits` members it can service, nearest the group first.
 */
function escort(
  context: AiConcernContext,
  operation: Operation,
  units: readonly ActorRenderState[],
  center: WorldPosition,
  supportAvailable: (id: string) => boolean,
) {
  const wanted = Math.floor(
    units.length / context.tuning.operations.supportUnits,
  );
  const support = operation.support ?? [];
  if (support.length >= wanted) return;
  const kinds = new Set(
    units.flatMap((unit) => definitionOf(context, unit).recoveryKind ?? []),
  );
  const candidates = context.view
    .actors()
    .ownMobile.filter((actor) => {
      const restoration = definitionOf(context, actor).restoration;
      return (
        !!restoration &&
        !support.includes(actor.id) &&
        supportAvailable(actor.id) &&
        restoration.targetKinds.some((kind) => kinds.has(kind))
      );
    })
    .sort(nearestTo(center));
  for (const candidate of candidates) {
    if (support.length >= wanted) break;
    if (context.claim(candidate.id)) support.push(candidate.id);
  }
  if (support.length) operation.support = support.sort(compareIds);
}

/** Sends idle providers that fell behind to the group's center. */
function follow(
  context: AiConcernContext,
  terrain: TerrainView,
  operation: Operation,
  center: WorldPosition,
) {
  const range = context.tuning.operations.gatherTiles * terrain.tileSize;
  const behind = (operation.support ?? []).filter((id) => {
    const provider = context.view.ownMobileActor(id)!;
    return (
      idleProvider(provider) && distance(provider.worldPosition, center) > range
    );
  });
  if (behind.length)
    context.issue({ kind: "group-move", actorIds: behind, target: center });
}

/**
 * Runs one turn of an operation's group: it assembles at its rally point,
 * advances on its target, regroups when strung out, and returns home after
 * it ends. Stalls and refused orders are retried a bounded number of times.
 * With `retreats`, an outmatched advance fails. The group and its providers
 * are released once home or gone.
 */
export function stepOperation(
  context: AiConcernContext,
  terrain: TerrainView,
  operation: Operation,
  {
    retreats,
    supportAvailable = () => true,
  }: { retreats: boolean; supportAvailable?: (id: string) => boolean },
): OperationEvent {
  const { tick } = context;
  const tuning = context.tuning.operations;
  operation.units = operation.units.filter((id) => context.claim(id));
  const support = (operation.support ?? []).filter(
    (id) => supportAvailable(id) && context.claim(id),
  );
  if (support.length) operation.support = support;
  else delete operation.support;
  const disband = () => {
    for (const id of operationMembers(operation)) context.release(id);
    return "ended" as const;
  };
  if (!operation.units.length && !support.length) return disband();
  let event: OperationEvent;
  const fail = () => {
    endOperation(context, operation, "failed");
    event = "failed";
  };
  if (!operation.units.length && operation.phase !== "return") fail();
  const units = operation.units.map((id) => context.view.ownMobileActor(id)!);
  const center = units.length ? centerOf(units) : operation.rally;
  if (
    operation.phase !== "return" &&
    (operation.phase === "assemble" || operation.kind === "defend")
  )
    escort(context, operation, units, center, supportAvailable);
  // A crowded group leaves out members already beside the order's point;
  // they cannot get closer, which is not a stall.
  const gatherRange = tuning.gatherTiles * terrain.tileSize;
  if (
    context.rejections.some(
      ({ command }) =>
        (command.kind === "move" || command.kind === "attack-move") &&
        movingMembers(operation).includes(command.actorId) &&
        distance(
          context.view.ownMobileActor(command.actorId)!.worldPosition,
          command.target,
        ) > gatherRange,
    )
  ) {
    operation.retries += 1;
    delete operation.issued;
  }
  const engaged = units.some((unit) => unit.combat?.attack);
  if (operation.phase === "advance") {
    if (
      retreats &&
      outmatched(
        context,
        operation,
        units,
        tuning.engagementTiles * terrain.tileSize,
      )
    )
      fail();
    else if (
      !engaged &&
      operation.regroups < tuning.maxRegroups &&
      units.some(
        (unit) =>
          distance(unit.worldPosition, center) >
          tuning.regroupTiles * terrain.tileSize,
      )
    ) {
      // The unit nearest the center stands where the others can meet it.
      const [meeting] = [...units].sort(nearestTo(center));
      operation.regroups += 1;
      operation.regroup = { ...meeting!.worldPosition };
      enterPhase(context, operation, "assemble");
    }
  }
  const rally = operation.regroup ?? operation.rally;
  const positions = movingMembers(operation).map(
    (id) => context.view.ownMobileActor(id)!.worldPosition,
  );
  const gathered = () =>
    positions.every((position) => distance(position, rally) <= gatherRange);
  // Even a group already at its rally must replace its prior order.
  if (operation.phase === "return" && operation.issued && gathered())
    return disband();
  if (operation.phase === "assemble" && gathered())
    beginAdvance(context, operation, units);
  const destination = operation.phase === "advance" ? operation.target : rally;
  const remaining =
    positions.reduce(
      (sum, position) => sum + distance(position, destination),
      0,
    ) / positions.length;
  const fighting = units.some(
    (unit) => (unit.combat?.activeTick ?? -1) > operation.progressTick,
  );
  if (
    fighting ||
    operation.closest === undefined ||
    remaining < operation.closest - terrain.tileSize
  ) {
    operation.closest = remaining;
    operation.progressTick = tick;
  } else if (
    tick - operation.progressTick >=
    secondsToTicks(tuning.stallSeconds, context.tickSeconds)
  ) {
    operation.retries += 1;
    operation.progressTick = tick;
    delete operation.issued;
  }
  if (operation.retries > tuning.maxRetries) {
    if (operation.phase === "return") return disband();
    if (operation.phase === "assemble") beginAdvance(context, operation, units);
    else fail();
  }
  if (
    !operation.issued &&
    context.issue(groupOrder(operation, [...movingMembers(operation)]))
  )
    operation.issued = true;
  if (operation.phase !== "return") follow(context, terrain, operation, center);
  return event;
}

/** Sends unclaimed survivors home, retaining orders that hit the tick limit. */
export function withdrawOperations(context: AiWithdrawalContext) {
  const memory = context.memory as OperationsMemory;
  const pending = (memory.operations ?? []).filter((operation) => {
    const available = (id: string) =>
      context.view.ownMobileActor(id) && context.canOrder(id);
    operation.units = operation.units.filter(available);
    const support = operation.support?.filter(available);
    if (support?.length) operation.support = support;
    else delete operation.support;
    const survivors = operationMembers(operation);
    return (
      survivors.length > 0 &&
      !context.issue({
        kind: "group-move",
        actorIds: [...survivors],
        target: operation.rally,
      })
    );
  });
  if (pending.length) memory.operations = pending;
  else delete memory.operations;
  return !pending.length;
}

/** Every operation saved in an owner's concern memory, for diagnostics. */
export const operationsOf = (memory: Readonly<Record<string, unknown>>) =>
  Object.entries(memory).flatMap(([concern, value]) => {
    const operations = isRecord(value) ? value.operations : undefined;
    return Array.isArray(operations)
      ? operations
          .filter(isOperation)
          .map((operation) => ({ concern, operation }))
      : [];
  });
