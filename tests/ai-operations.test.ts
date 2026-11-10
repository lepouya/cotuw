import { expect, test } from "vitest";

import { BASE_CONTENT } from "./helpers/content";
import { createActor } from "../src/simulation/actor";
import {
  endOperation,
  launchOperation,
  operationsOf,
  reinforceOperation,
  stagingPoint,
  stepOperation,
  strengthOf,
} from "../src/simulation/ai-operations";
import { TerrainGrid } from "../src/simulation/terrain";

import type { Actor } from "../src/simulation/actor";
import type { MissionCommand } from "../src/simulation/command";
import type { AiConcernContext, AiRejection } from "../src/simulation/director";

const terrain = new TerrainGrid({
  width: 100,
  height: 100,
  tileSize: 1,
  terrainTypeIds: ["plain"],
});
const definitions = new Map(BASE_CONTENT.actors.map((d) => [d.id, d]));
const home = { x: 10, z: 10 };
const target = { x: 80, z: 80 };
const TICK_SECONDS = 0.1;

const trooper = (id: string, x: number, z: number, owner = "own") =>
  createActor({
    id,
    owner,
    definitionId: "arc-trooper",
    worldPosition: { x, z },
  });

function fixture(units: Actor[]) {
  const hostiles: Actor[] = [];
  const issued: MissionCommand[] = [];
  const released: string[] = [];
  const rejections: AiRejection[] = [];
  const lost = new Set<string>();
  let tick = 1000;
  const context = () =>
    ({
      tick,
      tickSeconds: TICK_SECONDS,
      definitions,
      rejections,
      claim: (id: string) => !lost.has(id),
      release: (id: string) => released.push(id),
      issue: (command: MissionCommand) => {
        issued.push(command);
        return true;
      },
      view: {
        ownMobileActor: (id: string) => units.find((unit) => unit.id === id),
        actors: () => ({ shown: hostiles }),
        relationTo: () => "hostile",
      },
    }) as unknown as AiConcernContext;
  const operation = launchOperation(context(), {
    id: "raid:1",
    kind: "raid",
    phase: "assemble",
    target,
    targetId: "enemy-refinery",
    rally: home,
    units: units.map(({ id }) => id),
  });
  return {
    operation,
    issued,
    released,
    rejections,
    hostiles,
    lost,
    context,
    step: (retreats = true) =>
      stepOperation(context(), terrain, operation, { retreats }),
    wait: (seconds: number) => {
      tick += Math.round(seconds / TICK_SECONDS);
    },
  };
}

const group = (count: number, x: number, z: number) =>
  Array.from({ length: count }, (_, index) =>
    trooper(`unit-${index}`, x + index, z),
  );

test("a gathered group sets out with its strength recorded", () => {
  const units = group(4, home.x, home.z);
  const { operation, issued, step } = fixture(units);
  expect(step()).toBeUndefined();
  expect(operation.phase).toBe("advance");
  expect(operation.strength).toBe(
    strengthOf({ definitions } as unknown as AiConcernContext, units),
  );
  expect(issued).toEqual([
    {
      kind: "group-attack-move",
      actorIds: units.map(({ id }) => id),
      target,
    },
  ]);
});

test("a scattered group gathers at its rally point first", () => {
  const units = [...group(3, home.x, home.z), trooper("late", 40, 40)];
  const { operation, issued, step } = fixture(units);
  step();
  expect(operation.phase).toBe("assemble");
  expect(issued).toEqual([
    {
      kind: "group-move",
      actorIds: ["late", "unit-0", "unit-1", "unit-2"].sort(),
      target: home,
    },
  ]);
});

test("an outmatched advance fails and the group disbands at home", () => {
  const units = group(2, home.x, home.z);
  const { operation, issued, released, hostiles, step } = fixture(units);
  step();
  for (const unit of units) unit.worldPosition = { x: 50, z: 50 };
  hostiles.push(...group(4, 52, 50).map((unit) => ({ ...unit, owner: "x" })));
  issued.length = 0;
  expect(step()).toBe("failed");
  expect(operation).toMatchObject({ phase: "return", outcome: "failed" });
  expect(issued).toEqual([
    { kind: "group-move", actorIds: ["unit-0", "unit-1"], target: home },
  ]);
  for (const unit of units) unit.worldPosition = { ...home };
  expect(step()).toBe("ended");
  expect(released).toEqual(["unit-0", "unit-1"]);
});

test("a depleted group stays only while it clearly wins", () => {
  const units = group(4, home.x, home.z);
  const { operation, hostiles, lost, step } = fixture(units);
  step();
  for (const id of ["unit-0", "unit-1", "unit-2"]) lost.add(id);
  expect(step()).toBeUndefined();
  // A lone remaining Trooper is not clearly ahead of a lone hostile.
  hostiles.push({ ...trooper("enemy", home.x + 2, home.z), owner: "x" });
  expect(step()).toBe("failed");
  expect(operation.units).toEqual(["unit-3"]);
  expect(step()).toBe("ended");
});

test("reinforcements follow the group's order without reissuing it", () => {
  const units = group(2, home.x, home.z);
  const { context, operation, issued, step } = fixture([
    ...units,
    trooper("new", home.x, home.z),
  ]);
  operation.units = ["unit-0", "unit-1"];
  step();
  issued.length = 0;
  reinforceOperation(context(), operation, ["new"]);
  expect(operation).toMatchObject({
    units: ["new", "unit-0", "unit-1"],
    issued: true,
  });
  expect(issued).toEqual([
    { kind: "group-attack-move", actorIds: ["new"], target },
  ]);
});

