// Group controller for faction operations: assembly, advance, and return.
import { compareIds, healthOf, isArmyUnit } from "./actor";
import {
  armyProducer,
  definitionOf,
  headquarters,
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
const OPERATION_OUTCOMES = ["completed", "failed", "cancelled"] as const;
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
 * Runs one turn of an operation's group: it assembles at its rally point,
 * advances on its target, regroups when strung out, and returns home after
 * it ends. Stalls and refused orders are retried a bounded number of times.
 * With `retreats`, an outmatched advance fails. The group is released once
 * home or gone.
 */
export function stepOperation(
  context: AiConcernContext,
  terrain: TerrainView,
  operation: Operation,
  { retreats }: { retreats: boolean },
): OperationEvent {
  const { tick } = context;
  const tuning = context.tuning.operations;
  operation.units = operation.units.filter((id) => context.claim(id));
  const units = operation.units.map((id) => context.view.ownMobileActor(id)!);
  if (!units.length) return "ended";
  const disband = () => {
    for (const id of operation.units) context.release(id);
    return "ended" as const;
  };
  let event: OperationEvent;
  const fail = () => {
    endOperation(context, operation, "failed");
    event = "failed";
  };
  // A crowded group leaves out members already beside the order's point;
  // they cannot get closer, which is not a stall.
  const gatherRange = tuning.gatherTiles * terrain.tileSize;
  if (
    context.rejections.some(
      ({ command }) =>
        (command.kind === "move" || command.kind === "attack-move") &&
        operation.units.includes(command.actorId) &&
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
  const center = centerOf(units);
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
      const [meeting] = [...units].sort(
        (a, b) =>
          distance(a.worldPosition, center) -
            distance(b.worldPosition, center) || compareIds(a.id, b.id),
      );
      operation.regroups += 1;
      operation.regroup = { ...meeting!.worldPosition };
      enterPhase(context, operation, "assemble");
    }
  }
  const rally = operation.regroup ?? operation.rally;
  const gathered = () =>
    units.every((unit) => distance(unit.worldPosition, rally) <= gatherRange);
  // A failure is reported before the group can disband.
  if (operation.phase === "return" && !event && gathered()) return disband();
  if (operation.phase === "assemble" && gathered())
    beginAdvance(context, operation, units);
  const destination = operation.phase === "advance" ? operation.target : rally;
  const remaining =
    units.reduce(
      (sum, unit) => sum + distance(unit.worldPosition, destination),
      0,
    ) / units.length;
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
    context.issue(groupOrder(operation, [...operation.units]))
  )
    operation.issued = true;
  return event;
}

/** Sends unclaimed survivors home, retaining orders that hit the tick limit. */
export function withdrawOperations(context: AiWithdrawalContext) {
  const memory = context.memory as OperationsMemory;
  const pending = (memory.operations ?? []).filter((operation) => {
    operation.units = operation.units.filter(
      (id) => context.view.ownMobileActor(id) && context.canOrder(id),
    );
    return (
      operation.units.length > 0 &&
      !context.issue({
        kind: "group-move",
        actorIds: operation.units,
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
