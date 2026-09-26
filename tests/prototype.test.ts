import { describe, expect, test } from "vitest";

import { TerrainMap } from "../src/map";
import {
  createPrototypeMap,
  PROTOTYPE_MOVEMENT_PROFILES,
} from "../src/prototype";
import { createActor } from "../src/simulation/actor";
import {
  createMissionSimulation,
  createMissionState,
} from "../src/simulation/mission";
import { createTerrainMoveBehavior } from "../src/simulation/terrain-movement";

import type { ActorCommand } from "../src/simulation/command";
import type { MovementProfile } from "../src/simulation/navigation";
import { traversalCostAt } from "../src/simulation/navigation";

const profile: MovementProfile = {
  id: "ground",
  maxSlope: 1,
  slopeCostAtLimit: 1,
  terrainCosts: { plain: 1 },
};

function mission(tickSeconds = 0.5, speed = 4) {
  const map = new TerrainMap({ width: 21, height: 21, tileSize: 1 });
  return createMissionSimulation({
    state: createMissionState([
      createActor({
        id: "trooper",
        definitionId: "trooper",
        worldPosition: { x: 0, z: 0 },
      }),
    ]),
    behaviorRegistry: new Map([
      ["terrain-move", createTerrainMoveBehavior(map, [profile])],
    ]),
    bounds: map.worldBounds,
    definitions: [
      {
        id: "trooper",
        behaviorId: "terrain-move",
        movement: { speed, profileId: "ground" },
      },
    ],
    tickSeconds,
  });
}

function move(x: number, z: number): ActorCommand {
  return { kind: "move", actorId: "trooper", target: { x, z } };
}

describe("terrain-move behavior", () => {
  test("advances continuously along a valid terrain path", () => {
    const simulation = mission();
    simulation.submitCommand(move(4, 0));

    simulation.tick();

    const trooper = simulation.actorById("trooper")!;
    expect(trooper.worldPosition).toEqual({ x: 2, z: 0 });
    expect(trooper.facing).toBeCloseTo(Math.PI / 2);
    expect(trooper.movement?.target).toEqual({ x: 4, z: 0 });
    expect(trooper.movement?.waypoints?.length).toBeGreaterThan(0);
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

describe("prototype movement map", () => {
  test("contains passable paths, slow rough ground, water, and cliffs", () => {
    const map = createPrototypeMap();
    const prototypeGround = PROTOTYPE_MOVEMENT_PROFILES[0]!;

    expect(map.terrainAt(50, 32).typeId).toBe("path");
    expect(map.terrainAt(50, 50).typeId).toBe("rough");
    expect(map.terrainAt(42, 58).typeId).toBe("water");
    expect(traversalCostAt(map, prototypeGround, 50, 32)).toBeLessThan(1);
    expect(traversalCostAt(map, prototypeGround, 50, 50)).toBeGreaterThan(2);
    expect(traversalCostAt(map, prototypeGround, 42, 58)).toBeUndefined();
    expect(traversalCostAt(map, prototypeGround, 60, 20)).toBeUndefined();
    expect(traversalCostAt(map, prototypeGround, 62, 32)).toBeDefined();
  });
});
