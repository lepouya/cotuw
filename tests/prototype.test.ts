import { describe, expect, test } from "vitest";

import { PROTOTYPE_ACTOR_BEHAVIORS } from "../src/prototype";
import { createActor } from "../src/simulation/actor";
import {
  createMissionSimulation,
  createMissionState,
} from "../src/simulation/mission";

import type { ActorCommand } from "../src/simulation/command";

function mission(tickSeconds = 0.5, speed = 4) {
  return createMissionSimulation({
    state: createMissionState([
      createActor({
        id: "trooper",
        definitionId: "trooper",
        worldPosition: { x: 0, z: 0 },
      }),
    ]),
    behaviorRegistry: PROTOTYPE_ACTOR_BEHAVIORS,
    bounds: { minX: -10, maxX: 10, minZ: -10, maxZ: 10 },
    definitions: [
      { id: "trooper", behaviorId: "direct-move", movement: { speed } },
    ],
    tickSeconds,
  });
}

function move(x: number, z: number): ActorCommand {
  return { kind: "move", actorId: "trooper", target: { x, z } };
}

describe("direct-move behavior", () => {
  test("advances toward a direct target at its fixed speed", () => {
    const simulation = mission();
    simulation.submitCommand(move(3, 4));

    simulation.tick();

    const trooper = simulation.actorById("trooper")!;
    expect(trooper.worldPosition).toEqual({ x: 1.2, z: 1.6 });
    expect(trooper.facing).toBeCloseTo(Math.atan2(3, 4));
    expect(trooper.movement?.target).toEqual({ x: 3, z: 4 });
  });

  test("stops exactly at the target without overshooting", () => {
    const simulation = mission(1);
    simulation.submitCommand(move(1, 0));

    simulation.tick();

    const trooper = simulation.actorById("trooper")!;
    expect(trooper.worldPosition).toEqual({ x: 1, z: 0 });
    expect(trooper).not.toHaveProperty("movement");
  });

  test("a stop command cancels the current order", () => {
    const simulation = mission();
    simulation.submitCommand(move(4, 0));
    simulation.tick();
    simulation.submitCommand({ kind: "stop", actorId: "trooper" });

    simulation.tick();

    const trooper = simulation.actorById("trooper")!;
    expect(trooper.worldPosition).toEqual({ x: 2, z: 0 });
    expect(trooper).not.toHaveProperty("movement");
  });
});
