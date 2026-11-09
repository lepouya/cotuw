import { expect, test } from "vitest";

import { createPopupTracker } from "../src/ui/popups";

import type { ScenarioPopup } from "../src/simulation/mission-file";

const popups: ScenarioPopup[] = [
  {
    id: "network",
    title: "Network",
    text: "",
    trigger: { kind: "placement", definitionId: "refinery" },
  },
  {
    id: "harvester",
    title: "Harvester",
    text: "",
    trigger: { kind: "actor", definitionId: "harvester" },
  },
];

test("popups wait for their trigger and never return once dismissed", () => {
  const tracker = createPopupTracker(popups);
  const none = () => false;
  expect(tracker.due({ owns: none })).toBeUndefined();
  expect(tracker.due({ placing: "barracks", owns: none })).toBeUndefined();
  expect(tracker.due({ placing: "refinery", owns: none })?.id).toBe("network");
  const current = {
    placing: "refinery",
    owns: (id: string) => id === "harvester",
  };
  tracker.dismiss("network");
  expect(tracker.due(current)?.id).toBe("harvester");
  tracker.dismiss("harvester");
  expect(tracker.due(current)).toBeUndefined();
});

test("unknown dismissals are rejected and never reach a save", () => {
  const tracker = createPopupTracker(popups);
  expect(() => tracker.dismiss("missing-guide")).toThrow(RangeError);
  expect(tracker.uiState()).toBeUndefined();
});

test("saves keep dismissals across a restore", () => {
  const tracker = createPopupTracker(popups, {
    dismissedPopups: ["network"],
  });
  expect(tracker.due({ placing: "refinery", owns: () => false })).toBe(
    undefined,
  );
  tracker.dismiss("harvester");
  expect(tracker.uiState()).toEqual({
    dismissedPopups: ["network", "harvester"],
  });
});
