import { expect, test } from "vitest";

import { missionEnded } from "../src/simulation/mission-result";
import { presentResult } from "../src/ui/mission-result";
import { productionBlocker } from "../src/ui/production-action";

import type { MissionResult } from "../src/simulation/mission-result";

const campaignVictory: MissionResult = { kind: "victory", tick: 1 };
const campaignDefeat: MissionResult = {
  kind: "defeat",
  objectiveId: "hold",
  tick: 1,
};
const verdicts = (["victory", "defeat", "draw"] as const).map(
  (kind): MissionResult => ({ kind, tick: 1, eliminatedOwners: ["rival"] }),
);
const running = { faulted: false, paused: false, placing: false };

test("only campaign victories leave the mission running", () => {
  expect(missionEnded(undefined)).toBe(false);
  expect(missionEnded(campaignVictory)).toBe(false);
  expect(missionEnded(campaignDefeat)).toBe(true);
  for (const verdict of verdicts) expect(missionEnded(verdict)).toBe(true);
});

test("every ended result blocks orders; campaign victory continues", () => {
  expect(presentResult(campaignVictory).blocker).toBeUndefined();
  expect(presentResult(campaignVictory).continueLabel).toBeDefined();
  expect(
    productionBlocker({ ...running, result: campaignVictory }, "build"),
  ).toBe("");
  for (const result of [campaignDefeat, ...verdicts])
    expect(productionBlocker({ ...running, result }, "build")).toBe(
      presentResult(result).blocker,
    );
});

test("skirmish verdicts offer inspection without continued play", () => {
  for (const verdict of verdicts) {
    const { canInspect, continueLabel } = presentResult(verdict);
    expect(canInspect).toBe(true);
    expect(continueLabel).toBeUndefined();
  }
});

test("campaign defeats name the failed objective when it is known", () => {
  expect(presentResult(campaignDefeat, () => "Hold").description).toBe(
    "Objective failed: Hold. The mission is paused.",
  );
  expect(presentResult(campaignDefeat).description).toContain("mandatory");
});
