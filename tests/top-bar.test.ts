import { expect, test } from "vitest";

import { formatElapsed, objectiveSummary } from "../src/ui/top-bar";

import type { ObjectiveView } from "../src/simulation/objectives";

const objectives: ObjectiveView[] = [
  {
    id: "protect",
    label: "Protect the Command Center",
    directive: "",
    status: "active",
  },
  {
    id: "lone-wolf",
    label: "Defeat the lone wolf",
    directive: "",
    status: "complete",
    progress: { current: 1, total: 1 },
  },
  {
    id: "den",
    label: "Clear the den",
    directive: "",
    status: "active",
    progress: { current: 2, total: 5 },
  },
];

test("the summary shows the first unfinished goal or the result", () => {
  expect(objectiveSummary(objectives)).toBe("Clear the den 2/5");
  expect(objectiveSummary(objectives.slice(0, 2))).toBe("");
  expect(objectiveSummary(objectives, { kind: "victory", tick: 1 })).toBe(
    "Victory · free play",
  );
  expect(
    objectiveSummary(objectives, {
      kind: "defeat",
      objectiveId: "protect",
      tick: 1,
    }),
  ).toBe("Mission failed");
});

test("elapsed time shows hours only when needed", () => {
  expect(formatElapsed(65.9)).toBe("1:05");
  expect(formatElapsed(3725)).toBe("1:02:05");
});
