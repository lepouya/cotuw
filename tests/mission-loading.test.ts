import { expect, test, vi } from "vitest";

import { LEVEL_SOURCES } from "../src/content/levels";
import { createSessionSimulation, loadMission } from "../src/mission-loading";

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
