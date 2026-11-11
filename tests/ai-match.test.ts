import { expect, test, vi } from "vitest";

import {
  ARC_MIRROR_CASES,
  CASE_SETS,
  passed,
  playMatch,
  runMatch,
  skirmishCases,
} from "../scripts/ai-match/runner";
import * as observers from "../scripts/ai-match/observers";
import { skirmishChoiceError } from "../src/content/skirmish";
import {
  assembleSkirmish,
  loadMission,
  missionTerrain,
} from "../src/mission-loading";
import { createActor } from "../src/simulation/actor";
import { SIMULATION_TICK_SECONDS } from "../src/simulation/clock";
import { BUILT_IN_AI_CONCERNS } from "../src/simulation/ai-concerns";
import * as missionFiles from "../src/simulation/mission-file";
import { parseMission } from "../src/simulation/mission-file";
import { DIFFICULTIES } from "../src/simulation/mission-setup";
import { createScenarioMap } from "../src/simulation/scenario";

import type { MatchCase, MatchRun } from "../scripts/ai-match/runner";
import type { AiConcern } from "../src/simulation/director";

/** Drops counters observed only during this segment of the match. */
const withoutActivity = ({
  owners,
  audit: _,
  disruptions: __,
  ...report
}: MatchRun["report"]) => ({
  ...report,
  owners: owners.map(
    ({ postureTicks: _, operations: __, refused: ___, ...owner }) => owner,
  ),
});

/** Compares runs apart from what a resumed run counts from its start. */
const resumable = ({ report, preservedState }: MatchRun) => ({
  report: withoutActivity(report),
  preservedState,
});

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

test("a continuation compares complete mission state", () => {
  const matchCase = {
    ...shortCase("arc-mirror-west-normal"),
    resumeAtMinutes: SHORT / 2,
  };
  expect(runMatch(matchCase).report.continuation).toBe("matched");
  const parse = missionFiles.parseMission;
  const spy = vi
    .spyOn(missionFiles, "parseMission")
    .mockImplementation((...args) => {
      const saved = parse(...args);
      // Health is absent from the short run's metrics and AI diagnostics.
      if (saved.state.tick === 90) saved.state.actors[0]!.health = 1;
      return saved;
    });
  try {
    const run = runMatch(matchCase);
    expect(run.report.continuation).toBe("diverged");
    expect(parse(run.preservedState!, SIMULATION_TICK_SECONDS).state.tick).toBe(
      90,
    );
  } finally {
    spy.mockRestore();
  }
});

test("continuation keeps audit failures from the resumed run", () => {
  const audit = observers.matchAudit;
  let runs = 0;
  const spy = vi
    .spyOn(observers, "matchAudit")
    .mockImplementation((simulation) => {
      const observer = audit(simulation);
      const resumed = ++runs === 3;
      return {
        ...observer,
        problems: () => [
          ...observer.problems(),
          ...(resumed ? ["bad claim"] : []),
        ],
      };
    });
  try {
    const { report } = runMatch({
      ...shortCase("arc-mirror-west-normal"),
      resumeAtMinutes: SHORT / 2,
    });
    expect(report.continuation).toBe("matched");
    expect(report.audit).toEqual(["after load: bad claim"]);
  } finally {
    spy.mockRestore();
  }
});

test("a result before the checkpoint fails an unexercised continuation", () => {
  const concerns = new Map(BUILT_IN_AI_CONCERNS).set("recovery", (context) => {
    for (const actor of context.view.actors().own)
      context.issue({ kind: "sell-actor", actorId: actor.id });
  });
  const { report, preservedState } = runMatch(
    {
      ...shortCase("arc-mirror-west-normal"),
      resumeAtMinutes: SHORT / 2,
    },
    concerns,
  );
  expect(report.status).toBe("completed");
  expect(report.continuation).toBe("not reached");
  expect(passed(report)).toBe(false);
  expect(preservedState).toBeDefined();
});

test("a failed reload is reported without throwing away the checkpoint", () => {
  const parse = missionFiles.parseMission;
  const spy = vi
    .spyOn(missionFiles, "parseMission")
    .mockImplementation((...args) => {
      const saved = parse(...args);
      if (saved.state.tick === 90) throw new Error("bad checkpoint");
      return saved;
    });
  try {
    const { report, preservedState } = runMatch({
      ...shortCase("arc-mirror-west-normal"),
      resumeAtMinutes: SHORT / 2,
    });
    expect(report.continuation).toBe("diverged");
    expect(report.audit).toContain("save/load failed: bad checkpoint");
    expect(preservedState).toBeDefined();
  } finally {
    spy.mockRestore();
  }
});

