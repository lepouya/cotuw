import { describe, expect, test } from "vitest";

import { createActor } from "../src/simulation/actor";
import {
  createMissionSimulation,
  createMissionState,
} from "../src/simulation/mission";

import type {
  Actor,
  ActorBehavior,
  ActorDefinition,
} from "../src/simulation/actor";
import type { ActorCommand } from "../src/simulation/command";
import type { MissionState } from "../src/simulation/mission";
import type { WorldBounds } from "../src/simulation/world";

const step = (from: number, to: number, limit: number) =>
  from + Math.min(Math.max(to - from, -limit), limit);

/** Moves each axis toward the target by at most `speed` units per second. */
const walkBehavior: ActorBehavior = {
  handleCommand: (actor, definition, command) => {
    if (command.kind === "stop") {
      delete actor.movement;
      return true;
    }
    if (!definition.movement) {
      return false;
    }
    actor.movement = { target: { ...command.target } };
    return true;
  },
  update: (actor, definition, seconds) => {
    const target = actor.movement?.target;
    if (!target || !definition.movement) {
      return;
    }
    const limit = definition.movement.speed * seconds;
    actor.worldPosition = {
      x: step(actor.worldPosition.x, target.x, limit),
      z: step(actor.worldPosition.z, target.z, limit),
    };
    if (
      actor.worldPosition.x === target.x &&
      actor.worldPosition.z === target.z
    ) {
      delete actor.movement;
    }
  },
};

const behaviorRegistry = new Map([["walk", walkBehavior]]);

const definitions: ActorDefinition[] = [
  { id: "trooper", behaviorId: "walk", movement: { speed: 4 } },
  { id: "scout", behaviorId: "walk", movement: { speed: 7 } },
  { id: "post", behaviorId: "walk" },
];

const bounds: WorldBounds = { minX: -10, maxX: 10, minZ: -10, maxZ: 10 };

function actor(id = "trooper", definitionId = "trooper", x = 0): Actor {
  return createActor({ id, definitionId, worldPosition: { x, z: 0 } });
}

function mission(actors: Actor[], tickSeconds = 0.5) {
  return createMissionSimulation({
    state: createMissionState(actors),
    behaviorRegistry,
    bounds,
    definitions,
    tickSeconds,
  });
}

function move(actorId: string, x: number, z: number): ActorCommand {
  return { kind: "move", actorId, target: { x, z } };
}

describe("mission definitions", () => {
  test("resolves behavior IDs through the registry", () => {
    const calls: string[] = [];
    const customBehavior: ActorBehavior = {
      handleCommand: (target, _definition, command) => {
        calls.push(command.kind);
        if (command.kind === "move") {
          target.worldPosition = { ...command.target };
        }
        return true;
      },
      update: (target, _definition, seconds) => {
        calls.push(`update:${seconds}`);
        target.facing = 1;
      },
    };
    const simulation = createMissionSimulation({
      state: createMissionState([actor("custom-1", "custom")]),
      behaviorRegistry: new Map([["test", customBehavior]]),
      bounds,
      definitions: [{ id: "custom", behaviorId: "test" }],
      tickSeconds: 0.25,
    });

    simulation.submitCommand(move("custom-1", 2, 3));
    simulation.tick();

    const custom = simulation.actorById("custom-1")!;
    expect(calls).toEqual(["move", "update:0.25"]);
    expect(custom.worldPosition).toEqual({ x: 2, z: 3 });
    expect(custom.facing).toBe(1);
    expect(custom).not.toHaveProperty("behavior");
  });

  test("uses definition movement properties instead of storing them on actors", () => {
    const simulation = mission([actor(), actor("scout-1", "scout")]);
    simulation.submitCommand(move("trooper", 10, 0));
    simulation.submitCommand(move("scout-1", 10, 0));

    simulation.tick();

    expect(simulation.actorById("trooper")!.worldPosition.x).toBe(2);
    expect(simulation.actorById("scout-1")!.worldPosition.x).toBe(3.5);
    expect(simulation.actorById("trooper")).not.toHaveProperty("moveSpeed");
  });

  test("rejects unknown behaviors and invalid speeds before the mission starts", () => {
    const create = (definition: ActorDefinition) => () =>
      createMissionSimulation({
        state: createMissionState([actor()]),
        behaviorRegistry,
        bounds,
        definitions: [definition],
        tickSeconds: 1 / 60,
      });

    expect(create({ id: "trooper", behaviorId: "missing" })).toThrow(
      "unknown behavior",
    );
    expect(
      create({ id: "trooper", behaviorId: "walk", movement: { speed: -1 } }),
    ).toThrow(RangeError);
  });
});

