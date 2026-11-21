// Faction-neutral local defense of the base and its workers.
import { compareIds, nearestTo } from "./actor";
import { headquarters } from "./ai-planning";
import {
  armyUnits,
  baseThreats,
  endOperation,
  hasValidOperations,
  launchOperation,
  redirectOperation,
  reinforceOperation,
  stagingPoint,
  stepOperation,
  withdrawOperations,
  strengthOf,
} from "./ai-operations";
import { secondsToTicks } from "./clock";
import { isCount } from "./validation";
import { distance } from "./world";

import type { Operation, OperationsMemory } from "./ai-operations";
import type { AiConcern, AiConcernContext } from "./director";

type DefenseMemory = OperationsMemory & {
  /** Since when no threat has been seen; absent while threatened. */
  calmTick?: number;
};

/**
 * Meets detected armed hostiles near own buildings and workers with enough
 * nearby army units, in every posture that lists it. Defenders return once
 * no threat remains near the base. It requests the defending posture while
 * threatened and holds it until threats stay away.
 */
export const defense: AiConcern = (context) => {
  const { terrain, tick } = context;
  if (!terrain) return;
  const memory = context.memory as DefenseMemory;
  const tuning = context.tuning.defense;
  const threats = baseThreats(context, terrain);
  let operation: Operation | undefined = memory.operations?.[0];
  if (threats.length) {
    delete memory.calmTick;
    context.requestPosture("defending");
    const home = headquarters(context)?.worldPosition;
    threats.sort(home ? nearestTo(home) : (a, b) => compareIds(a.id, b.id));
    const nearest = threats[0]!;
    const target = nearest.worldPosition;
    const rally = stagingPoint(context) ?? target;
    if (!operation)
      operation = launchOperation(context, {
        id: "defense",
        kind: "defend",
        phase: "advance",
        target,
        rally,
        units: [],
      });
    else if (
      operation.phase !== "advance" ||
      distance(operation.target, target) >
        tuning.retargetTiles * terrain.tileSize
    )
      redirectOperation(context, operation, target);
    commitDefenders(context, operation, strengthOf(context, threats));
  } else {
    if (operation && operation.phase !== "return")
      endOperation(context, operation, "completed");
    memory.calmTick ??= tick;
    if (context.posture === "defending") {
      const calm =
        tick - memory.calmTick >=
        secondsToTicks(tuning.calmSeconds, context.tickSeconds);
      if (!calm) context.requestPosture("defending");
      else if (!context.requestPosture("developing"))
        context.requestPosture("establishing");
    }
  }
  if (
    operation &&
    stepOperation(context, terrain, operation, { retreats: false }) === "ended"
  )
    operation = undefined;
  if (operation) memory.operations = [operation];
  else delete memory.operations;
};

defense.withdraw = withdrawOperations;

defense.validateMemory = (memory) =>
  hasValidOperations(memory) &&
  (memory.calmTick === undefined || isCount(memory.calmTick));

/** Adds the army units nearest the threat until the defense outmatches it. */
function commitDefenders(
  context: AiConcernContext,
  operation: Operation,
  threat: number,
) {
  const held = new Set(operation.units);
  const committed = operation.units.flatMap((id) => {
    const unit = context.view.ownMobileActor(id);
    return unit ? [unit] : [];
  });
  const added: string[] = [];
  const candidates = armyUnits(context)
    .filter(({ id }) => !held.has(id))
    .sort(nearestTo(operation.target));
  for (const unit of candidates) {
    if (strengthOf(context, committed) >= threat * context.tuning.defense.odds)
      break;
    if (!context.claim(unit.id)) continue;
    committed.push(unit);
    added.push(unit.id);
  }
  if (added.length) reinforceOperation(context, operation, added);
}