test.each([0, -1, NaN, Infinity])(
  "rejects an invalid continuation checkpoint: %s",
  (resumeAtMinutes) => {
    expect(() =>
      runMatch({
        ...shortCase("arc-mirror-west-normal"),
        resumeAtMinutes,
      }),
    ).toThrow("Resume time must be positive");
  },
);

test.each([SHORT, SHORT * 2])(
  "a checkpoint at or past the cutoff is reported unreached: %s",
  (resumeAtMinutes) => {
    const { report, preservedState } = runMatch({
      ...shortCase("arc-mirror-west-normal"),
      resumeAtMinutes,
    });
    expect(report.continuation).toBe("not reached");
    expect(passed(report)).toBe(false);
    expect(preservedState).toBeDefined();
  },
);

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

test("a completed match does not pass recovery without replacing its losses", () => {
  const matchCase = shortCase("arc-mirror-west-normal");
  const mission = assembleSkirmish(matchCase.choice);
  for (const actor of mission.state.actors)
    if (actor.owner === "east")
      mission.state.commands.push({
        tick: 120,
        issuer: { owner: "east" },
        command: { kind: "sell-actor", actorId: actor.id },
      });
  const run = playMatch(matchCase.id, mission, {
    cutoffMinutes: SHORT,
    disruptions: [
      {
        minutes: 0.01,
        owner: "west",
        definitionIds: ["arc-command-center-prototype"],
      },
    ],
  });
  expect(run.report.status).toBe("completed");
  expect(run.report.disruptions).toMatchObject([
    { removed: 1, restoredTicks: {} },
  ]);
  expect(passed(run.report)).toBe(false);
  expect(run.preservedState).toBeDefined();
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
  expect(resumable(playMatch(matchCase.id, saved, options))).toEqual(
    resumable(playMatch(matchCase.id, mission, options)),
  );
  expect(
    resumable(
      playMatch(matchCase.id, saved, { cutoffMinutes: SHORT, aiConcerns }),
    ),
  ).toEqual(resumable(first));
});

test("reports count posture time and operations seen during the run", () => {
  const matchCase = shortCase("arc-mirror-west-normal");
  const mission = assembleSkirmish(matchCase.choice);
  const operation = (kind: string, phase: string, outcome?: string) => ({
    id: `${kind}:1`,
    kind,
    phase,
    target: { x: 0, z: 0 },
    rally: { x: 0, z: 0 },
    units: [],
    ...(outcome && { outcome }),
    progressTick: 0,
    retries: 0,
    regroups: 0,
  });
  // One operation per planning round: launch, advance, fail, then end.
  const steps = [
    [operation("raid", "assemble"), operation("defend", "advance")],
    [operation("raid", "advance")],
    [operation("raid", "return", "failed")],
    [],
  ];
  const script: AiConcern = (context) => {
    const turn = (context.memory.turn as number | undefined) ?? 0;
    context.memory.turn = turn + 1;
    context.memory.operations = steps[Math.min(turn, steps.length - 1)];
  };
  mission.content = {
    ...mission.content,
    aiProfiles: mission.content.aiProfiles!.map((profile) => ({
      ...profile,
      postures: {
        establishing: [{ concern: "script", budget: 1, forces: 1 }],
      },
    })),
  };
  const { report } = playMatch(matchCase.id, mission, {
    cutoffMinutes: SHORT * 2,
    aiConcerns: new Map([["script", script]]),
  });
  const [west, east] = report.owners;
  expect(west!.postureTicks).toEqual({ establishing: report.ticks });
  // Each owner's rounds start on its own tick: west at 0, east at 1.
  const round = 60;
  expect(west!.operations).toEqual({
    raid: {
      launched: 1,
      firstLaunchTick: 0,
      firstAdvanceTick: round,
      ended: { failed: 1 },
    },
    defend: {
      launched: 1,
      firstLaunchTick: 0,
      firstAdvanceTick: 0,
      ended: { disbanded: 1 },
    },
  });
  expect(east!.operations?.raid?.firstLaunchTick).toBe(1);
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
