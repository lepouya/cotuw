import { expect, test } from "vitest";

import {
  NOT_REACHED,
  summarizeMatch,
  summaryLines,
} from "../src/match-summary";
import { createMatchMetrics } from "../src/simulation/match-metrics";

import type { MatchMetrics } from "../src/simulation/match-metrics";

const TICK = 1 / 60;

function metrics(): MatchMetrics {
  const base = createMatchMetrics(["west", "east"]);
  const [west, east] = base.owners;
  return {
    owners: [
      {
        ...west!,
        milestones: { firstIncome: 90 * 60, firstBaseAttack: 600 * 60 },
        gathered: { materials: 1250.4, lifebloom: 0 },
        spent: { materials: 900, lifebloom: 0 },
        unitsProduced: 12,
        peakArmy: 7,
        history: [
          { tick: 0, units: 0, buildings: 1, explored: 40, visible: 40 },
          { tick: 299, units: 2, buildings: 2, explored: 90, visible: 60 },
        ],
      },
      {
        ...east!,
        milestones: { firstIncome: 80 * 60 },
        gathered: { materials: 0, lifebloom: 640 },
        history: [
          { tick: 0, units: 0, buildings: 1, explored: 40, visible: 40 },
          { tick: 299, units: 3, buildings: 1, explored: 70, visible: 50 },
          { tick: 329, units: 1, buildings: 0, explored: 70, visible: 30 },
        ],
      },
    ],
  };
}

test("columns follow the requested owner order with exact milestone times", () => {
  const summary = summarizeMatch(
    metrics(),
    [
      { owner: "east", label: "You", color: "red" },
      { owner: "west", label: "Opponent" },
    ],
    TICK,
  );
  expect(summary.owners).toEqual([
    { label: "You", color: "red" },
    { label: "Opponent" },
  ]);
  const [milestones, totals] = summary.sections;
  expect(milestones!.rows[0]).toEqual({
    label: "First income",
    values: ["1:20", "1:30"],
  });
  expect(milestones!.rows[5]).toEqual({
    label: "First base attack",
    values: [NOT_REACHED, "10:00"],
  });
  expect(totals!.rows.slice(0, 2)).toEqual([
    {
      label: "Resources gathered",
      values: ["640 Lifebloom", "1,250 Materials"],
    },
    { label: "Resources spent", values: ["0", "900 Materials"] },
  ]);
  expect(totals!.rows[6]).toEqual({
    label: "Peak army size",
    values: ["0", "7"],
  });
  expect(summary.graphs.map(({ label }) => label)).toEqual([
    "Mobile units",
    "Completed buildings",
    "Explored tiles",
    "Visible tiles",
  ]);
  expect(summary.graphs[0]!.series[0]!.points).toEqual([
    [0, 0],
    [5, 3],
    [5.5, 1],
  ]);
  expect(summary.seconds).toBe(5.5);
});

test("text lines label each owner's value", () => {
  const lines = summaryLines(
    summarizeMatch(
      metrics(),
      [
        { owner: "west", label: "west (arc)" },
        { owner: "east", label: "east (circle)" },
      ],
      TICK,
    ),
  );
  expect(lines).toContain("Milestones:");
  expect(lines).toContain(
    "  First income: west (arc) 1:30; east (circle) 1:20",
  );
});

test("an owner without metrics is rejected", () => {
  expect(() =>
    summarizeMatch(metrics(), [{ owner: "north", label: "You" }], TICK),
  ).toThrow(RangeError);
});
