import { secondsToTicks } from "./clock";
import { isRelationshipChange, setRelationship } from "./ownership";
import { hasOwn, isId, isIdList, isPositive, isRecord } from "./validation";

import type { ObjectiveStatus } from "./objectives";
import type { OwnerRelationship, RelationshipChange } from "./ownership";

/** Holds once its condition is met; each event fires at most once. */
export type MissionEventTrigger =
  | { readonly kind: "time"; readonly seconds: number }
  | { readonly kind: "objective-complete"; readonly objectiveId: string };

export type MissionEventAction = RelationshipChange & {
  readonly kind: "set-relationship";
};

/** Authored mission logic that applies its actions when its trigger holds. */
export type MissionEventDefinition = {
  readonly id: string;
  readonly trigger: MissionEventTrigger;
  readonly actions: readonly MissionEventAction[];
};

/** Saved event progress and the state event actions may change. */
export type EventState = {
  firedEvents: string[];
  relationships: OwnerRelationship[];
};

/** What a trigger may observe at the end of a tick. */
export type EventContext = {
  /** Ticks completed once the current tick commits. */
  completedTicks: number;
  tickSeconds: number;
  objectiveStatus: (id: string) => ObjectiveStatus | undefined;
};

/** Authored references an event may name. */
type EventScope = {
  ownerIds: ReadonlySet<string>;
  objectiveIds: ReadonlySet<string>;
};

type TriggerRule<T extends MissionEventTrigger = MissionEventTrigger> = {
  valid: (trigger: T, scope: EventScope) => boolean;
  holds: (trigger: T, context: EventContext) => boolean;
};

type ActionRule<A extends MissionEventAction = MissionEventAction> = {
  valid: (action: A, scope: EventScope) => boolean;
  apply: (action: A, state: EventState) => void;
};

/** One rule per trigger kind; adding a kind requires one. */
const TRIGGERS: {
  [K in MissionEventTrigger["kind"]]: TriggerRule<
    Extract<MissionEventTrigger, { kind: K }>
  >;
} = {
  time: {
    valid: (trigger) => isPositive(trigger.seconds),
    holds: (trigger, context) =>
      context.completedTicks >=
      secondsToTicks(trigger.seconds, context.tickSeconds),
  },
  "objective-complete": {
    valid: (trigger, scope) => scope.objectiveIds.has(trigger.objectiveId),
    holds: (trigger, context) =>
      context.objectiveStatus(trigger.objectiveId) === "complete",
  },
};

/** One rule per action kind; adding a kind requires one. */
const ACTIONS: {
  [K in MissionEventAction["kind"]]: ActionRule<
    Extract<MissionEventAction, { kind: K }>
  >;
} = {
  "set-relationship": {
    valid: (action, scope) => isRelationshipChange(action, scope.ownerIds),
    apply: (action, state) => setRelationship(state.relationships, action),
  },
};

const triggerRule = (trigger: MissionEventTrigger) =>
  TRIGGERS[trigger.kind] as TriggerRule;
const actionRule = (action: MissionEventAction) =>
  ACTIONS[action.kind] as ActionRule;

/**
 * Fires due events in authored order. Returns the changed state, or nothing
 * when no event fired, so quiet ticks allocate nothing.
 */
export function fireEvents(
  events: readonly MissionEventDefinition[],
  current: {
    readonly firedEvents: readonly string[];
    readonly relationships: readonly OwnerRelationship[];
  },
  context: EventContext,
): EventState | undefined {
  let next: EventState | undefined;
  for (const event of events) {
    if (
      current.firedEvents.includes(event.id) ||
      !triggerRule(event.trigger).holds(event.trigger, context)
    )
      continue;
    next ??= {
      firedEvents: [...current.firedEvents],
      relationships: [...current.relationships],
    };
    next.firedEvents.push(event.id);
    for (const action of event.actions) actionRule(action).apply(action, next);
  }
  return next;
}

export function validateEvents(
  events: readonly MissionEventDefinition[],
  fired: readonly string[],
  scope: EventScope,
): void {
  const ids = new Set<string>();
  for (const event of events) {
    if (
      !isRecord(event) ||
      !isId(event.id) ||
      ids.has(event.id) ||
      !isRecord(event.trigger) ||
      !hasOwn(TRIGGERS, event.trigger.kind) ||
      !triggerRule(event.trigger).valid(event.trigger, scope) ||
      !Array.isArray(event.actions) ||
      event.actions.length === 0 ||
      !event.actions.every(
        (action) =>
          !!action &&
          hasOwn(ACTIONS, action.kind) &&
          actionRule(action).valid(action, scope),
      )
    )
      throw new RangeError("Mission has an invalid event definition.");
    ids.add(event.id);
  }
  if (!isIdList(fired) || fired.some((id) => !ids.has(id)))
    throw new RangeError("Mission state has invalid fired events.");
}
