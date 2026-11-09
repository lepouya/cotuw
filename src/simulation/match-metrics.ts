import { deepFreeze, isArmyUnit, trainsArmy } from "./actor";
import type { Actor, ActorDefinition } from "./actor";
import type { CargoSource } from "./cargo";
import { secondsToTicks } from "./clock";
import { costResource, RESOURCE_IDS } from "./resources";
import type { Resource } from "./resources";
import type { SkirmishResult, SkirmishRules } from "./skirmish";
import { depositedBy } from "./stockpiles";
import type { EconomyView } from "./economy";
import { disconnectedBuildings } from "./support";
import type { SupportView } from "./support";
import { hasOwn, isCount, isRecord } from "./validation";
import type { FogState } from "./vision";

const SAMPLE_SECONDS = 5;
/** Only histories recursively frozen here can be reused without walking them. */
const frozenHistories = new WeakSet<MatchSample[]>();
const MILESTONES = [
  "firstIncome",
  "militaryReady",
  "firstCombatUnit",
  "firstExpansion",
  "firstEngagement",
  "firstBaseAttack",
] as const;
const COUNTERS = [
  "unitsProduced",
  "buildingsCompleted",
  "unitsLost",
  "buildingsLost",
  "peakArmy",
] as const;
const SAMPLE_COUNTS = ["units", "buildings", "explored", "visible"] as const;

/** Exact ticks; an absent milestone was not reached. */
export type MatchMilestones = Partial<
  Record<(typeof MILESTONES)[number], number>
>;
export type MatchSample = { tick: number } & Record<
  (typeof SAMPLE_COUNTS)[number],
  number
>;
export type OwnerMetrics = {
  owner: string;
  milestones: MatchMilestones;
  gathered: Record<Resource, number>;
  spent: Record<Resource, number>;
  history: MatchSample[];
} & Record<(typeof COUNTERS)[number], number>;
export type MatchMetrics = { owners: OwnerMetrics[] };

/** The fixed rules a match records under. */
export type MatchContext = {
  rules: SkirmishRules;
  definitions: ReadonlyMap<string, ActorDefinition>;
  tickSeconds: number;
};
/** The committed world a checkpoint reads. */
export type MatchView = {
  actors: readonly Actor[];
  support: SupportView | undefined;
  coverage: (owner: string) => { explored: number; visible: number };
};
export type MatchRecorder = ReturnType<typeof recordMatch>;

function population(
  actors: readonly Actor[],
  owner: string,
  definitions: MatchContext["definitions"],
) {
  const counts = { units: 0, buildings: 0, army: 0 };
  for (const actor of actors) {
    if (actor.owner !== owner) continue;
    const definition = definitions.get(actor.definitionId)!;
    if (actor.tilePlacement) counts.buildings += Number(!actor.construction);
    else if (definition.movement) {
      counts.units += 1;
      counts.army += Number(isArmyUnit(definition));
    }
  }
  return counts;
}

const resourceTotals = () =>
  Object.fromEntries(RESOURCE_IDS.map((id) => [id, 0])) as Record<
    Resource,
    number
  >;

export const createMatchMetrics = (
  owners: readonly string[],
): MatchMetrics => ({
  owners: owners.map((owner) => ({
    owner,
    milestones: {},
    gathered: resourceTotals(),
    spent: resourceTotals(),
    unitsProduced: 0,
    buildingsCompleted: 0,
    unitsLost: 0,
    buildingsLost: 0,
    peakArmy: 0,
    history: [],
  })),
});

function freezeMetrics(metrics: MatchMetrics): MatchMetrics {
  for (const owner of metrics.owners) {
    if (!frozenHistories.has(owner.history)) {
      deepFreeze(owner.history);
      frozenHistories.add(owner.history);
    }
    for (const [key, value] of Object.entries(owner))
      if (key !== "history") deepFreeze(value);
    Object.freeze(owner);
  }
  Object.freeze(metrics.owners);
  return Object.freeze(metrics);
}

/**
 * Stages one tick over committed metrics, which stay untouched until `commit`
 * returns their replacement. Stages share immutable history samples.
 */
