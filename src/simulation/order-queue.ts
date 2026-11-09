import { isWorkerDefinition } from "./actor";
import { workerHasOrder } from "./economy";
import { isMobileActor } from "./placement";
import { clampToBounds } from "./world";

import type { Actor, ActorDefinition, QueuedOrder } from "./actor";
import type {
  ACTOR_ORDER_KINDS,
  CommandResult,
  MissionCommand,
} from "./command";
import type { EconomyState, EconomyView } from "./economy";
import type { WorldBounds, WorldPosition } from "./world";

export type ActorOrderCommand = Extract<
  MissionCommand,
  { kind: (typeof ACTOR_ORDER_KINDS)[number] }
>;

/** Whether an actor is still carrying out an order or a harvest trip. */
export function isBusy(actor: Actor, economy: EconomyView | undefined) {
  return (
    (!!actor.movement && !actor.movement.blocked) ||
    (!!actor.attackMove && !actor.attackMove.blocked) ||
    !!actor.combat?.attack ||
    (!!actor.combat?.returning && !actor.combat.returning.blocked) ||
    workerHasOrder(economy, actor.id)
  );
}

/** The queue entry for a command, if its kind can wait in a queue. */
export function queuedOrderOf(
  command: ActorOrderCommand,
  bounds: WorldBounds,
  requestedTarget?: WorldPosition,
): QueuedOrder | undefined {
  switch (command.kind) {
    case "move":
    case "attack-move":
      return {
        kind: command.kind,
        target: clampToBounds(command.target, bounds),
        ...(requestedTarget && { requestedTarget: { ...requestedTarget } }),
      };
    case "attack":
      return { kind: "attack", targetId: command.targetId };
    case "gather":
      return { kind: "gather", siteId: command.siteId };
    default:
      return undefined;
  }
}

export function canQueueOrder(
  order: QueuedOrder,
  definition: ActorDefinition,
  hasEconomy: boolean,
): boolean {
  return (
    (order.kind !== "attack" || !!definition.weapon) &&
    (order.kind !== "gather" || (hasEconomy && isWorkerDefinition(definition)))
  );
}

/** Why an actor can never carry out an order, if its definition decides. */
function queueRejection(
  order: QueuedOrder | undefined,
  definition: ActorDefinition,
): "unarmed" | "invalid-harvester" | undefined {
  if (order?.kind === "attack" && !definition.weapon) return "unarmed";
  if (
    order?.kind === "gather" &&
    !definition.harvesting &&
    !definition.cultivation
  )
    return "invalid-harvester";
  return undefined;
}

/**
 * Queues an order behind a busy actor's current one. Returns the outcome, or
 * `undefined` when the command should run now instead.
 */
export function enqueueOrder(
  actor: Actor,
  command: ActorOrderCommand,
  order: QueuedOrder | undefined,
  {
    definition,
    economy,
    tick,
  }: {
    definition: ActorDefinition;
    economy: EconomyState | undefined;
    tick: number;
  },
): CommandResult | undefined {
  if (!("queued" in command && command.queued)) return undefined;
  if (!actor.orders && !isBusy(actor, economy)) return undefined;
  // Only checks it can ever carry the order out; the rest waits until then.
  const accepted =
    !!order &&
    isMobileActor(actor, definition) &&
    canQueueOrder(order, definition, !!economy);
  if (accepted) (actor.orders ??= []).push(order);
  const reason = accepted ? undefined : queueRejection(order, definition);
  return {
    tick,
    command: structuredClone(command),
    accepted,
    ...(accepted && { queued: true }),
    ...(reason && { reason }),
  } as CommandResult;
}
