import { expect, test } from "vitest";

import { createSaveRules } from "../src/save-policy";

import type { MissionFile, SavePolicy } from "../src/simulation/mission-file";
import type { ObjectiveView } from "../src/simulation/objectives";

const TICK_SECONDS = 1 / 60;
const FIVE_MINUTES = 5 * 60 * 60;

const rules = (savePolicy?: SavePolicy, tick = 0, save?: MissionFile["save"]) =>
  createSaveRules(
    {
      scenario: { id: "test", tileSize: 1, terrainTypeIds: [], savePolicy },
      state: { tick, objectives: [] },
      save,
    } as unknown as MissionFile,
    TICK_SECONDS,
  );

const objective = (id: string, status: ObjectiveView["status"]) =>
  ({ id, label: `Objective ${id}`, status }) as ObjectiveView;

test("only skirmishes permit saving after defeat; faults never save", () => {
  const defeat = { kind: "defeat", objectiveId: "hold", tick: 1 } as const;
  const victory = { kind: "victory", tick: 1 } as const;
  for (const policy of [undefined, "objectives"] as const) {
    const { canSave } = rules(policy);
    expect(canSave({ faulted: false })).toBe(true);
    expect(canSave({ faulted: false, result: victory })).toBe(true);
    expect(canSave({ faulted: false, result: defeat })).toBe(false);
    expect(canSave({ faulted: true })).toBe(false);
  }
  const { canSave } = rules("skirmish");
  for (const result of [undefined, victory, defeat])
    expect(canSave({ faulted: false, result })).toBe(true);
  expect(canSave({ faulted: true })).toBe(false);
});

test("skirmishes autosave at a fresh start and each five-minute boundary", () => {
  const skirmish = rules("skirmish");
  expect(skirmish.atStart()).toBe("Autosave: Match start");
  expect(skirmish.afterTick(1)).toBeUndefined();
  expect(skirmish.afterTick(FIVE_MINUTES - 1)).toBeUndefined();
  expect(skirmish.afterTick(FIVE_MINUTES)).toBe("Autosave: 5:00");
  expect(skirmish.afterTick(FIVE_MINUTES + 1)).toBeUndefined();
  expect(skirmish.afterTick(2 * FIVE_MINUTES)).toBe("Autosave: 10:00");
  expect(skirmish.onObjectives([objective("a", "complete")])).toBeUndefined();
});

test("a result tick keeps the previous skirmish autosave", () => {
  const skirmish = rules("skirmish");
  const victory = { kind: "victory", tick: FIVE_MINUTES } as const;
  expect(skirmish.afterTick(FIVE_MINUTES, victory)).toBeUndefined();
  expect(skirmish.afterTick(2 * FIVE_MINUTES, victory)).toBeUndefined();
});

test("loaded saves do not repeat the starting autosave", () => {
  const info = { name: "Opening", savedAt: "2026-10-04T10:00:00Z" };
  expect(rules("skirmish", 0, info).atStart()).toBeUndefined();
  expect(rules("skirmish", FIVE_MINUTES).atStart()).toBeUndefined();
});

test("objective missions autosave only on new completions", () => {
  const missionRules = rules();
  expect(missionRules.atStart()).toBeUndefined();
  expect(missionRules.afterTick(FIVE_MINUTES)).toBeUndefined();
  expect(missionRules.onObjectives([objective("a", "active")])).toBeUndefined();
  const both = [objective("a", "complete"), objective("b", "complete")];
  expect(missionRules.onObjectives(both)).toBe("Autosave: Objective b");
  expect(missionRules.onObjectives(both)).toBeUndefined();
});
