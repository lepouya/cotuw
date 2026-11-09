import { expect, test } from "vitest";

import {
  ARC_MIRROR_CASES,
  CASE_SETS,
  playMatch,
  runMatch,
  skirmishCases,
} from "../scripts/ai-match/runner";
import { skirmishChoiceError } from "../src/content/skirmish";
import {
  assembleSkirmish,
  loadMission,
  missionTerrain,
} from "../src/mission-loading";
import { createActor } from "../src/simulation/actor";
import { SIMULATION_TICK_SECONDS } from "../src/simulation/clock";
import { parseMission } from "../src/simulation/mission-file";
import { DIFFICULTIES } from "../src/simulation/mission-setup";
import { createScenarioMap } from "../src/simulation/scenario";

import type { MatchCase } from "../scripts/ai-match/runner";
import type { AiConcern } from "../src/simulation/director";

// Three simulation seconds keeps each case short.
const SHORT = 0.05;
const shortCase = (id: string): MatchCase => ({
  ...ARC_MIRROR_CASES.find((matchCase) => matchCase.id === id)!,
  cutoffMinutes: SHORT,
});

test("ARC mirror cases cover both player slots at every difficulty", () => {
  expect(ARC_MIRROR_CASES.map(({ id }) => id)).toEqual([
    "arc-mirror-west-easy",
    "arc-mirror-west-normal",
    "arc-mirror-west-hard",
    "arc-mirror-east-easy",
    "arc-mirror-east-normal",
    "arc-mirror-east-hard",
  ]);
  for (const { choice } of ARC_MIRROR_CASES)
    expect(skirmishChoiceError(choice)).toBeUndefined();
  const ids = [...CASE_SETS.values()].flatMap((cases) =>
    cases.map(({ id }) => id),
  );
  expect(new Set(ids).size).toBe(ids.length);
});

test("case sets need a standard AI profile for every faction", () => {
  expect(() =>
    skirmishCases("arc-circle", { west: "arc", east: "circle" }),
  ).toThrow("Faction circle has no standard AI.");
});

test("an unfinished case stops at the cutoff with its state and diagnostics", () => {
  const { report, preservedState } = runMatch(
    shortCase("arc-mirror-east-hard"),
  );
  expect(report).toMatchObject({
    case: "arc-mirror-east-hard",
    factions: { west: "arc", east: "arc" },
    playerSlot: "east",
    difficulty: "hard",
    enemyScale: DIFFICULTIES.hard.scale,
    enemyOwners: ["west"],
    status: "incomplete",
    cutoffTicks: 180,
    ticks: 180,
    seconds: 3,
  });
  expect(report).not.toHaveProperty("result");
  expect(
    report.owners.map(({ owner, profileId, ai }) => [
      owner,
      profileId,
      ai?.posture,
    ]),
  ).toEqual([
    ["west", "arc-skirmish", "establishing"],
    ["east", "arc-skirmish", "establishing"],
  ]);
  expect(report.owners[0]!.latest?.tick).toBe(0);

  const saved = loadMission(preservedState!);
  expect(saved.state.tick).toBe(180);
  expect(saved.scenario.ai).toEqual(ARC_MIRROR_CASES[5]!.choice.ai);
});

test("a case reports the same outcome on every run", () => {
  const matchCase = shortCase("arc-mirror-west-normal");
  expect(runMatch(matchCase)).toEqual(runMatch(matchCase));
});

test("authored skirmishes report owner factions without launch setup", () => {
  const matchCase = shortCase("arc-mirror-west-normal");
  const mission = assembleSkirmish(matchCase.choice);
  const { report } = playMatch(
    matchCase.id,
    { ...mission, scenario: { ...mission.scenario, setup: undefined } },
    { cutoffMinutes: SHORT },
  );
  expect(report.factions).toEqual({ west: "arc", east: "arc" });
  expect(report.owners.map(({ faction }) => faction)).toEqual(["arc", "arc"]);
  expect(report.enemyScale).toBe(1);
});

test.each([
  0,
  -1,
  NaN,
  Infinity,
  -Infinity,
  Number.MAX_SAFE_INTEGER,
  Number.MAX_VALUE,
])("rejects an invalid cutoff: %s", (cutoffMinutes) => {
  expect(() =>
    runMatch({ ...shortCase("arc-mirror-west-normal"), cutoffMinutes }),
  ).toThrow("Match cutoff must be positive and fit safe ticks");
});

test("a result on the final allowed tick takes precedence over the cutoff", () => {
  const matchCase = shortCase("arc-mirror-west-normal");
  const mission = assembleSkirmish(matchCase.choice);
  for (const actor of mission.state.actors)
    mission.state.commands.push({
      tick: 179,
      issuer: { owner: actor.owner },
      command: { kind: "sell-actor", actorId: actor.id },
    });
  const { report, preservedState } = playMatch(matchCase.id, mission, {
    cutoffMinutes: SHORT,
  });
  expect(report).toMatchObject({
    status: "completed",
    ticks: 180,
    cutoffTicks: 180,
    result: { kind: "draw", tick: 179, eliminatedOwners: ["west", "east"] },
  });
  expect(preservedState).toBeUndefined();
});

