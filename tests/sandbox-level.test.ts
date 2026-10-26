import { expect, test, vi } from "vitest";
import { createSandboxLevel } from "../scripts/levels/sandbox-level";
import { loadMission } from "../src/mission-loading";
import { SIMULATION_TICK_SECONDS } from "../src/simulation/clock";
import { serializeMission } from "../src/simulation/mission-file";
import { BASE_CONTENT } from "./helpers/content";

vi.mock("../scripts/levels/m0", () => {
  throw new Error("Sandbox authoring loaded the M0 mission.");
});
vi.mock("../scripts/levels/m0-terrain", () => {
  throw new Error("The sandbox template loaded another level's terrain.");
});

const options = {
  id: "scouting-sandbox",
  terrain: { width: 4, height: 4, tileSize: 1 },
  briefing: {
    label: "Scouting",
    title: "Scouting sandbox",
    description: "Practice scouting.",
    goalsHeading: "Explore",
    goalsNote: "Free training.",
  },
};

test("sandbox content can limit available actors without changing the template", () => {
  const actors = ["arc-scout"];
  const level = createSandboxLevel({ ...options, actors });
  actors.push("wolf");
  const loaded = loadMission(
    serializeMission(level.scenario, level.state, SIMULATION_TICK_SECONDS),
  );
  expect(loaded.definitions.map(({ id }) => id)).toEqual(["arc-scout"]);
  expect(loaded.state.actors).toEqual([]);
  expect(loaded.state.economy).toBeUndefined();
  expect(loaded.state.fog).toBeUndefined();
});

test("sandbox content references pass through the normal pack validation", () => {
  const level = createSandboxLevel({
    ...options,
    content: { id: BASE_CONTENT.id, version: BASE_CONTENT.version + 1 },
  });
  expect(() =>
    loadMission(
      serializeMission(level.scenario, level.state, SIMULATION_TICK_SECONDS),
    ),
  ).toThrow(/version/);
});
