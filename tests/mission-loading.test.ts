import { expect, test, vi } from "vitest";

import { LEVEL_SOURCES } from "../src/content/levels";
import {
  createSessionSimulation,
  loadMission,
  missionIncompatibility,
} from "../src/mission-loading";

// Headless preparation must not initialize graphics or platform services.
vi.mock("@babylonjs/core", () => {
  throw new Error("Mission preparation loaded Babylon.");
});
vi.mock("../src/platform", () => {
  throw new Error("Mission preparation loaded platform services.");
});
vi.mock("../src/session", () => {
  throw new Error("Mission preparation loaded a rendered session.");
});

test.each([...LEVEL_SOURCES])(
  "prepares and advances %s headlessly",
  (_, source) => {
    const mission = loadMission(source);
    const simulation = createSessionSimulation(mission);
    try {
      simulation.tick();
      expect(simulation.completedTicks).toBe(mission.state.tick + 1);
      expect(simulation.snapshot().terrain).toEqual(mission.state.terrain);
    } finally {
      simulation.dispose();
    }
  },
);

test("explains why this build cannot load a stored mission", () => {
  const level = () => JSON.parse(LEVEL_SOURCES.get("arc-economy-opening")!);
  expect(missionIncompatibility(level())).toBeUndefined();
  const changes: [string, (file: any) => void][] = [
    ["not a mission file", (file) => (file.format = "other")],
    ["uses version 1;", (file) => (file.version = 1)],
    ["runs at 30 ticks per second", (file) => (file.ticksPerSecond = 30)],
    [
      "content pack base version 0;",
      (file) => (file.scenario.content.version = 0),
    ],
    [
      'no content pack named "lost"',
      (file) => (file.scenario.content.id = "lost"),
    ],
  ];
  for (const [reason, change] of changes) {
    const file = level();
    change(file);
    expect(missionIncompatibility(file)).toContain(reason);
    expect(() => loadMission(JSON.stringify(file))).toThrow(reason);
  }
  expect(missionIncompatibility(null)).toContain("not a mission file");
});
