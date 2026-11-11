// Strategic control for AI owners, run by the mission before each tick's commands.
import { compareIds, isWorkerDefinition } from "./actor";
import { isAiTuning } from "./ai-tuning";
import { secondsToTicks } from "./clock";
import { commandActorIds, isMissionCommand } from "./command";
import {
  costAmount,
  costResource,
  RESOURCE_IDS,
  RESOURCE_SCALE,
} from "./resources";
import { resourceBalances } from "./stockpiles";
import {
  hasOwn,
  isCount,
  isId,
  isIdList,
  isJson,
  isNonnegative,
  isOneOf,
  isPositive,
  isRecord,
} from "./validation";

import type { ActorDefinition, DeepReadonly } from "./actor";
import type { AiTuning } from "./ai-tuning";
import type { CommandResult, MissionCommand } from "./command";
import type { OwnerView } from "./owner-view";
import type { Resource } from "./resources";
import type { TerrainView } from "./terrain";

export const AI_POSTURES = [
  "establishing",
  "developing",
  "pressuring",
  "defending",
  "recovering",
] as const;
export type AiPosture = (typeof AI_POSTURES)[number];

/** One concern's priority and shares within a posture. */
export type AiAllocation = {
  /** Built-in code the mission's concern registry names by ID. */
  readonly concern: string;
  /** Share of unallocated resources, relative to the posture's other concerns. */
  readonly budget: number;
  /** Share of fielded non-worker units. */
  readonly forces: number;
  /** May draw lower-priority budgets and take non-essential claims. */
  readonly essential?: boolean;
};

/** Data-driven AI behavior, independent of difficulty scaling. */
export type AiProfile = {
  readonly id: string;
  /** Time between the starts of planning rounds. */
  readonly roundSeconds: number;
  readonly concernsPerTick: number;
  readonly commandsPerTick: number;
  /** Permitted postures, each listing its concerns by priority. */
  readonly postures: Readonly<
    Partial<Record<AiPosture, readonly AiAllocation[]>>
  >;
  readonly tuning: AiTuning;
};

/** Names the pack profile that controls a scenario's owner. */
export type AiAssignment = {
  readonly owner: string;
  readonly profileId: string;
};
export type AiController = {
  readonly owner: string;
  readonly profile: AiProfile;
};

/** A concern's command the mission refused at its tick. */
export type AiRejection = {
  concern: string;
  tick: number;
  command: MissionCommand;
  reason?: CommandResult["reason"];
};

/** One AI owner's saved strategic state. */
export type OwnerAiState = {
  posture: AiPosture;
  /** Takes effect when the next round starts. */
  requestedPosture?: AiPosture;
  nextRoundTick: number;
  /** Owner-local sequence; generating IDs must not read hidden actors. */
  nextActorNumber: number;
  /** The next concern of the round in progress; absent between rounds. */
  cursor?: number;
  /** Resource reservations, reconciled with the balance before planning. */
  budgets: Record<string, Partial<Record<Resource, number>>>;
  /** The concern holding each claimed actor. */
  claims: Record<string, string>;
  /** Waiting for their concern's next turn. */
  rejections: AiRejection[];
  /** Each concern's own JSON state. */
  memory: Record<string, Record<string, unknown>>;
};
export type AiState = Record<string, OwnerAiState>;

/**
 * What a concern may read and do on its turn. There is no route to the
 * simulation, so planning stays within the owner's legal view.
 */
export type AiConcernContext = {
  readonly tick: number;
  readonly tickSeconds: number;
  readonly view: OwnerView;
  /** The authored map; absent from missions without terrain. */
  readonly terrain: TerrainView | undefined;
  readonly definitions: ReadonlyMap<string, ActorDefinition>;
  readonly posture: AiPosture;
  readonly tuning: AiTuning;
  /** The concern's saved state; it must stay JSON. */
  readonly memory: Record<string, unknown>;
  /** This concern's refused commands since its previous turn. */
  readonly rejections: readonly AiRejection[];
  /** What this concern may spend of a resource. */
  funds: (resource: Resource) => number;
  /**
   * Returns this concern's unspent budget beyond `keep`, so the next
   * reconciliation shares it by weight. For a concern with nothing left, or
   * only a reserve, to save for.
   */
  releaseFunds: (keep?: Partial<Record<Resource, number>>) => void;
  /**
   * Queues a command for this tick. Creation commands spend their price from
   * the concern's funds. False when funds or the tick's command limit run out,
   * or when it names an actor the owner cannot see or an ID from elsewhere.
   */
  issue: (command: MissionCommand) => boolean;
  /** A fresh owner-scoped ID, independent of other owners' hidden actors. */
  newActorId: (definitionId: string) => string;
  /** This concern's claimed actors, by stable ID. */
  claimed: () => string[];
  /** Whether this concern now holds a fielded non-worker unit of the owner. */
  claim: (actorId: string) => boolean;
  release: (actorId: string) => void;
  /** False when the profile forbids it. The highest-priority request wins. */
  requestPosture: (posture: AiPosture) => boolean;
};
export type AiConcern = ((context: AiConcernContext) => void) & {
  /** Validates this concern's saved state before a mission starts. */
  validateMemory?: (memory: Record<string, unknown>) => boolean;
};

