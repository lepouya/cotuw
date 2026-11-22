import { expect, test } from "vitest";

import {
  createCultivationSite,
  createCultivatorState,
} from "../src/simulation/cultivation";
import { createPopupTracker } from "../src/ui/popups";

import type { CultivationState } from "../src/simulation/cultivation";
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
  { id: "strain", title: "Strain", text: "", trigger: { kind: "site-strain" } },
];
const idle = {
  ownActors: () => [],
  cultivation: () => undefined,
  seesTile: () => false,
};

test("popups wait for their trigger and never return once dismissed", () => {
  let ownsHarvester = false;
  const tracker = createPopupTracker(popups, {
    ...idle,
    ownActors: () => (ownsHarvester ? [{ definitionId: "harvester" }] : []),
  });
  expect(tracker.next()).toBeUndefined();
  expect(tracker.next("barracks")).toBeUndefined();
  expect(tracker.next("refinery")?.id).toBe("network");
  ownsHarvester = true;
  expect(tracker.next()).toBeUndefined();
  tracker.dismiss("network");
  expect(tracker.next("refinery")?.id).toBe("harvester");
  tracker.dismiss("harvester");
  expect(tracker.next("refinery")).toBeUndefined();
});

test.each([false, true])(
  "site strain requires a visible, assigned site (dormant: %s)",
  (dormant) => {
    const site = createCultivationSite(
      "site",
      "Lifebloom",
      { x: 4, z: 5 },
      {
        capacity: 100,
        regeneration: 1,
        dormantBelow: 10,
        slowBelow: 60,
        recoverAt: 60,
      },
    );
    const worker = createCultivatorState("worker");
    const cultivation: CultivationState = { sites: [site], workers: [worker] };
    let visible = true;
    const tracker = createPopupTracker(popups, {
      ...idle,
      cultivation: () => cultivation,
      seesTile: () => visible,
    });
    expect(tracker.next()).toBeUndefined();
    site.reserve = dormant ? site.dormantBelow : site.slowBelow - 1;
    site.dormant = dormant;
    expect(tracker.next()).toBeUndefined();
    visible = false;
    worker.siteId = site.id;
    expect(tracker.next()).toBeUndefined();
    visible = true;
    expect(tracker.next()?.id).toBe("strain");
    tracker.dismiss("strain");
    expect(tracker.next()).toBeUndefined();
  },
);

test("unknown dismissals are rejected and never reach a save", () => {
  const tracker = createPopupTracker(popups, idle);
  expect(() => tracker.dismiss("missing-guide")).toThrow(RangeError);
  expect(tracker.uiState()).toBeUndefined();
});

test("saves keep dismissals across a restore", () => {
  const tracker = createPopupTracker(popups, idle, {
    dismissedPopups: ["network"],
  });
  expect(tracker.next("refinery")).toBeUndefined();
  tracker.dismiss("harvester");
  expect(tracker.uiState()).toEqual({
    dismissedPopups: ["network", "harvester"],
  });
});
