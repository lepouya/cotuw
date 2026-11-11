// Faction-neutral raids on observed income and attacks on observed bases.
import { compareIds, isIncomeBuilding } from "./actor";
import {
  isAvoided,
  isAvoidedList,
  isStaleReport,
  recentAvoided,
} from "./ai-planning";
import {
  armyUnits,
  endOperation,
  hasValidOperations,
  launchOperation,
  redirectOperation,
  stagingPoint,
  stepOperation,
  strengthOf,
} from "./ai-operations";
import { secondsToTicks } from "./clock";
import { isCount } from "./validation";
import { distance } from "./world";

import type { ActorRenderState } from "./actor";
import type { Avoided } from "./ai-planning";
import type { Operation, OperationsMemory } from "./ai-operations";
import type { AiConcern, AiConcernContext } from "./director";
import type { ActorSighting } from "./observations";
import type { TerrainView } from "./terrain";
import type { WorldPosition } from "./world";

type OffenseMemory = OperationsMemory & {
  nextId?: number;
  /** Where advances failed, and when. */
  avoid?: Avoided[];
};

type Target = Pick<ActorSighting, "actorId" | "worldPosition">;
type Launch = { kind: "raid" | "attack"; target: Target; units: string[] };

/**
 * Raids exposed enemy income and attacks enemy bases from observations, after
 * the opening grace period. Developing requests pressuring once an operation
 * is possible; pressuring launches them and returns to developing when none
 * is active or possible. Other postures only continue running operations.
 */
export const offense: AiConcern = (context) => {
  const { terrain, tick } = context;
  if (!terrain) return;
  const memory = context.memory as OffenseMemory;
  const tuning = context.tuning.offense;
  const avoid = recentAvoided(
    memory.avoid,
    tick,
    secondsToTicks(tuning.avoidSeconds, context.tickSeconds),
  );
  const buildings = hostileBuildings(context);
  const operations: Operation[] = [];
  for (const operation of memory.operations ?? []) {
    if (operation.phase !== "return")
      resolve(context, terrain, operation, buildings);
    const event = stepOperation(context, terrain, operation, {
      retreats: true,
    });
    if (event === "failed") avoid.push({ ...operation.target, tick });
    if (event !== "ended") operations.push(operation);
  }
  const home = stagingPoint(context);
  const graced =
    tick >= secondsToTicks(tuning.graceSeconds, context.tickSeconds);
  // Claims test which units the posture's share allows; unused ones go back.
  const busy = new Set(operations.flatMap(({ units }) => units));
  const free =
    graced && home
      ? armyUnits(context)
          .sort(
            (a, b) =>
              distance(a.worldPosition, home) -
                distance(b.worldPosition, home) || compareIds(a.id, b.id),
          )
          .filter(({ id }) => !busy.has(id) && context.claim(id))
      : [];
  const range = tuning.avoidTiles * terrain.tileSize;
  const launch =
    graced && home
      ? nextLaunch(
          context,
          terrain,
          home,
          operations,
          buildings.filter(
            ({ worldPosition }) => !isAvoided(avoid, worldPosition, range),
          ),
          free,
        )
      : undefined;
  if (context.posture === "developing" && launch)
    context.requestPosture("pressuring");
  else if (context.posture === "pressuring") {
    if (launch) {
      const id = `${launch.kind}:${memory.nextId ?? 1}`;
      memory.nextId = (memory.nextId ?? 1) + 1;
      operations.push(
        launchOperation(context, {
          id,
          kind: launch.kind,
          phase: "assemble",
          target: launch.target.worldPosition,
          targetId: launch.target.actorId,
          rally: home!,
          units: launch.units,
        }),
      );
    } else if (!operations.length) context.requestPosture("developing");
  }
  const launched = new Set(
    context.posture === "pressuring" ? launch?.units : undefined,
  );
  for (const { id } of free) if (!launched.has(id)) context.release(id);
  if (operations.length) memory.operations = operations;
  else delete memory.operations;
  if (avoid.length) memory.avoid = avoid;
  else delete memory.avoid;
};

offense.validateMemory = (memory) =>
  hasValidOperations(memory) &&
  isAvoidedList(memory.avoid) &&
  (memory.nextId === undefined ||
    (isCount(memory.nextId) && memory.nextId > 0));

