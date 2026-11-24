// Match summary definitions shared by the results panel and headless reports.
import { formatElapsed } from "./format-time";
import { RESOURCE_IDS, resourceName } from "./simulation/resources";

import type { DeepReadonly } from "./simulation/actor";
import type {
  MatchMetrics,
  MatchSample,
  OwnerMetrics,
} from "./simulation/match-metrics";

export const NOT_REACHED = "Not reached";

const MILESTONES = [
  ["firstIncome", "First income"],
  ["militaryReady", "Military production ready"],
  ["firstCombatUnit", "First combat unit"],
  ["firstExpansion", "First expansion income"],
  ["firstEngagement", "First engagement"],
  ["firstBaseAttack", "First base attack"],
] as const;

type Metrics = DeepReadonly<OwnerMetrics>;

const resources = (totals: Metrics["gathered"]) => {
  const parts = RESOURCE_IDS.filter((id) => totals[id] > 0).map(
    (id) =>
      `${Math.floor(totals[id]).toLocaleString("en-US")} ${resourceName(id)}`,
  );
  return parts.length ? parts.join(", ") : "0";
};

const TOTALS: readonly (readonly [string, (owner: Metrics) => string])[] = [
  ["Resources gathered", (owner) => resources(owner.gathered)],
  ["Resources spent", (owner) => resources(owner.spent)],
  ["Units produced", (owner) => String(owner.unitsProduced)],
  ["Buildings completed", (owner) => String(owner.buildingsCompleted)],
  ["Units lost", (owner) => String(owner.unitsLost)],
  ["Buildings lost", (owner) => String(owner.buildingsLost)],
  ["Peak army size", (owner) => String(owner.peakArmy)],
];

const GRAPHS = [
  ["units", "Mobile units"],
  ["buildings", "Completed buildings"],
  ["explored", "Explored tiles"],
  ["visible", "Visible tiles"],
] as const satisfies readonly (readonly [keyof MatchSample, string])[];

export type SummaryRow = { label: string; values: string[] };
export type SummarySection = { heading: string; rows: SummaryRow[] };
/** One owner's samples as simulation seconds and values. */
export type SummarySeries = { points: (readonly [number, number])[] };
export type SummaryGraph = { label: string; series: SummarySeries[] };
type SummaryOwner = { label: string; color?: string };
export type MatchSummary = {
  /** Column labels, in the order every row's values use. */
  owners: SummaryOwner[];
  sections: SummarySection[];
  graphs: SummaryGraph[];
  /** The last sample's time, which every graph shares. */
  seconds: number;
};

/**
 * Summarizes owners in the given order, which the caller chooses so the
 * player's column leads.
 */
export function summarizeMatch(
  metrics: DeepReadonly<MatchMetrics>,
  owners: readonly (SummaryOwner & { owner: string })[],
  tickSeconds: number,
): MatchSummary {
  const columns = owners.map(({ owner }) => {
    const found = metrics.owners.find((entry) => entry.owner === owner);
    if (!found) throw new RangeError(`Match has no metrics for ${owner}.`);
    return found;
  });
  const time = (tick: number | undefined) =>
    tick === undefined ? NOT_REACHED : formatElapsed(tick * tickSeconds);
  // The initial sample precedes tick 0. Later samples follow their tick.
  const sampleSeconds = ({ tick }: Pick<MatchSample, "tick">, index: number) =>
    index === 0 ? 0 : (tick + 1) * tickSeconds;
  return {
    owners: owners.map(({ label, color }) => ({ label, color })),
    sections: [
      {
        heading: "Milestones",
        rows: MILESTONES.map(([key, label]) => ({
          label,
          values: columns.map((owner) => time(owner.milestones[key])),
        })),
      },
      {
        heading: "Totals and peaks",
        rows: TOTALS.map(([label, value]) => ({
          label,
          values: columns.map(value),
        })),
      },
    ],
    graphs: GRAPHS.map(([key, label]) => ({
      label,
      series: columns.map(({ history }) => ({
        points: history.map(
          (sample, index) =>
            [sampleSeconds(sample, index), sample[key]] as const,
        ),
      })),
    })),
    seconds: Math.max(
      0,
      ...columns.map(({ history }) => {
        const index = history.length - 1;
        const last = history[index];
        return last ? sampleSeconds(last, index) : 0;
      }),
    ),
  };
}

/** Plain-text summary lines for headless and playtest reports. */
export const summaryLines = ({ owners, sections }: MatchSummary) =>
  sections.flatMap(({ heading, rows }) => [
    `${heading}:`,
    ...rows.map(
      ({ label, values }) =>
        `  ${label}: ${values.map((value, index) => `${owners[index]!.label} ${value}`).join("; ")}`,
    ),
  ]);