describe("mission commands", () => {
  test("changes nothing until the next tick", () => {
    const simulation = mission([actor()]);

    expect(simulation.submitCommand(move("trooper", 3, 0))).toBe(0);
    expect(simulation.actorById("trooper")).not.toHaveProperty("movement");

    const outcomes = simulation.tick();

    expect(outcomes).toEqual([
      { tick: 0, command: move("trooper", 3, 0), accepted: true },
    ]);
    expect(simulation.completedTicks).toBe(1);
    expect(simulation.submitCommand(move("trooper", 0, 0))).toBe(1);
  });

  test("applies queued commands in submission order", () => {
    const simulation = mission([actor()]);
    simulation.submitCommand(move("trooper", 4, 0));
    simulation.submitCommand({ kind: "stop", actorId: "trooper" });
    simulation.submitCommand(move("trooper", 0, 4));

    simulation.tick();

    expect(simulation.actorById("trooper")!.worldPosition).toEqual({
      x: 0,
      z: 2,
    });
  });

  test("reports commands actors reject", () => {
    const simulation = mission([actor("post-1", "post")]);
    simulation.submitCommand(move("post-1", 1, 0));
    simulation.submitCommand(move("missing", 1, 0));
    simulation.submitCommand(move("post-1", Number.NaN, 0));

    const outcomes = simulation.tick();

    expect(outcomes.map(({ accepted }) => accepted)).toEqual([
      false,
      false,
      false,
    ]);
    expect(simulation.actorById("post-1")).not.toHaveProperty("movement");
  });

  test("clamps move targets to the world bounds", () => {
    const simulation = mission([actor()], 10);
    simulation.submitCommand(move("trooper", 50, -50));

    const [outcome] = simulation.tick();

    expect(outcome.command).toEqual(move("trooper", 10, -10));
    expect(simulation.actorById("trooper")!.worldPosition).toEqual({
      x: 10,
      z: -10,
    });
  });

  test("keeps actors inside the bounds whatever their behavior computes", () => {
    const runaway: ActorBehavior = {
      handleCommand: () => false,
      update: (target) => {
        target.worldPosition = { x: 20.0000001, z: -3 };
      },
    };
    const simulation = createMissionSimulation({
      state: createMissionState([actor("runner-1", "runner")]),
      behaviorRegistry: new Map([["runaway", runaway]]),
      bounds,
      definitions: [{ id: "runner", behaviorId: "runaway" }],
      tickSeconds: 1,
    });

    simulation.tick();

    expect(simulation.actorById("runner-1")!.worldPosition).toEqual({
      x: 10,
      z: -3,
    });
  });

  test("rejects non-finite state written by a behavior before rendering can use it", () => {
    const invalid: ActorBehavior = {
      handleCommand: () => true,
      update: (target) => {
        target.worldPosition = { x: Number.NaN, z: 0 };
      },
    };
    const simulation = createMissionSimulation({
      state: createMissionState([actor("invalid-1", "invalid")]),
      behaviorRegistry: new Map([["invalid", invalid]]),
      bounds,
      definitions: [{ id: "invalid", behaviorId: "invalid" }],
      tickSeconds: 1,
    });
    const before = simulation.snapshot();

    expect(() => simulation.tick()).toThrow("invalid world position");
    expect(simulation.snapshot()).toEqual(before);
    expect(simulation.completedTicks).toBe(0);

    const invalidFacing: ActorBehavior = {
      handleCommand: () => true,
      update: (target) => {
        target.facing = Number.NaN;
      },
    };
    const facingSimulation = createMissionSimulation({
      state: createMissionState([actor("invalid-facing", "invalid-facing")]),
      behaviorRegistry: new Map([["invalid-facing", invalidFacing]]),
      bounds,
      definitions: [{ id: "invalid-facing", behaviorId: "invalid-facing" }],
      tickSeconds: 1,
    });

    expect(() => facingSimulation.tick()).toThrow("invalid facing");
  });
});

