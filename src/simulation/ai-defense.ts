// Faction-neutral local defense of the base and its workers.
import { compareIds, isWorkerDefinition } from "./actor";
import { definitionOf, headquarters } from "./ai-planning";
import {
  armyUnits,
  endOperation,
  hasValidOperations,
  launchOperation,
  redirectOperation,
  reinforceOperation,
  stagingPoint,
  stepOperation,
  withdrawOperations,
  strengthOf,
  visibleHostiles,
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
 * nearby army units, in every posture that lists it. It requests the
 * defending posture while threatened and holds it until threats stay away.
 */
export const defense: AiConcern = (context) => {
  const { terrain, tick } = context;
  if (!terrain) return;
  const memory = context.memory as DefenseMemory;
  const assets = context.view
    .actors()
    .own.filter(
      (actor) =>
        !!actor.tilePlacement ||
        isWorkerDefinition(definitionOf(context, actor)),
    );
  const tuning = context.tuning.defense;
  const range = tuning.threatTiles * terrain.tileSize;
  const threats = visibleHostiles(context).filter((hostile) =>
    assets.some(
      (asset) => distance(asset.worldPosition, hostile.worldPosition) <= range,
    ),
  );
  let operation: Operation | undefined = memory.operations?.[0];
  if (threats.length) {
    delete memory.calmTick;
    context.requestPosture("defending");
    const home = headquarters(context)?.worldPosition;
    const [nearest] = [...threats].sort(
      (a, b) =>
        (home
          ? distance(a.worldPosition, home) - distance(b.worldPosition, home)
          : 0) || compareIds(a.id, b.id),
    );
    const target = nearest!.worldPosition;
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
    memory.calmTick ??= tick;
    const calm =
      tick - memory.calmTick >=
      secondsToTicks(tuning.calmSeconds, context.tickSeconds);
    if (!calm) {
      // Holding the posture keeps lower-urgency requests waiting.
      if (context.posture === "defending") context.requestPosture("defending");
    } else {
      if (operation && operation.phase !== "return")
        endOperation(context, operation, "completed");
      if (
        context.posture === "defending" &&
        !context.requestPosture("developing")
      )
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
    .sort(
      (a, b) =>
        distance(a.worldPosition, operation.target) -
          distance(b.worldPosition, operation.target) || compareIds(a.id, b.id),
    );
  for (const unit of candidates) {
    if (strengthOf(context, committed) >= threat * context.tuning.defense.odds)
      break;
    if (!context.claim(unit.id)) continue;
    committed.push(unit);
    added.push(unit.id);
  }
  if (added.length) reinforceOperation(context, operation, added);
}
