import { describe, expect, test } from "vitest";

import { TerrainGrid } from "../src/simulation/terrain";
import { createPrototypeMap } from "../src/prototype";
import { PROTOTYPE_MOVEMENT_PROFILES } from "../src/prototype-content";
import { createActor } from "../src/simulation/actor";
import {
  createMissionSimulation,
  createMissionState,
} from "../src/simulation/mission";
import { createTerrainMoveBehavior } from "../src/simulation/terrain-movement";
import { OccupancyGrid } from "../src/simulation/occupancy";
import { ECONOMY_SCENARIO } from "../src/content/economy-scenario";
import {
  PROTOTYPE_LANDMARKS,
  PROTOTYPE_TERRAIN,
} from "../src/content/prototype-terrain";

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
  const map = new TerrainGrid({ width: 21, height: 21, tileSize: 1 });
  return createMissionSimulation({
    state: createMissionState([
      createActor({
        id: "trooper",
        definitionId: "trooper",
        worldPosition: { x: 0, z: 0 },
      }),
    ]),
    behaviorRegistry: new Map([
      [
        "terrain-move",
        createTerrainMoveBehavior(map, new OccupancyGrid(map), [profile]),
      ],
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
  test("renders authored scenario dimensions, heights, and terrain layers", () => {
    const terrain = new TerrainGrid({
      width: 3,
      height: 2,
      tileSize: 2,
      createHeight: (x, z) => x + z * 10,
      createTerrain: (x) => ({ typeId: x === 0 ? "water" : "rough" }),
    });
    terrain.setHeight(3, 2, 25);
    const scenario = {
      ...ECONOMY_SCENARIO,
      terrain: terrain.terrainState(),
      tileSize: terrain.tileSize,
      terrainTypeIds: [...terrain.terrainTypeIds],
    };
    const map = createPrototypeMap(scenario);
    expect(map.terrainState()).toEqual(scenario.terrain);
    expect(map.worldBounds).toEqual({ minX: -3, maxX: 3, minZ: -2, maxZ: 2 });
    expect(map.layersAt(0, 1).map(({ type }) => type?.id)).toContain("water");
    expect(map.layersAt(1, 1).map(({ type }) => type?.id)).not.toContain(
      "water",
    );
    expect(map.layersAt(1, 1).map(({ type }) => type?.id)).toContain("clutter");
    map.setHeight(3, 2, 30);
    expect(scenario.terrain.heights[scenario.terrain.heights.length - 1]).toBe(
      25,
    );
  });

  test("scenario layers preserve the shoreline and follow saved tile semantics", () => {
    const authored = createPrototypeMap();
    const saved = structuredClone(ECONOMY_SCENARIO);
    const pond = { x: 42, z: 58 };
    const bank = { x: 42, z: 67 };
    const map = createPrototypeMap(saved);
    expect(map.layersAt(bank.x, bank.z)).toEqual(
      authored.layersAt(bank.x, bank.z),
    );
    expect(map.layersAt(bank.x, bank.z)[1].color.a).toBeLessThan(
      map.layersAt(pond.x, pond.z)[1].color.a,
    );
    saved.terrain.tiles[pond.z * saved.terrain.width + pond.x] = {
      typeId: "plain",
    };
    saved.terrain.tiles[0] = { typeId: "water" };
    const restored = createPrototypeMap(saved);
    expect(
      restored.layersAt(pond.x, pond.z).map(({ type }) => type?.id),
    ).not.toContain("water");
    expect(restored.layersAt(0, 0).map(({ type }) => type?.id)).toContain(
      "water",
    );
  });

  test("shared terrain recipes and landmark coordinates cannot drift through mutation", () => {
    expect(() => {
      Object.assign(PROTOTYPE_TERRAIN, { width: 1 });
    }).toThrow(TypeError);
    expect(() => {
      Array.prototype.push.call(PROTOTYPE_TERRAIN.terrainTypeIds, "cliff");
    }).toThrow(TypeError);
    expect(() => {
      Object.assign(PROTOTYPE_LANDMARKS[0].peaks[0], { x: 0 });
    }).toThrow(TypeError);
  });

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
