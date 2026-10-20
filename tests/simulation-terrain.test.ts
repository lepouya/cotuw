import { describe, expect, test, vi } from "vitest";
import { TerrainGrid } from "../src/simulation/terrain";
import { OccupancyGrid } from "../src/simulation/occupancy";
import { createActor } from "../src/simulation/actor";
import {
  createMissionSimulation,
  createMissionState,
} from "../src/simulation/mission";
import { NavigationGrid } from "../src/simulation/navigation";
import { createTerrainMoveBehavior } from "../src/simulation/terrain-movement";
import { createTilePlacedActor } from "../src/simulation/placement";
import type { ActorDefinition } from "../src/simulation/actor";
import type { TerrainEdit, TerrainState } from "../src/simulation/terrain";
import type { MissionCommand } from "../src/simulation/command";

const ground = {
  id: "ground",
  maxSlope: 1,
  slopeCostAtLimit: 1,
  terrainCosts: { plain: 1 },
};
const makeMap = () => new TerrainGrid({ width: 5, height: 3, tileSize: 1 });

describe("simulation terrain", () => {
  test.each(["heights", "tiles"])(
    "sparse %s edits leave the entire terrain unchanged",
    (field) => {
      const map = makeMap();
      const changes = Array(2);
      changes[0] =
        field === "heights"
          ? { x: 0, z: 0, height: 1 }
          : { x: 0, z: 0, terrain: { typeId: "plain", outOfBounds: true } };
      const edit: TerrainEdit = { [field]: changes };
      const before = map.terrainState();

      expect(() => map.editTerrain(edit)).toThrow();
      expect(map.terrainState()).toEqual(before);
      expect(map.isValidTerrainEdit(edit)).toBe(false);
    },
  );

  test.each(["heights", "tiles"])(
    "a sparse %s command is rejected without faulting the mission",
    (field) => {
      const map = makeMap();
      const simulation = createMissionSimulation({
        state: createMissionState([]),
        definitions: [],
        behaviorRegistry: new Map(),
        map,
        tickSeconds: 0.1,
        bounds: map.worldBounds,
      });
      const before = map.terrainState();
      simulation.submitCommand({
        kind: "terrain",
        [field]: Array(1),
      } as MissionCommand);
      expect(simulation.snapshot().commands).toEqual([]);
      expect(simulation.tick()).toMatchObject([{ accepted: false }]);
      expect(map.terrainState()).toEqual(before);
      simulation.submitCommand({
        kind: "terrain",
        heights: [{ x: 0, z: 0, height: 1 }],
      });
      expect(simulation.tick()).toMatchObject([{ accepted: true }]);
      expect(map.heightAt(0, 0)).toBe(1);
      simulation.dispose();
    },
  );

  test.each([{ minX: -10 }, { maxX: 10 }, { minZ: -10 }, { maxZ: 10 }])(
    "rejects simulation bounds beyond the map: %j",
    (bounds) => {
      const map = makeMap();
      const before = map.terrainState();
      expect(() =>
        createMissionSimulation({
          state: createMissionState([]),
          definitions: [],
          behaviorRegistry: new Map(),
          map,
          tickSeconds: 0.1,
          bounds: { ...map.worldBounds, ...bounds },
        }),
      ).toThrow("bounds cannot exceed the terrain map");
      expect(map.terrainState()).toEqual(before);
    },
  );

  test("terrain queries cannot change map geometry or its terrain catalog", () => {
    const map = makeMap();
    const before = map.terrainState();
    const catalog = map.terrainTypeIds as Set<string>;
    catalog.clear();
    catalog.add("water");
    expect([...map.terrainTypeIds]).toEqual(["plain"]);
    expect(() => Object.assign(map.worldBounds, { minX: -100 })).toThrow(
      TypeError,
    );
    expect(map.tileAtWorldPosition(0, 0)).toEqual({ x: 2, z: 1 });
    expect(() => map.setTerrain(0, 0, { typeId: "water" })).toThrow(
      "not declared by the map",
    );
    expect(map.terrainState()).toEqual(before);
  });

  test("height queries cannot mutate terrain or bypass edit rules", () => {
    const map = makeMap();
    const before = map.terrainState();
    const heights = map.heights;
    heights.fill(5);
    expect(map.terrainState()).toEqual(before);
    expect(map.heights).not.toBe(heights);
    const release = map.addEditRule(() => false);
    expect(() => map.setHeight(0, 0, 1)).toThrow("Invalid terrain edit");
    expect(map.terrainState()).toEqual(before);
    release();
    map.setHeight(0, 0, 1);
    expect(map.heightAt(0, 0)).toBe(1);
  });

  test("height setters invalidate bounded navigation costs and notify views", () => {
    const map = makeMap();
    const occupancy = new OccupancyGrid(map);
    const grid = new NavigationGrid(map, occupancy, {
      ...ground,
      maxSlope: 0.5,
    });
    expect(grid.costAt(1, 1)).toBe(1);
    expect(grid.regionAt(1, 1)).toBeGreaterThanOrEqual(0);
    const changed = vi.fn();
    map.onChanged(changed);

    map.setHeight(1, 1, 1);

    const bounds = { minX: 0, minZ: 0, maxX: 1, maxZ: 1 };
    expect(changed).toHaveBeenCalledExactlyOnceWith(bounds);
    expect(map.navigationChanges.since(0)).toEqual([bounds]);
    expect(grid.costAt(1, 1)).toBeUndefined();
    expect(grid.regionAt(1, 1)).toBe(-1);
    expect(grid.costAt(4, 2)).toBe(1);
  });
  test("round-trips a moving actor on a nonblocking footprint without a renderer", () => {
    const map = makeMap();
    const definitions: ActorDefinition[] = [
      {
        id: "unit",
        behaviorId: "move",
        movement: { speed: 2, profileId: "ground" },
      },
      {
        id: "marker",
        behaviorId: "idle",
        footprint: {
          layer: "surface",
          occupiedTiles: [{ x: 0, z: 0 }],
          blocksMovement: false,
        },
        placement: { terrainTypeIds: ["plain"], maxSlope: 1 },
      },
    ];
    const make = (
      map: TerrainGrid,
      occupancy: OccupancyGrid,
      state = createMissionState([
        createActor({
          id: "unit-1",
          definitionId: "unit",
          worldPosition: map.tileCenter(0, 1),
        }),
        createTilePlacedActor(map, definitions[1]!, {
          actorId: "marker-1",
          origin: { x: 2, z: 1 },
        }),
      ]),
    ) =>
      createMissionSimulation({
        map,
        occupancy,
        state,
        definitions,
        bounds: map.worldBounds,
        tickSeconds: 1,
        behaviorRegistry: new Map([
          ["move", createTerrainMoveBehavior(map, occupancy, [ground])],
          ["idle", { handleCommand: () => false, update: () => {} }],
        ]),
      });
    const occupancy = new OccupancyGrid(map);
    const original = make(map, occupancy);
    original.submitCommand({
      kind: "move",
      actorId: "unit-1",
      target: map.tileCenter(4, 1),
    });
    original.tick();
    expect(original.actorById("unit-1")!.worldPosition).toEqual(
      map.tileCenter(2, 1),
    );
    const restoredMap = makeMap();
    const restoredOccupancy = new OccupancyGrid(restoredMap);
    const restored = make(
      restoredMap,
      restoredOccupancy,
      JSON.parse(JSON.stringify(original.snapshot())),
    );
    expect(restored.snapshot()).toEqual(original.snapshot());
    expect(restoredOccupancy.placementByOwnerId("marker-1")).toEqual(
      occupancy.placementByOwnerId("marker-1"),
    );
    original.tick();
    restored.tick();
    expect(restored.snapshot()).toEqual(original.snapshot());
  });

  test("navigates around blocking occupancy without a renderer", () => {
    const map = makeMap();
    const occupancy = new OccupancyGrid(map);
    occupancy.place({
      ownerId: "post",
      origin: { x: 2, z: 1 },
      footprint: {
        layer: "surface",
        occupiedTiles: [{ x: 0, z: 0 }],
        blocksMovement: true,
      },
    });
    expect(
      new NavigationGrid(map, occupancy, ground).costAt(2, 1),
    ).toBeUndefined();
  });

  test.each([
    { heights: [{ x: 1, z: 1, height: NaN }] },
    { heights: [{ x: 1, z: 1, height: Infinity }] },
    { heights: [{ x: 1, z: 1, height: 1e100 }] },
    { heights: [{ x: 0.5, z: 1, height: 1 }] },
    { tiles: [{ x: 0.5, z: 1, terrain: { typeId: "plain" } }] },
    {
      tiles: [{ x: 1, z: 1, terrain: { typeId: "plain", outOfBounds: "yes" } }],
    },
  ])("rejects malformed terrain commands atomically: %j", (invalid) => {
    const map = makeMap();
    const mission = createMissionSimulation({
      map,
      state: createMissionState([]),
      definitions: [],
      behaviorRegistry: new Map(),
      bounds: map.worldBounds,
      tickSeconds: 1,
    });
    const before = map.terrainState();
    mission.submitCommand({ kind: "terrain", ...invalid } as TerrainEdit & {
      kind: "terrain";
    });
    expect(mission.tick()[0]?.accepted).toBe(false);
    expect(map.terrainState()).toEqual(before);
  });

  test.each(["height", "flag", "version", "null-height"])(
    "rejects malformed saved %s before changing terrain",
    (kind) => {
      const map = makeMap();
      const before = map.terrainState();
      const saved = structuredClone(before);
      if (kind === "height") saved.heights[0] = NaN;
      if (kind === "null-height") (saved.heights as unknown[])[0] = null;
      if (kind === "flag")
        (saved.tiles[0] as unknown as { outOfBounds: unknown }).outOfBounds =
          "yes";
      if (kind === "version") saved.navigationVersion = -1;
      expect(() => map.restoreTerrainState(saved as TerrainState)).toThrow(
        RangeError,
      );
      expect(map.terrainState()).toEqual(before);
    },
  );
});