describe("mission state", () => {
  test("never changes the caller's state or actors", () => {
    const trooper = actor();
    const state = createMissionState([trooper]);
    const simulation = createMissionSimulation({
      state,
      behaviorRegistry,
      bounds,
      definitions,
      tickSeconds: 1,
    });

    state.actors.push(actor("unknown-1", "unknown"));
    simulation.submitCommand(move("trooper", 1, 0));
    simulation.tick();

    expect(simulation.actors).toHaveLength(1);
    expect(trooper.worldPosition).toEqual({ x: 0, z: 0 });
  });

  test("does not expose mutable simulation actors", () => {
    const simulation = mission([actor()]);
    const fromList = simulation.actors[0]!;
    const fromLookup = simulation.actorById("trooper")!;

    expect(simulation.actors).toBe(simulation.actors);
    expect(Object.isFrozen(simulation.actors)).toBe(true);
    expect(Object.isFrozen(fromList)).toBe(true);
    expect(Object.isFrozen(fromList.worldPosition)).toBe(true);
    expect(() => {
      (fromList as Actor).worldPosition.x = 9;
    }).toThrow(TypeError);
    fromLookup.worldPosition.x = 8;
    fromLookup.movement = { target: { x: 7, z: 0 } };

    expect(simulation.snapshot().actors).toEqual([actor()]);

    const beforeTick = simulation.actors;
    simulation.tick();
    expect(simulation.actors).not.toBe(beforeTick);
  });

  test("snapshots resume identically", () => {
    const original = mission([actor(), actor("scout-1", "scout", 5)]);
    original.submitCommand(move("trooper", 8, 8));
    original.tick();
    original.submitCommand(move("scout-1", -8, 0));
    const saved: MissionState = original.snapshot();
    const resumed = createMissionSimulation({
      state: saved,
      behaviorRegistry,
      bounds,
      definitions,
      tickSeconds: 0.5,
    });

    for (let tick = 0; tick < 5; tick += 1) {
      original.tick();
      resumed.tick();
    }

    expect(resumed.snapshot()).toEqual(original.snapshot());
    expect(saved.tick).toBe(1);
    expect(saved.commands).toHaveLength(1);
  });

  test("spawns and removes actors", () => {
    const simulation = mission([actor()]);
    const scout = actor("scout-1", "scout");

    expect(simulation.actorVersion).toBe(0);
    simulation.spawnActor(scout);
    scout.worldPosition.x = 9;

    expect(simulation.actorVersion).toBe(1);
    expect(simulation.actorById("scout-1")!.worldPosition.x).toBe(0);
    expect(() => simulation.spawnActor(actor())).toThrow("Duplicate");
    expect(simulation.removeActor("trooper")).toBe(true);
    expect(simulation.actorVersion).toBe(2);
    expect(simulation.removeActor("trooper")).toBe(false);
    expect(simulation.actors.map(({ id }) => id)).toEqual(["scout-1"]);
    expect(() => simulation.spawnActor(actor())).toThrow("retired actor ID");

    const resumed = createMissionSimulation({
      state: simulation.snapshot(),
      behaviorRegistry,
      bounds,
      definitions,
      tickSeconds: 0.5,
    });
    expect(() => resumed.spawnActor(actor())).toThrow("retired actor ID");
  });

  test("rejects actors outside the world bounds", () => {
    expect(() => mission([actor("stray", "trooper", 11)])).toThrow(RangeError);
  });

  test("rejects saved move targets that are invalid or off the map", () => {
    const withTarget = (x: number) => ({
      ...actor(),
      movement: { target: { x, z: 0 } },
    });

    expect(() => mission([withTarget(Number.NaN)])).toThrow("move target");
    expect(() => mission([withTarget(11)])).toThrow("move target");
    expect(() => mission([{ ...actor(), facing: Number.NaN }])).toThrow(
      "facing",
    );
  });
});
