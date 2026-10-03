import { describe, expect, test } from "vitest";
import { TerrainGrid } from "../src/simulation/terrain";
import { terrainSightlineClear } from "../src/simulation/terrain-sightline";

describe("terrainSightlineClear", () => {
  test("checks diagonal boundaries inside a tile", () => {
    const map = new TerrainGrid({
      width: 2,
      height: 2,
      tileSize: 1,
      createHeight: (x, z) =>
        (x === 1 && z === 0) || (x === 0 && z === 1) ? 2 : 0,
    });
    const from = { ...map.worldPositionAt(0.1, 0.1), height: 1.5 };
    const to = { ...map.worldPositionAt(0.9, 0.9), height: 1.5 };
    expect(terrainSightlineClear(map, from, to)).toBe(false);
    expect(terrainSightlineClear(map, to, from)).toBe(false);
    expect(
      terrainSightlineClear(map, { ...from, height: 2 }, { ...to, height: 2 }),
    ).toBe(true);
  });

  test.each([0.5, 1, 2])(
    "checks grid corner peaks with tile size %s",
    (tileSize) => {
      const map = new TerrainGrid({
        width: 4,
        height: 4,
        tileSize,
        createHeight: (x, z) => (x === 2 && z === 2 ? 1.1 : 0),
      });
      const from = { ...map.tileCenter(1, 1), height: 1.5 };
      const to = { ...map.tileCenter(2, 2), height: 0.5 };
      expect(terrainSightlineClear(map, from, to)).toBe(false);
      expect(terrainSightlineClear(map, to, from)).toBe(false);
    },
  );

  test("handles axis-aligned, diagonal, and stationary rays at map edges", () => {
    const map = new TerrainGrid({ width: 4, height: 4, tileSize: 1 });
    const from = { ...map.worldPositionAt(0, 0), height: 1 };
    for (const [x, z] of [
      [4, 0],
      [0, 4],
      [4, 4],
      [0, 0],
    ]) {
      const to = { ...map.worldPositionAt(x, z), height: 1 };
      expect(terrainSightlineClear(map, from, to)).toBe(true);
      expect(terrainSightlineClear(map, to, from)).toBe(true);
    }
    expect(terrainSightlineClear(map, from, { ...from, height: -1 })).toBe(
      false,
    );
  });
});
