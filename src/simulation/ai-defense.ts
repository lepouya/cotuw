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
  strengthOf,
  visibleHostiles,
} from "./ai-operations";
import { secondsToTicks } from "./clock";
import { isCount } from "./validation";
import { distance } from "./world";

import type { Operation, OperationsMemory } from "./ai-operations";
import type { AiConcern, AiConcernContext } from "./director";

/** Initial tuning: hostiles this near own buildings or workers threaten them. */
const THREAT_TILES = 12;
/** Initial tuning: defense commits this multiple of the threat's strength. */
const DEFENSE_ODDS = 1.5;
/** Initial tuning: threats must stay away this long before defense ends. */
const CALM_SECONDS = 10;
/** The objective follows threats that move at least this far. */
const RETARGET_TILES = 3;

type DefenseMemory = OperationsMemory & {
  /** Since when no threat has been seen; absent while threatened. */
  calmTick?: number;
};

/**
 * Meets detected armed hostiles near own buildings and workers with enough
 * nearby army units, in every posture that lists it. It requests the
 * defending posture while threatened and leaves it once threats stay away.
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
  const range = THREAT_TILES * terrain.tileSize;
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
      distance(operation.target, target) > RETARGET_TILES * terrain.tileSize
    )
      redirectOperation(context, operation, target);
    commitDefenders(context, operation, strengthOf(context, threats));
  } else {
    memory.calmTick ??= tick;
    if (
      tick - memory.calmTick >=
      secondsToTicks(CALM_SECONDS, context.tickSeconds)
    ) {
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
    if (strengthOf(context, committed) >= threat * DEFENSE_ODDS) break;
    if (!context.claim(unit.id)) continue;
    committed.push(unit);
    added.push(unit.id);
  }
  if (added.length) reinforceOperation(context, operation, added);
}
