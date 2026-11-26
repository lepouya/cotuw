import { Vector3 } from "@babylonjs/core";
import { describe, expect, test } from "vitest";

import { TerrainMap } from "../src/map";
import { exploredFrontier } from "../src/render/camera-frontier";
import { cornerColors, EXPLORED_FOG_ALPHA } from "../src/render/fog";
import { shadeFog } from "../src/render/minimap";

import type { FogView } from "../src/simulation/vision";

/** Tiles listed as visible are also explored. */
function fogView(explored: string[], visible: string[] = []): FogView {
  const key = (x: number, z: number) => `${x},${z}`;
  return {
    version: 0,
    exploredCount: explored.length,
    isExplored: (x, z) =>
      explored.includes(key(x, z)) || visible.includes(key(x, z)),
    isVisible: (x, z) => visible.includes(key(x, z)),
  };
}

describe("fog overlay", () => {
  test("each corner takes its darkest neighboring tile", () => {
    const map = new TerrainMap({ width: 2, height: 1, tileSize: 1 });
    const alphas = cornerColors(map, fogView(["1,0"], ["0,0"])).filter(
      (_, index) => index % 4 === 3,
    );
    // Corners run west to east along z = 0, then z = 1.
    expect(alphas).toEqual([
      0,
      EXPLORED_FOG_ALPHA,
      EXPLORED_FOG_ALPHA,
      0,
      EXPLORED_FOG_ALPHA,
      EXPLORED_FOG_ALPHA,
    ]);
    expect(
      cornerColors(map, fogView([])).filter((_, i) => i % 4 === 3),
    ).toEqual([1, 1, 1, 1, 1, 1]);
  });

  test("explored scenic border fades at the outer grid edge", () => {
    const map = new TerrainMap({
      width: 4,
      height: 2,
      tileSize: 1,
      createTerrain: (x) => ({ typeId: "plain", outOfBounds: x < 2 }),
    });
    const fog = fogView([], ["0,0", "0,1", "1,0", "1,1", "2,0", "2,1"]);
    const colors = cornerColors(map, fog);
    const middleRow = colors.slice(5 * 4, 10 * 4);
    expect(middleRow.filter((_, index) => index % 4 === 3)).toEqual([
      1, 0.36, 0, 1, 1,
    ]);
  });
});

describe("shadeFog", () => {
  test("hides unexplored tiles and dims explored tiles outside vision", () => {
    const map = new TerrainMap({ width: 3, height: 1, tileSize: 1 });
    const terrain = new Uint8ClampedArray([
      200, 200, 200, 255, 200, 200, 200, 255, 200, 200, 200, 255,
    ]);
    const shown = new Uint8ClampedArray(terrain.length);
    shadeFog(map, terrain, shown, fogView(["1,0"], ["0,0"]), [0, 0, 0]);
    expect([...shown]).toEqual([
      200, 200, 200, 255, 104, 104, 104, 255, 0, 0, 0, 255,
    ]);
    shadeFog(map, terrain, shown, undefined, [0, 0, 0]);
    expect([...shown]).toEqual([...terrain]);
  });
});

describe("exploredFrontier", () => {
  const map = new TerrainMap({ width: 10, height: 10, tileSize: 1 });
  const fog = fogView(["2,2"]);
  const center = map.tileCenter(2, 2);
  // The central third reaches 2 units from the focal point, plus half a tile.
  const view = { right: new Vector3(6, 0, 0), up: new Vector3(0, 0, 6) };
  const near = (x: number, z: number) =>
    new Vector3(center.x + x, 0, center.z + z);

  test("keeps any focal point over explored ground", () => {
    const tiny = { right: new Vector3(0.1, 0, 0), up: new Vector3(0, 0, 0.1) };
    const point = near(0.4, -0.4);
    expect(exploredFrontier(map, fog)(point, tiny)).toBe(point);
  });

  test("keeps explored ground within the central third", () => {
    const point = near(2.4, -2.4);
    expect(exploredFrontier(map, fog)(point, view)).toBe(point);
  });

  test("moves the least distance to bring explored ground back", () => {
    const limited = exploredFrontier(map, fog)(near(8, 6), view);
    expect(limited.x).toBeCloseTo(center.x + 2.5);
    expect(limited.z).toBeCloseTo(center.z + 2.5);
  });

  test("measures along a turned view's axes", () => {
    const turned = { right: new Vector3(3, 0, 3), up: new Vector3(-3, 0, 3) };
    const limited = exploredFrontier(map, fog)(near(10, 0), turned);
    const reach = 2.5;
    expect(limited.x).toBeCloseTo(center.x + reach);
    expect(limited.z).toBeCloseTo(center.z);
  });

  test("includes the corners of tiles at diagonal headings", () => {
    const turned = { right: new Vector3(3, 0, 3), up: new Vector3(-3, 0, 3) };
    const point = near(1.45, 1.45);
    expect(exploredFrontier(map, fog)(point, turned)).toBe(point);
  });

  test("an existing frontier expands as the viewer explores", () => {
    const explored = ["2,2"];
    const growingFog = {
      ...fogView(explored),
      get exploredCount() {
        return explored.length;
      },
    };
    const limit = exploredFrontier(map, growingFog);
    const point = near(4, 0);
    expect(limit(point, view).x).toBeCloseTo(center.x + 2.5);
    explored.push("6,2");
    expect(limit(point, view)).toBe(point);
  });

  test.each([
    [0, 5, -100, 0.5],
    [9, 5, 100, 0.5],
    [5, 0, 0.5, -100],
    [5, 9, 0.5, 100],
  ])("limits panning past an explored edge tile (%i, %i)", (x, z, px, pz) => {
    const center = map.tileCenter(x, z);
    const limit = exploredFrontier(map, fogView([`${x},${z}`]));
    const limited = limit(new Vector3(px, 0, pz), view);
    expect(
      Math.max(Math.abs(limited.x - center.x), Math.abs(limited.z - center.z)),
    ).toBeCloseTo(2.5);
  });
});