test("diagnostics and saved continuation preserve active concerns", () => {
  const matchCase = shortCase("arc-mirror-west-normal");
  const mission = assembleSkirmish(matchCase.choice);
  const names = ["constructor", "__proto__", "patrol"];
  const map = createScenarioMap(missionTerrain(mission));
  mission.state.actors.push(
    ...names.map((_, index) =>
      createActor({
        id: `scout-${index}`,
        owner: "west",
        definitionId: "arc-scout",
        worldPosition: map.tileCenter(18 + index, 54),
      }),
    ),
  );
  mission.content = {
    ...mission.content,
    aiProfiles: mission.content.aiProfiles!.map((profile) => ({
      ...profile,
      postures: {
        establishing: names.map((concern) => ({
          concern,
          budget: 1,
          forces: 1,
        })),
      },
    })),
  };
  const patrol: AiConcern = (context) => {
    context.memory.turns = ((context.memory.turns as number) ?? 0) + 1;
    for (const actor of context.view.actors().ownMobile)
      context.claim(actor.id);
    for (const actorId of context.claimed())
      context.issue({ kind: "sell-actor", actorId });
  };
  const aiConcerns = new Map(names.map((name) => [name, patrol]));
  const first = playMatch(matchCase.id, mission, {
    cutoffMinutes: SHORT,
    aiConcerns,
  });
  const diagnostics = first.report.owners[0]!.ai!;
  expect(diagnostics.claims).toEqual(
    Object.fromEntries(names.map((name) => [name, 1])),
  );
  expect(Object.keys(diagnostics.memory)).toEqual(names);
  expect(diagnostics.rejections).toHaveLength(3);
  expect(diagnostics.rejections.map(({ kind }) => kind)).toEqual(
    names.map(() => "sell-actor"),
  );

  const saved = {
    ...mission,
    ...parseMission(first.preservedState!, SIMULATION_TICK_SECONDS),
  };
  const options = { cutoffMinutes: SHORT * 2, aiConcerns };
  expect(playMatch(matchCase.id, saved, options)).toEqual(
    playMatch(matchCase.id, mission, options),
  );
  expect(
    playMatch(matchCase.id, saved, { cutoffMinutes: SHORT, aiConcerns }),
  ).toEqual(first);
});

test("a case ends at its result, with the concerns supplied", () => {
  const mission = assembleSkirmish({
    factions: { west: "arc", east: "arc" },
    playerSlot: "west",
    difficulty: "normal",
    ai: [{ owner: "west", profileId: "arc-skirmish" }],
  });
  const concede: AiConcern = (context) => {
    for (const actor of context.view.actors().shown)
      if (actor.owner === "west" && actor.tilePlacement)
        context.issue({ kind: "sell-actor", actorId: actor.id });
  };
  const profiles = mission.content.aiProfiles!.map((profile) => ({
    ...profile,
    postures: {
      establishing: [{ concern: "concede", budget: 1, forces: 1 }],
    },
  }));
  const { report, preservedState } = playMatch(
    "concede",
    { ...mission, content: { ...mission.content, aiProfiles: profiles } },
    { cutoffMinutes: SHORT, aiConcerns: new Map([["concede", concede]]) },
  );
  expect(report).toMatchObject({
    status: "completed",
    result: { kind: "defeat", eliminatedOwners: ["west"] },
  });
  if (report.status !== "completed") throw new Error(report.status);
  expect(report.ticks).toBe(report.result.tick + 1);
  expect(report.ticks).toBeLessThan(report.cutoffTicks);
  expect(report.owners.map(({ profileId }) => profileId)).toEqual([
    "arc-skirmish",
    undefined,
  ]);
  expect(report.owners[0]!.latest?.tick).toBe(report.result.tick);
  expect(preservedState).toBeUndefined();
});

test("a throwing tick reports a fault with the last committed state", () => {
  const matchCase = shortCase("arc-mirror-west-normal");
  const mission = assembleSkirmish(matchCase.choice);
  mission.content = {
    ...mission.content,
    aiProfiles: mission.content.aiProfiles!.map((profile) => ({
      ...profile,
      postures: {
        establishing: [{ concern: "fragile", budget: 1, forces: 1 }],
      },
    })),
  };
  const fragile: AiConcern = (context) => {
    context.memory.turns = ((context.memory.turns as number) ?? 0) + 1;
    if (context.tick >= 90) throw new Error("concern failed");
  };
  const { report, preservedState } = playMatch(matchCase.id, mission, {
    cutoffMinutes: SHORT,
    aiConcerns: new Map([["fragile", fragile]]),
  });
  expect(report).toMatchObject({
    status: "faulted",
    fault: "concern failed",
    ticks: 120,
  });
  expect(report.owners[0]!.ai!.memory).toEqual({ fragile: { turns: 2 } });
  // The test profile is not in the pack, so read the state without loading.
  expect(
    parseMission(preservedState!, SIMULATION_TICK_SECONDS).state.tick,
  ).toBe(120);
});
