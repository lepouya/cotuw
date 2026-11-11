import { expect, test } from "vitest";

import {
  activityTracker,
  disruptionTracker,
  matchAudit,
} from "../scripts/ai-match/observers";
import { createActor } from "../src/simulation/actor";
import { createAiState } from "../src/simulation/director";

import type { AiState } from "../src/simulation/director";
import type { MissionSimulation } from "../src/simulation/mission";

test("the audit allows a lost unit's claim until a later round begins", () => {
  const ai = createAiState([{ owner: "west" }]);
  ai.west!.claims.lost = "offense";
  ai.west!.nextRoundTick = 30;
  const simulation = {
    tickSeconds: 0.1,
    actors: [],
    ai,
    viewOf: () => ({ economy: () => undefined }),
  } as unknown as MissionSimulation;
  const audit = matchAudit(simulation);
  // Checks fall on whole simulation seconds; the round is still ahead.
  audit.observe(0);
  audit.observe(9);
  audit.observe(10);
  expect(audit.problems()).toEqual([]);
  ai.west!.nextRoundTick = 60;
  audit.observe(30);
  expect(audit.problems()).toEqual([
    "west offense keeps a claim on a lost unit",
  ]);
});

test("disruptions track prototype-named definitions and resume boundaries", () => {
  const actor = createActor({
    id: "building",
    owner: "west",
    definitionId: "__proto__",
    worldPosition: { x: 0, z: 0 },
  });
  const actors = [actor];
  const simulation = {
    completedTicks: 10,
    tickSeconds: 0.1,
    owners: [{ id: "west" }],
    actors,
    submitCommand: () => {},
  } as unknown as MissionSimulation;
  const disruption = {
    minutes: 1 / 60,
    owner: "west",
    definitionIds: ["__proto__"],
  };
  const tracker = disruptionTracker(simulation, [disruption]);
  tracker.apply();
  actors.length = 0;
  tracker.observe(11);
  expect(tracker.results()).toMatchObject([{ removed: 1, restoredTicks: {} }]);
  actors.push(actor);
  tracker.observe(12);
  expect(tracker.results()).toMatchObject([
    { removed: 1, restoredTicks: { ["__proto__"]: 12 } },
  ]);
  expect(
    disruptionTracker(simulation, [{ ...disruption, minutes: 0 }]).results(),
  ).toEqual([]);
});

test("a defense redirected after it ended counts as another launch", () => {
  const tracker = activityTracker();
  const defense = (outcome?: string) =>
    ({
      west: {
        ...createAiState([{ owner: "west" }]).west!,
        memory: {
          defense: {
            operations: [
              {
                id: "defense",
                kind: "defend",
                phase: outcome ? "return" : "advance",
                target: { x: 0, z: 0 },
                rally: { x: 0, z: 0 },
                units: [],
                ...(outcome && { outcome }),
                progressTick: 0,
                retries: 0,
                regroups: 0,
              },
            ],
          },
        },
      },
    }) as AiState;
  tracker.observe(defense(), 0);
  tracker.observe(defense("completed"), 1);
  tracker.observe(defense(), 2);
  tracker.observe(defense("completed"), 3);
  expect(tracker.report("west")!.operations.defend).toEqual({
    launched: 2,
    firstLaunchTick: 0,
    firstAdvanceTick: 0,
    ended: { completed: 2 },
  });
});