/** Budget reservations to return if a command is refused. */
export type AiCommandSource = {
  owner: string;
  concern: string;
  debits: { concern: string; resource: Resource; amount: number }[];
};

/** An owner's AI state summarized for reports and development tools. */
export type AiDiagnostics = DeepReadonly<
  Pick<OwnerAiState, "posture" | "requestedPosture" | "budgets" | "memory">
> & {
  /** Claimed actors by concern. */
  claims: Record<string, number>;
  /** Refused commands still waiting for their concerns' next turns. */
  rejections: {
    concern: string;
    tick: number;
    kind: string;
    reason?: string;
  }[];
};

export function aiDiagnostics({
  posture,
  requestedPosture,
  budgets,
  claims,
  rejections,
  memory,
}: DeepReadonly<OwnerAiState>): AiDiagnostics {
  const claimed = new Map<string, number>();
  for (const concern of Object.values(claims))
    claimed.set(concern, (claimed.get(concern) ?? 0) + 1);
  return {
    posture,
    ...(requestedPosture && { requestedPosture }),
    budgets,
    claims: Object.fromEntries(claimed),
    rejections: rejections.map(({ concern, tick, command, reason }) => ({
      concern,
      tick,
      kind: command.kind,
      ...(reason && { reason }),
    })),
    memory,
  };
}

/** The mission services the director uses. */
export type DirectorHost = {
  tickSeconds: number;
  terrain?: TerrainView;
  definitions: ReadonlyMap<string, ActorDefinition>;
  concerns: ReadonlyMap<string, AiConcern>;
  viewOf: (owner: string) => OwnerView;
  submit: (command: MissionCommand, source: AiCommandSource) => void;
};

/** Drops float error from a share, so it can match a whole price or count. */
const settled = (share: number) =>
  Math.round(share * RESOURCE_SCALE) / RESOURCE_SCALE;

export function validateAiProfile(profile: AiProfile) {
  const valid =
    isRecord(profile) &&
    isId(profile.id) &&
    isPositive(profile.roundSeconds) &&
    isCount(profile.concernsPerTick) &&
    isPositive(profile.concernsPerTick) &&
    isCount(profile.commandsPerTick) &&
    isPositive(profile.commandsPerTick) &&
    isAiTuning(profile.tuning) &&
    isRecord(profile.postures) &&
    hasOwn(profile.postures, "establishing") &&
    Object.entries(profile.postures).every(
      ([posture, allocations]) =>
        isOneOf(AI_POSTURES, posture) &&
        Array.isArray(allocations) &&
        isIdList(allocations.map((allocation) => allocation?.concern)) &&
        allocations.every(
          ({ budget, forces, essential }) =>
            isNonnegative(budget) &&
            isNonnegative(forces) &&
            (essential === undefined || typeof essential === "boolean"),
        ),
    );
  if (!valid)
    throw new RangeError(
      `AI profile ${isRecord(profile) ? profile.id : ""} needs an id, round time, work limits, tuning, and allocations for establishing and its other postures.`,
    );
}

const profileConcerns = (profile: AiProfile) =>
  Object.values(profile.postures).flatMap((allocations) =>
    allocations.map(({ concern }) => concern),
  );

