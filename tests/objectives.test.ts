import { expect, test } from "vitest";
import {
  createObjectiveStates,
  evaluateObjectives,
  recordObjectiveDestruction,
  validateObjectives,
} from "../src/simulation/objectives";
import type { ObjectiveDefinition } from "../src/simulation/objectives";

const objectives: readonly ObjectiveDefinition[] = [
  {
    id: "clear",
    kind: "destroy",
    label: "Clear the outpost",
    directive: "Destroy both guards.",
    actorIds: ["guard-a", "guard-b"],
  },
  {
    id: "protect",
    kind: "protect",
    label: "Protect the convoy",
    directive: "Keep both vehicles alive.",
    actorIds: ["truck-a", "truck-b"],
  },
];
const actorIds = new Set(objectives.flatMap(({ actorIds }) => actorIds));

test("reordered definitions and saved states retain keyed progress", () => {
  const states = createObjectiveStates(objectives).reverse();
  recordObjectiveDestruction(objectives, states, "guard-a", 2);
  validateObjectives(
    [...objectives].reverse(),
    states,
    new Set([...actorIds].filter((id) => id !== "guard-a")),
    new Set(["guard-a"]),
    3,
  );
  expect(evaluateObjectives(objectives, states).views[0].progress).toEqual({
    current: 1,
    total: 2,
  });
  expect(evaluateObjectives(objectives, states).result).toBeUndefined();
  recordObjectiveDestruction(objectives, states, "guard-b", 7);
  expect(evaluateObjectives(objectives, states).result).toEqual({
    kind: "victory",
    tick: 7,
  });
});

test("duplicate combat notifications cannot inflate progress or change resolution", () => {
  const states = createObjectiveStates(objectives);
  for (const tick of [2, 5]) {
    recordObjectiveDestruction(objectives, states, "guard-a", tick);
    recordObjectiveDestruction(objectives, states, "truck-a", tick);
  }
  recordObjectiveDestruction(objectives, states, "truck-b", 8);
  expect(states[0].destroyedActorIds).toEqual(["guard-a"]);
  expect(states[1].resolvedTick).toBe(2);
  expect(evaluateObjectives(objectives, states).result).toEqual({
    kind: "defeat",
    objectiveId: "protect",
    tick: 2,
  });
});

test("protection alone never grants victory", () => {
  const protection = objectives.filter(({ kind }) => kind === "protect");
  expect(
    evaluateObjectives(protection, createObjectiveStates(protection)).result,
  ).toBeUndefined();
  expect(evaluateObjectives([], []).result).toBeUndefined();
});

test("failure priority is stable across authored order and simultaneous victory", () => {
  const rules = [...objectives, { ...objectives[1], id: "a-protect" }];
  const states = createObjectiveStates(rules);
  for (const actorId of actorIds)
    recordObjectiveDestruction(rules, states, actorId, 4);
  for (const definitions of [rules, [...rules].reverse()])
    expect(evaluateObjectives(definitions, states).result).toEqual({
      kind: "defeat",
      objectiveId: "a-protect",
      tick: 4,
    });
  states[1].resolvedTick = 3;
  expect(evaluateObjectives(rules, states).result).toEqual({
    kind: "defeat",
    objectiveId: "protect",
    tick: 3,
  });
});

test.each(["rule", "target", "duplicate target", "duplicate ID"])(
  "rejects saved objective contract changes: %s",
  (change) => {
    const states = createObjectiveStates(objectives);
    if (change === "rule") states[0].kind = "protect";
    if (change === "target") states[0].actorIds[0] = "truck-a";
    if (change === "duplicate target") states[0].actorIds[0] = "guard-b";
    if (change === "duplicate ID") states[0].id = states[1].id;
    expect(() =>
      validateObjectives(objectives, states, actorIds, new Set(), 0),
    ).toThrow(/incompatible objective/);
  },
);

test("rejects credited targets that are still alive", () => {
  const states = createObjectiveStates(objectives);
  recordObjectiveDestruction(objectives, states, "guard-a", 0);
  expect(() =>
    validateObjectives(objectives, states, actorIds, new Set(["guard-a"]), 1),
  ).toThrow(/invalid objective progress/);
});

test("malformed authored targets report an invalid definition", () => {
  const invalid = [
    { ...objectives[0], actorIds: null },
  ] as unknown as readonly ObjectiveDefinition[];
  expect(() =>
    validateObjectives(
      invalid,
      createObjectiveStates([objectives[0]]),
      actorIds,
      new Set(),
      0,
    ),
  ).toThrow(/invalid objective definition/);
});
