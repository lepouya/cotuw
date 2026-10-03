import { Vector3 } from "@babylonjs/core";
import { describe, expect, test } from "vitest";

import { TerrainMap } from "../src/map";
import {
  cornerColors,
  EXPLORED_FOG_ALPHA,
  limitToExplored,
} from "../src/render/fog";
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
});

describe("limitToExplored", () => {
  const map = new TerrainMap({ width: 10, height: 10, tileSize: 1 });
  const fog = fogView(["2,2"]);
  const center = map.tileCenter(2, 2);

  test("keeps focal points within the margin", () => {
    const point = new Vector3(center.x + 3, 0, center.z);
    expect(limitToExplored(map, fog, point, 4)).toBe(point);
  });

  test("pulls distant focal points back to the frontier margin", () => {
    const limited = limitToExplored(
      map,
      fog,
      new Vector3(center.x + 8, 0, center.z + 6),
      4,
    );
    expect(limited.x).toBeCloseTo(center.x + 3.2);
    expect(limited.z).toBeCloseTo(center.z + 2.4);
  });

  test.each([
    [0, 5, -100, 0.5],
    [9, 5, 100, 0.5],
    [5, 0, 0.5, -100],
    [5, 9, 0.5, 100],
  ])("limits panning past an explored edge tile (%i, %i)", (x, z, px, pz) => {
    const center = map.tileCenter(x, z);
    const limited = limitToExplored(
      map,
      fogView([`${x},${z}`]),
      new Vector3(px, 0, pz),
      4,
    );
    expect(Math.hypot(limited.x - center.x, limited.z - center.z)).toBeCloseTo(
      4,
    );
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
      200, 200, 200, 255, 90, 90, 90, 255, 0, 0, 0, 255,
    ]);
    shadeFog(map, terrain, shown, undefined, [0, 0, 0]);
    expect([...shown]).toEqual([...terrain]);
  });
});