/** Each owner is controlled once, by a profile whose concerns exist. */
export function validateAiControllers(
  controllers: readonly AiController[],
  owners: ReadonlySet<string>,
  concerns: ReadonlyMap<string, AiConcern>,
  tickSeconds: number,
) {
  if (!isIdList(controllers.map(({ owner }) => owner)))
    throw new RangeError("Each owner can have only one AI controller.");
  for (const { owner, profile } of controllers) {
    if (!owners.has(owner))
      throw new RangeError(`AI controller names unknown owner: ${owner}.`);
    validateAiProfile(profile);
    if (!isCount(secondsToTicks(profile.roundSeconds, tickSeconds)))
      throw new RangeError(
        `AI profile ${profile.id} has an unsafe round interval.`,
      );
    if (!isAiTuning(profile.tuning, tickSeconds))
      throw new RangeError(
        `AI profile ${profile.id} has an unsafe tuning duration.`,
      );
    for (const concern of profileConcerns(profile))
      if (!concerns.has(concern))
        throw new RangeError(
          `AI profile ${profile.id} uses unknown concern "${concern}".`,
        );
  }
}

/** Offsets each owner's first round, so owners plan on separate ticks. */
export const createAiState = (owners: readonly { owner: string }[]): AiState =>
  Object.fromEntries(
    owners.map(({ owner }, index): [string, OwnerAiState] => [
      owner,
      {
        posture: "establishing",
        nextRoundTick: index,
        nextActorNumber: 1,
        budgets: {},
        claims: {},
        rejections: [],
        memory: {},
      },
    ]),
  );

export function validateAiState(
  ai: AiState,
  controllers: readonly AiController[],
  actorIds: ReadonlySet<string>,
  concerns: ReadonlyMap<string, AiConcern>,
) {
  const valid =
    isRecord(ai) &&
    Object.keys(ai).length === controllers.length &&
    controllers.every(({ owner, profile }) => {
      if (!hasOwn(ai, owner)) return false;
      const state = ai[owner]!;
      const known = new Set(profileConcerns(profile));
      return (
        isRecord(state) &&
        isOneOf(AI_POSTURES, state.posture) &&
        hasOwn(profile.postures, state.posture) &&
        (state.requestedPosture === undefined ||
          (isOneOf(AI_POSTURES, state.requestedPosture) &&
            hasOwn(profile.postures, state.requestedPosture))) &&
        isCount(state.nextRoundTick) &&
        isCount(state.nextActorNumber) &&
        state.nextActorNumber > 0 &&
        (state.cursor === undefined ||
          (isCount(state.cursor) &&
            state.cursor <= profile.postures[state.posture]!.length)) &&
        isRecord(state.budgets) &&
        Object.entries(state.budgets).every(
          ([concern, funds]) =>
            known.has(concern) &&
            isRecord(funds) &&
            Object.entries(funds).every(
              ([resource, amount]) =>
                isOneOf(RESOURCE_IDS, resource) && isNonnegative(amount),
            ),
        ) &&
        isRecord(state.claims) &&
        Object.entries(state.claims).every(
          ([actorId, concern]) => actorIds.has(actorId) && known.has(concern),
        ) &&
        Array.isArray(state.rejections) &&
        state.rejections.every(
          (rejection) =>
            known.has(rejection?.concern) &&
            isCount(rejection.tick) &&
            isMissionCommand(rejection.command) &&
            (rejection.reason === undefined || isId(rejection.reason)),
        ) &&
        isRecord(state.memory) &&
        Object.entries(state.memory).every(
          ([concern, memory]) =>
            known.has(concern) &&
            isRecord(memory) &&
            isJson(memory) &&
            (concerns.get(concern)?.validateMemory?.(memory) ?? true),
        )
      );
    });
  if (!valid) throw new RangeError("Mission state has invalid AI state.");
}

/** Removes a deficit from low-priority budgets first, then splits any surplus. */
function reconcileBudgets(
  ai: OwnerAiState,
  allocations: readonly AiAllocation[],
  view: OwnerView,
) {
  const economy = view.economy();
  const balances = economy ? resourceBalances(economy, view.owner) : {};
  const totalWeight = allocations.reduce((sum, { budget }) => sum + budget, 0);
  for (const allocation of allocations)
    if (!hasOwn(ai.budgets, allocation.concern))
      ai.budgets = { ...ai.budgets, [allocation.concern]: {} };
  for (const resource of RESOURCE_IDS) {
    const held = allocations.reduce(
      (sum, { concern }) => sum + (ai.budgets[concern]![resource] ?? 0),
      0,
    );
    let change = (balances[resource] ?? 0) - held;
    if (change > 0 && totalWeight > 0) {
      for (const { concern, budget } of allocations)
        if (budget > 0)
          ai.budgets[concern]![resource] =
            (ai.budgets[concern]![resource] ?? 0) +
            change * (budget / totalWeight);
    } else if (change < 0) {
      for (const { concern } of [...allocations].reverse()) {
        const taken = Math.min(ai.budgets[concern]![resource] ?? 0, -change);
        if (taken > 0) {
          ai.budgets[concern]![resource]! -= taken;
          change += taken;
        }
      }
    }
  }
}