export function recordMatch(
  committed: MatchMetrics,
  { rules, definitions, tickSeconds }: MatchContext,
  tick: number,
) {
  const metrics: MatchMetrics = {
    owners: committed.owners.map((owner) => ({
      ...owner,
      milestones: { ...owner.milestones },
      gathered: { ...owner.gathered },
      spent: { ...owner.spent },
    })),
  };
  const byOwner = new Map(metrics.owners.map((value) => [value.owner, value]));
  const interval = secondsToTicks(SAMPLE_SECONDS, tickSeconds);
  return {
    income(
      owner: string,
      resource: Resource,
      amount: number,
      sources: readonly CargoSource[],
    ) {
      const values = byOwner.get(owner);
      if (!values || amount <= 0) return;
      values.gathered[resource] += amount;
      values.milestones.firstIncome ??= tick;
      const starting = rules.startingResourceSites[owner]!;
      if (sources.some(({ siteId }) => !starting.includes(siteId)))
        values.milestones.firstExpansion ??= tick;
    },
    /** A negative amount records a cancellation refund. */
    spend(owner: string, definition: ActorDefinition, amount: number) {
      const values = byOwner.get(owner);
      if (values) values.spent[costResource(definition)] += amount;
    },
    produced(actor: Actor, actors: readonly Actor[]) {
      const values = byOwner.get(actor.owner);
      if (!values) return;
      values.unitsProduced += 1;
      if (isArmyUnit(definitions.get(actor.definitionId)!)) {
        values.milestones.firstCombatUnit ??= tick;
        values.peakArmy = Math.max(
          values.peakArmy,
          population(actors, actor.owner, definitions).army,
        );
      }
    },
    completed(actor: Actor) {
      const values = byOwner.get(actor.owner);
      if (values) values.buildingsCompleted += 1;
    },
    lost(actor: Actor) {
      const values = byOwner.get(actor.owner);
      if (!values) return;
      if (actor.tilePlacement) values.buildingsLost += 1;
      else if (definitions.get(actor.definitionId)!.movement)
        values.unitsLost += 1;
    },
    hit(attacker: Actor, target: Actor, damage: number) {
      const dealt = byOwner.get(attacker.owner);
      const received = byOwner.get(target.owner);
      if (damage <= 0 || !dealt || !received || dealt === received) return;
      dealt.milestones.firstEngagement ??= tick;
      received.milestones.firstEngagement ??= tick;
      if (target.tilePlacement) dealt.milestones.firstBaseAttack ??= tick;
    },
    /** Freezes the tick's metrics; `sample` adds an unscheduled sample. */
    commit({ actors, support, coverage }: MatchView, sample = false) {
      const disconnected = disconnectedBuildings(support);
      for (const actor of actors)
        if (
          !actor.construction &&
          !disconnected.has(actor.id) &&
          trainsArmy(definitions.get(actor.definitionId)!, definitions)
        ) {
          const values = byOwner.get(actor.owner);
          if (values) values.milestones.militaryReady ??= tick;
        }
      const sampled = sample || (tick + 1) % interval === 0;
      for (const values of metrics.owners) {
        const { owner } = values;
        const { units, buildings, army } = population(
          actors,
          owner,
          definitions,
        );
        values.peakArmy = Math.max(values.peakArmy, army);
        if (sampled)
          values.history = [
            ...values.history,
            { tick, units, buildings, ...coverage(owner) },
          ];
      }
      return freezeMetrics(metrics);
    },
  };
}

