import { describe, expect, test } from "vitest";

import { LEVEL_SOURCES } from "../src/content/levels";
import { MAP_BORDER_TILES, withScenicBorder } from "../src/content/map-border";
import { SIMULATION_TICK_SECONDS } from "../src/simulation/clock";
import { parseMission } from "../src/simulation/mission-file";
import { createScenarioMap } from "../src/simulation/scenario";
import { TerrainGrid } from "../src/simulation/terrain";

test.each([...LEVEL_SOURCES.keys()])(
  "%s keeps an out-of-bounds border around playable ground",
  (id) => {
    const { scenario, state } = parseMission(
      LEVEL_SOURCES.get(id)!,
      SIMULATION_TICK_SECONDS,
    );
    const map = createScenarioMap({ ...scenario, terrain: state.terrain });
    let playable = 0;
    for (let z = 0; z < map.height; z++)
      for (let x = 0; x < map.width; x++) {
        const edge = Math.min(x, z, map.width - 1 - x, map.height - 1 - z);
        const outOfBounds = map.terrainAt(x, z).outOfBounds === true;
        if (edge < MAP_BORDER_TILES)
          expect(outOfBounds, `${x},${z}`).toBe(true);
        if (!outOfBounds) playable++;
      }
    expect(playable).toBeGreaterThan(0);
  },
);

describe("withScenicBorder", () => {
  const size = 2 * MAP_BORDER_TILES + 4;
  const ground = {
    width: size,
    height: size,
    tileSize: 1,
    terrainTypeIds: ["plain"],
    createHeight: () => 1,
  };

  test("leaves playable ground unchanged and dresses the border", () => {
    const map = new TerrainGrid(
      withScenicBorder(ground, (x) => (x < size / 2 ? "water" : "mountain")),
    );
    const inner = MAP_BORDER_TILES;
    const outer = size - MAP_BORDER_TILES;
    expect([...map.terrainTypeIds]).toEqual(["plain", "rough", "water"]);
    for (let z = inner; z <= outer; z++)
      for (let x = inner; x <= outer; x++) expect(map.heightAt(x, z)).toBe(1);
    expect(map.terrainAt(inner, inner)).toEqual({ typeId: "plain" });
    expect(map.terrainAt(inner - 1, inner)).toEqual({
      typeId: "water",
      outOfBounds: true,
    });
    expect(map.terrainAt(outer, inner)).toEqual({
      typeId: "rough",
      outOfBounds: true,
    });
    expect(map.heightAt(0, inner)).toBe(1);
    // A face of three, then one more per tile toward the grid edge.
    expect(map.heightAt(outer + 1, inner)).toBe(4);
    expect(map.heightAt(size, inner)).toBe(7);
  });

  test("extra depth widens the border", () => {
    const map = new TerrainGrid(
      withScenicBorder(
        ground,
        () => "rock",
        (x, z) => (x + z < 2 * MAP_BORDER_TILES + 2 ? 1 : 0),
      ),
    );
    expect(map.terrainAt(MAP_BORDER_TILES, MAP_BORDER_TILES).outOfBounds).toBe(
      true,
    );
    expect(
      map.terrainAt(MAP_BORDER_TILES + 2, MAP_BORDER_TILES).outOfBounds,
    ).toBeUndefined();
  });
});
