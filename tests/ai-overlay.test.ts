import { expect, test } from "vitest";

import { createAiState } from "../src/simulation/director";
import { describeAi } from "../src/ui/ai-overlay";

import type { CommandOutcome } from "../src/simulation/command";
import type { AiOverlaySource } from "../src/ui/ai-overlay";

const sighting = (actorId: string, tick: number) => ({
  actorId,
  definitionId: "arc-trooper",
  owner: "west",
  worldPosition: { x: 10.4, z: 3.6 },
  tick,
});

function source(): Omit<AiOverlaySource, "observeTicks"> {
  const ai = createAiState([{ owner: "east" }]);
  Object.assign(ai.east!, {
    requestedPosture: "defending",
    cursor: 1,
    budgets: { economy: { materials: 12.25 }, army: {} },
    claims: { a: "army", b: "army", c: "economy" },
    rejections: [
      {
        concern: "economy",
        tick: 40,
        command: { kind: "move", actorId: "a", target: { x: 0, z: 0 } },
        reason: "unreachable",
      },
    ],
    memory: {
      economy: { note: "x".repeat(500) },
      army: {
        operations: [
          {
            id: "raid:1",
            kind: "raid",
            phase: "return",
            outcome: "failed",
            target: { x: 20.6, z: 4.2 },
            rally: { x: 0, z: 0 },
            units: ["a", "b"],
            progressTick: 900,
            retries: 0,
            regroups: 0,
          },
        ],
      },
    },
  });
  const observations = {
    actors: [sighting("old", 100), sighting("new", 550)],
    sites: [],
    loot: [],
  };
  return {
    ai,
    completedTicks: 1000,
    tickSeconds: 0.1,
    viewOf: () => ({ knowledge: { observations } }) as never,
  };
}

test("the AI overlay describes strategy, commands, and memory", () => {
  const refused = {
    tick: 990,
    command: { kind: "train-unit" },
    accepted: false,
    reason: "insufficient-resources",
    issuer: { owner: "east", ai: true },
  } as unknown as CommandOutcome;
  const sections = Object.fromEntries(
    describeAi(source(), "east", [refused]).map(({ title, lines }) => [
      title,
      lines,
    ]),
  );
  expect(sections.Strategy).toEqual([
    "posture establishing → defending",
    "round in progress, concern 2",
    "tick 1000",
  ]);
  expect(sections.Budgets).toEqual(["economy: materials 12.3", "army: empty"]);
  expect(sections.Forces).toEqual(["army: 2 claimed", "economy: 1 claimed"]);
  expect(sections.Operations).toEqual([
    "army raid:1: return (failed), 2 units → 21,4",
  ]);
  expect(sections.Commands).toEqual([
    "990 train-unit refused (insufficient-resources)",
  ]);
  expect(sections["Waiting refusals"]).toEqual([
    "economy: move at 40 (unreachable)",
  ]);
  expect(sections.Memory![0]).toMatch(/^economy: \{"note":"x+…$/);
  expect(sections.Memory![0]!.length).toBeLessThan(420);
  expect(sections.Observations).toEqual([
    "2 actors, 0 sites, 0 loot",
    "arc-trooper (west) at 10,4, 0:45 ago",
    "arc-trooper (west) at 10,4, 1:30 ago",
  ]);
});

test("owners without AI have nothing to describe", () => {
  expect(describeAi(source(), "west")).toEqual([]);
});