/** Rejects malformed histories and totals inconsistent with the saved world. */
export function validateMatchMetrics(
  metrics: MatchMetrics | undefined,
  { rules, definitions, tickSeconds }: MatchContext,
  {
    completedTicks,
    tileCount,
    result,
    actors,
    economy,
    fog,
  }: {
    completedTicks: number;
    tileCount: number;
    result: SkirmishResult | undefined;
    actors: readonly Actor[];
    economy: EconomyView | undefined;
    fog: FogState | undefined;
  },
) {
  const invalid = () => {
    throw new RangeError("Mission has invalid match metrics.");
  };
  if (metrics === undefined) {
    if (
      completedTicks > 0 ||
      economy?.deposited.some((entry) => entry.amount > 0)
    )
      invalid();
    return;
  }
  if (
    !isRecord(metrics) ||
    !Array.isArray(metrics.owners) ||
    metrics.owners.length !== rules.owners.length
  )
    return invalid();
  const interval = secondsToTicks(SAMPLE_SECONDS, tickSeconds);
  const regularSamples = Math.floor(completedTicks / interval);
  const finalSample = !!result && (result.tick + 1) % interval !== 0;
  const sampleCount = 1 + regularSamples + Number(finalSample);
  const lastMatchesWorld =
    completedTicks === 0 || completedTicks % interval === 0 || !!result;
  for (const [index, owner] of metrics.owners.entries()) {
    if (
      !isRecord(owner) ||
      owner.owner !== rules.owners[index] ||
      !isRecord(owner.milestones) ||
      Object.entries(owner.milestones).some(
        ([name, tick]) =>
          !(MILESTONES as readonly string[]).includes(name) ||
          !isCount(tick) ||
          tick > Math.max(0, completedTicks - 1),
      ) ||
      COUNTERS.some((name) => !isCount(owner[name])) ||
      [owner.gathered, owner.spent].some(
        (values) =>
          !isRecord(values) ||
          Object.keys(values).length !== RESOURCE_IDS.length ||
          RESOURCE_IDS.some((id) => !isCount(values[id])),
      ) ||
      !Array.isArray(owner.history) ||
      owner.history.length !== sampleCount
    )
      return invalid();
    let explored = 0;
    for (const [i, sample] of owner.history.entries()) {
      let sampleTick = 0;
      if (i > 0)
        sampleTick = i <= regularSamples ? i * interval - 1 : result!.tick;
      if (
        !isRecord(sample) ||
        sample.tick !== sampleTick ||
        SAMPLE_COUNTS.some((name) => !isCount(sample[name])) ||
        sample.visible > sample.explored ||
        sample.explored > tileCount ||
        sample.explored < explored
      )
        return invalid();
      explored = sample.explored;
    }
    const { units, buildings, army } = population(
      actors,
      owner.owner,
      definitions,
    );
    const last = owner.history[owner.history.length - 1]!;
    const milestones = owner.milestones;
    const refundable = resourceTotals();
    for (const actor of actors)
      if (actor.owner === owner.owner && actor.construction)
        refundable[costResource(definitions.get(actor.definitionId)!)] +=
          actor.construction.paidCost;
    for (const job of economy?.production ?? [])
      if (
        actors.find((actor) => actor.id === job.producerId)!.owner ===
        owner.owner
      )
        refundable[costResource(definitions.get(job.definitionId)!)] +=
          job.paidCost;
    let knownTiles = tileCount;
    if (fog) {
      const exploredRows = hasOwn(fog.explored, owner.owner)
        ? fog.explored[owner.owner]!
        : "";
      knownTiles = 0;
      for (const bit of exploredRows) knownTiles += Number(bit === "1");
    }
    if (
      last.explored > knownTiles ||
      (lastMatchesWorld && last.explored !== knownTiles) ||
      owner.peakArmy < army ||
      RESOURCE_IDS.some((id) => owner.spent[id] < refundable[id]) ||
      (lastMatchesWorld &&
        (last.units !== units || last.buildings !== buildings)) ||
      RESOURCE_IDS.some(
        (id) =>
          owner.gathered[id] !==
          (economy ? depositedBy(economy, owner.owner, id) : 0),
      ) ||
      RESOURCE_IDS.some((id) => owner.gathered[id] > 0) !==
        (milestones.firstIncome !== undefined) ||
      (milestones.firstCombatUnit !== undefined && owner.unitsProduced === 0) ||
      (milestones.firstExpansion !== undefined &&
        (milestones.firstIncome === undefined ||
          milestones.firstExpansion < milestones.firstIncome)) ||
      (milestones.firstBaseAttack !== undefined &&
        (milestones.firstEngagement === undefined ||
          milestones.firstBaseAttack < milestones.firstEngagement))
    )
      return invalid();
  }
  if (
    metrics.owners[0]!.milestones.firstEngagement !==
    metrics.owners[1]!.milestones.firstEngagement
  )
    invalid();
}