function beginRound(
  ai: OwnerAiState,
  profile: AiProfile,
  tick: number,
  tickSeconds: number,
) {
  if (ai.requestedPosture) ai.posture = ai.requestedPosture;
  delete ai.requestedPosture;
  const allocations = profile.postures[ai.posture]!;
  const active = new Set(allocations.map(({ concern }) => concern));
  for (const concern of Object.keys(ai.budgets))
    if (!active.has(concern)) delete ai.budgets[concern];
  ai.cursor = 0;
  ai.nextRoundTick = tick + secondsToTicks(profile.roundSeconds, tickSeconds);
}

type ForceAllocation = {
  fielded: ReadonlySet<string>;
  quotas: ReadonlyMap<string, number>;
};

/** Keeps surviving claims within the current posture's force shares. */
function reconcileClaims(
  ai: OwnerAiState,
  allocations: readonly AiAllocation[],
  view: OwnerView,
  definitions: DirectorHost["definitions"],
): ForceAllocation {
  const fielded = new Set(
    view
      .actors()
      .ownMobile.filter(
        (actor) =>
          view.isMobile(actor) &&
          !isWorkerDefinition(definitions.get(actor.definitionId)!),
      )
      .map(({ id }) => id),
  );
  let units = fielded.size;
  let weight = allocations.reduce((sum, { forces }) => sum + forces, 0);
  const quotas = new Map<string, number>();
  for (const { concern, forces, essential } of allocations) {
    // Rounding favors earlier concerns without exceeding the remaining force.
    const share =
      weight > 0
        ? Math.min(units, Math.ceil(settled(units * (forces / weight))))
        : 0;
    quotas.set(concern, essential ? Infinity : share);
    units -= share;
    weight -= forces;
  }
  const remaining = new Map(quotas);
  for (const actorId of Object.keys(ai.claims).sort(compareIds)) {
    const concern = ai.claims[actorId]!;
    const quota = remaining.get(concern) ?? 0;
    if (!fielded.has(actorId) || quota <= 0) delete ai.claims[actorId];
    else remaining.set(concern, quota - 1);
  }
  return { fielded, quotas };
}