/** Known hostile buildings, in ID order. */
const hostileBuildings = (context: AiConcernContext) =>
  context.view.knowledge.observations.actors.filter(
    (sighting) =>
      !!sighting.tilePlacement &&
      context.view.relationTo(sighting) === "hostile",
  );

/** Known armed buildings and recently reported armed units. */
function knownDefenders(context: AiConcernContext) {
  return context.view.knowledge.observations.actors.filter(
    (sighting) =>
      (!!sighting.tilePlacement || !isStaleReport(context, sighting.tick)) &&
      context.view.relationTo(sighting) === "hostile" &&
      !!context.definitions.get(sighting.definitionId)?.weapon,
  );
}

const nearestTo = <T extends Target>(
  point: WorldPosition,
  targets: readonly T[],
) =>
  [...targets].sort(
    (a, b) =>
      distance(point, a.worldPosition) - distance(point, b.worldPosition) ||
      compareIds(a.actorId, b.actorId),
  );

/**
 * Follows the reported building, moving on when it is gone: a raid to income
 * nearby, an attack to the nearest known building. Ends with none left, and
 * is cancelled once its target's owner is no longer hostile.
 */
function resolve(
  context: AiConcernContext,
  terrain: TerrainView,
  operation: Operation,
  buildings: readonly ActorSighting[],
) {
  if (buildings.some(({ actorId }) => actorId === operation.targetId)) return;
  const reported = context.view.knowledge.observations.actors.find(
    ({ actorId }) => actorId === operation.targetId,
  );
  if (reported) {
    endOperation(context, operation, "cancelled");
    return;
  }
  const candidates =
    operation.kind === "raid"
      ? buildings.filter(
          (building) =>
            isIncomeBuilding(context.definitions.get(building.definitionId)!) &&
            distance(building.worldPosition, operation.target) <=
              context.tuning.offense.raidRedirectTiles * terrain.tileSize,
        )
      : buildings;
  const [next] = nearestTo(operation.target, candidates);
  if (next)
    redirectOperation(context, operation, next.worldPosition, next.actorId);
  else endOperation(context, operation, "completed");
}

/**
 * The operation to start now, if any: an attack on the nearest known
 * building once enough units are free to outmatch its known defenders,
 * otherwise one raid at a time on the least defended known income.
 */
function nextLaunch(
  context: AiConcernContext,
  terrain: TerrainView,
  home: WorldPosition,
  operations: readonly Operation[],
  targets: readonly ActorSighting[],
  /** Claimable units not in operations, nearest home first. */
  free: readonly ActorRenderState[],
): Launch | undefined {
  if (!targets.length) return;
  const { attack, defendedTiles, raid } = context.tuning.offense;
  const active = (kind: Operation["kind"]) =>
    operations.some((operation) => operation.kind === kind);
  const army = knownDefenders(context);
  const range = defendedTiles * terrain.tileSize;
  const defenseOf = (target: Target) =>
    strengthOf(
      context,
      army.filter(
        ({ worldPosition }) =>
          distance(worldPosition, target.worldPosition) <= range,
      ),
    );
  const [base] = nearestTo(home, targets);
  if (
    !active("attack") &&
    free.length >= attack.units &&
    strengthOf(context, free) >= defenseOf(base!) * attack.odds
  )
    return { kind: "attack", target: base!, units: free.map(({ id }) => id) };
  if (active("raid") || active("attack")) return;
  const raids = targets
    .filter((target) =>
      isIncomeBuilding(context.definitions.get(target.definitionId)!),
    )
    .map((target) => ({ target, defense: defenseOf(target) }))
    .sort(
      (a, b) =>
        a.defense - b.defense ||
        distance(home, a.target.worldPosition) -
          distance(home, b.target.worldPosition) ||
        compareIds(a.target.actorId, b.target.actorId),
    );
  for (const { target, defense } of raids) {
    const units = raidGroup(context, free, defense * raid.odds);
    if (units) return { kind: "raid", target, units };
  }
}

/** The fewest free units that reach the minimum size and needed strength. */
function raidGroup(
  context: AiConcernContext,
  free: readonly ActorRenderState[],
  needed: number,
) {
  const { minUnits, maxUnits } = context.tuning.offense.raid;
  for (let size = minUnits; size <= maxUnits; size++) {
    const group = free.slice(0, size);
    if (group.length < size) return;
    if (strengthOf(context, group) >= needed) return group.map(({ id }) => id);
  }
}