test("a stalled advance retries a bounded number of times", () => {
  const units = group(2, home.x, home.z);
  const { operation, issued, step, wait } = fixture(units);
  step();
  for (let retry = 1; retry <= 3; retry++) {
    issued.length = 0;
    wait(20);
    expect(step()).toBeUndefined();
    expect(operation.retries).toBe(retry);
    expect(issued.map(({ kind }) => kind)).toEqual(["group-attack-move"]);
  }
  wait(20);
  expect(step()).toBe("failed");
  expect(operation.phase).toBe("return");
});

test("progress and fighting hold off a stall", () => {
  const units = group(2, home.x, home.z);
  const { operation, context, step, wait } = fixture(units);
  step();
  wait(15);
  for (const unit of units) unit.worldPosition.x += 5;
  step();
  wait(15);
  units[0]!.combat = {
    attack: { targetId: "x" },
    activeTick: context().tick - 1,
  } as Actor["combat"];
  step();
  wait(15);
  step();
  expect(operation.retries).toBe(0);
});

test("an unreachable pursuit cannot suppress bounded stall retries", () => {
  const units = group(2, home.x, home.z);
  const { operation, context, step, wait } = fixture(units);
  step();
  units[0]!.combat = {
    activeTick: context().tick - 1,
    attack: {
      targetId: "unreachable",
      lastKnown: target,
      blocked: { at: target, navigationVersion: 0 },
    },
  };
  for (let retry = 0; retry < 3; retry++) {
    wait(20);
    step();
  }
  wait(20);
  expect(step()).toBe("failed");
  expect(operation).toMatchObject({ phase: "return", outcome: "failed" });
});

test("a refused group order is reissued and counted", () => {
  const units = group(2, home.x, home.z);
  const { operation, issued, rejections, step } = fixture(units);
  step();
  rejections.push({
    concern: "offense",
    tick: 0,
    command: { kind: "attack-move", actorId: "unit-0", target },
  });
  issued.length = 0;
  step();
  expect(operation.retries).toBe(1);
  expect(issued.map(({ kind }) => kind)).toEqual(["group-attack-move"]);
});

test("a strung-out advance regroups at its middle unit", () => {
  const units = [
    trooper("a", 20, 20),
    trooper("b", 22, 20),
    trooper("c", 60, 20),
  ];
  const { operation, step } = fixture(units);
  operation.phase = "advance";
  step();
  expect(operation).toMatchObject({
    phase: "assemble",
    rally: home,
    regroup: { x: 22, z: 20 },
    regroups: 1,
  });
});

test("a regrouped operation returns home before releasing survivors", () => {
  const units = [
    trooper("a", 20, 20),
    trooper("b", 22, 20),
    trooper("c", 60, 20),
  ];
  const { operation, context, step, issued, released } = fixture(units);
  operation.phase = "advance";
  step();
  expect(operation.regroup).toEqual({ x: 22, z: 20 });
  for (const unit of units) unit.worldPosition = { x: 22, z: 20 };
  step();
  expect(operation.phase).toBe("advance");
  expect(operation.regroup).toBeUndefined();
  endOperation(context(), operation, "completed");
  issued.length = 0;
  step();
  expect(released).toEqual([]);
  expect(issued).toEqual([
    { kind: "group-move", actorIds: ["a", "b", "c"], target: home },
  ]);
  for (const unit of units) unit.worldPosition = { ...home };
  expect(step()).toBe("ended");
});

test("ending during a regroup discards the temporary assembly point", () => {
  const { operation, context, step, issued } = fixture(group(2, 50, 50));
  operation.regroup = { x: 50, z: 50 };
  endOperation(context(), operation, "cancelled");
  expect(step()).toBeUndefined();
  expect(issued[0]).toMatchObject({ kind: "group-move", target: home });
});

test("staging uses an operational army producer rather than a worker rally", () => {
  const producer = (
    id: string,
    definitionId: string,
    rallyPoint: { x: number; z: number },
  ) => ({
    ...createActor({ id, definitionId, owner: "own", worldPosition: home }),
    tilePlacement: { origin: { x: 5, z: 5 }, quarterTurns: 0 },
    rallyPoint,
  });
  const buildings = [
    producer("a", "circle-conservatory", home),
    producer("b", "circle-musterhall", target),
    producer("c", "circle-musterhall", { x: 30, z: 30 }),
  ];
  const context = {
    definitions,
    view: {
      actors: () => ({ own: buildings }),
      offlineIds: () => new Set(["b"]),
    },
  } as unknown as AiConcernContext;
  expect(stagingPoint(context)).toEqual({ x: 30, z: 30 });
});

test("lost groups end at once", () => {
  const { lost, step } = fixture(group(1, home.x, home.z));
  lost.add("unit-0");
  expect(step()).toBe("ended");
});

test("diagnostics list operations saved in any concern's memory", () => {
  const { operation } = fixture(group(1, home.x, home.z));
  expect(
    operationsOf({
      defense: { operations: [operation] },
      scouting: { goal: {} },
      custom: { operations: [null, { id: "incomplete" }] },
    }),
  ).toEqual([{ concern: "defense", operation }]);
});