function concernContext(
  ai: OwnerAiState,
  profile: AiProfile,
  index: number,
  {
    view,
    tick,
    host,
    spent,
    forces,
  }: {
    view: OwnerView;
    tick: number;
    host: DirectorHost;
    /** The owner's commands so far this tick, across its concerns. */
    spent: { commands: number };
    forces: ForceAllocation;
  },
): AiConcernContext {
  const allocations = profile.postures[ai.posture]!;
  const allocation = allocations[index]!;
  const { concern } = allocation;
  const owner = view.owner;
  const idPrefix = `ai:${owner.length}:${owner}:`;
  /** Refusals could reveal hidden actors, so commands stay within the view. */
  const staysInView = (command: MissionCommand) =>
    commandActorIds(command).every((id) => view.shownActor(id)) &&
    ((command.kind !== "place-actor" && command.kind !== "train-unit") ||
      command.actorId.startsWith(idPrefix)) &&
    (command.kind !== "cancel-production" ||
      !!view
        .economy()
        ?.production.some(({ actorId }) => actorId === command.actorId));
  /** Budgets this concern may use, its own first and then lowest priority. */
  const accounts = () => [
    concern,
    ...(allocation.essential
      ? allocations
          .slice(index + 1)
          .reverse()
          .map((lower) => lower.concern)
      : []),
  ];
  const funds = (resource: Resource) =>
    settled(
      accounts().reduce((sum, id) => sum + (ai.budgets[id]![resource] ?? 0), 0),
    );
  const spend = (resource: Resource, amount: number) => {
    if (funds(resource) < amount) return;
    const debits: AiCommandSource["debits"] = [];
    let owed = amount;
    for (const id of accounts()) {
      const account = ai.budgets[id]!;
      const taken = Math.min(account[resource] ?? 0, owed);
      if (taken > 0) {
        account[resource]! -= taken;
        owed -= taken;
        debits.push({ concern: id, resource, amount: taken });
      }
    }
    return debits;
  };
  const claimed = () =>
    Object.keys(ai.claims)
      .filter((actorId) => ai.claims[actorId] === concern)
      .sort(compareIds);
  const held = (actorId: string) =>
    hasOwn(ai.claims, actorId) ? ai.claims[actorId] : undefined;
  if (!hasOwn(ai.memory, concern)) ai.memory = { ...ai.memory, [concern]: {} };
  const rejections = ai.rejections.filter((entry) => entry.concern === concern);
  ai.rejections = ai.rejections.filter((entry) => entry.concern !== concern);
  return {
    tick,
    tickSeconds: host.tickSeconds,
    view,
    terrain: host.terrain,
    definitions: host.definitions,
    posture: ai.posture,
    tuning: profile.tuning,
    memory: ai.memory[concern]!,
    rejections,
    funds,
    releaseFunds: (keep = {}) => {
      const account = ai.budgets[concern]!;
      ai.budgets[concern] = Object.fromEntries(
        RESOURCE_IDS.flatMap((resource) => {
          const kept = Math.min(account[resource] ?? 0, keep[resource] ?? 0);
          return kept > 0 ? [[resource, kept]] : [];
        }),
      );
    },
    issue: (command) => {
      if (
        spent.commands >= profile.commandsPerTick ||
        !isMissionCommand(command) ||
        !staysInView(command)
      )
        return false;
      const definition =
        command.kind === "place-actor" || command.kind === "train-unit"
          ? host.definitions.get(command.definitionId)
          : undefined;
      const debits =
        definition && view.economy()
          ? spend(costResource(definition), costAmount(definition))
          : [];
      if (!debits) return false;
      host.submit(command, { owner, concern, debits });
      spent.commands += 1;
      return true;
    },
    newActorId: (definitionId) =>
      `${idPrefix}${definitionId}:${ai.nextActorNumber++}`,
    claimed,
    claim: (actorId) => {
      if (!forces.fielded.has(actorId)) return false;
      const holder = held(actorId);
      if (holder === concern) return true;
      if (allocation.essential) {
        const rival = allocations.find((entry) => entry.concern === holder);
        if (rival?.essential) return false;
      } else {
        if (
          holder !== undefined ||
          claimed().length >= forces.quotas.get(concern)!
        )
          return false;
      }
      ai.claims = { ...ai.claims, [actorId]: concern };
      return true;
    },
    release: (actorId) => {
      if (held(actorId) === concern) delete ai.claims[actorId];
    },
    requestPosture: (posture) => {
      if (!isOneOf(AI_POSTURES, posture) || !hasOwn(profile.postures, posture))
        return false;
      ai.requestedPosture ??= posture;
      return true;
    },
  };
}

/**
 * Runs each owner's due concerns against committed state, within its counted
 * limits. Returns `ai` unchanged when no owner has work this tick.
 */
export function advanceDirector(
  ai: AiState,
  controllers: readonly AiController[],
  tick: number,
  host: DirectorHost,
): AiState {
  let next = ai;
  for (const { owner, profile } of controllers) {
    const saved = ai[owner]!;
    if (saved.cursor === undefined && tick < saved.nextRoundTick) continue;
    const working = structuredClone(saved);
    const view = host.viewOf(owner);
    if (working.cursor === undefined)
      beginRound(working, profile, tick, host.tickSeconds);
    const allocations = profile.postures[working.posture]!;
    reconcileBudgets(working, allocations, view);
    const forces = reconcileClaims(
      working,
      allocations,
      view,
      host.definitions,
    );
    const spent = { commands: 0 };
    for (
      let turns = 0;
      turns < profile.concernsPerTick && working.cursor! < allocations.length;
      turns += 1
    ) {
      const index = working.cursor!;
      const context = concernContext(working, profile, index, {
        view,
        tick,
        host,
        spent,
        forces,
      });
      host.concerns.get(allocations[index]!.concern)!(context);
      if (!isJson(context.memory))
        throw new RangeError(
          `AI concern ${allocations[index]!.concern} memory must stay JSON.`,
        );
      working.cursor = index + 1;
    }
    if (working.cursor! >= allocations.length) delete working.cursor;
    next = { ...next, [owner]: working };
  }
  return next;
}

/** Saves refused commands for their concerns' next turns. */
export function recordAiRejections(
  ai: AiState,
  rejected: readonly (AiRejection & AiCommandSource)[],
): AiState {
  const next = structuredClone(ai);
  for (const { owner, debits, ...rejection } of rejected) {
    const state = next[owner]!;
    state.rejections.push(rejection);
    for (const { concern, resource, amount } of debits)
      state.budgets[concern]![resource] =
        (state.budgets[concern]![resource] ?? 0) + amount;
  }
  return next;
}
