import { Color4, Vector3 } from "@babylonjs/core";
import { describe, expect, test } from "vitest";

import { TerrainMap } from "../src/map";
import {
  clampToMap,
  minimapProjection,
  paintTerrain,
  pointNearPolygon,
  tileColor,
} from "../src/render/minimap";

import type { TerrainMapOptions } from "../src/map";

const opaque = (red: number, green: number, blue: number) =>
  new Color4(red, green, blue, 1);

function flatMap(options: Partial<TerrainMapOptions> = {}): TerrainMap {
  return new TerrainMap({ width: 4, height: 4, tileSize: 1, ...options });
}

describe("minimapProjection", () => {
  test("puts north at the top and the map center in the middle", () => {
    const projection = minimapProjection(flatMap(), 200, 200);

    expect(projection.toMinimap({ x: 0, z: 0 })).toEqual({ x: 100, y: 100 });
    const north = projection.toMinimap({ x: 0, z: 1 });
    const east = projection.toMinimap({ x: 1, z: 0 });
    expect(north.y).toBeLessThan(100);
    expect(east.x).toBeGreaterThan(100);
  });

  test("round-trips between world and minimap points", () => {
    const projection = minimapProjection(flatMap(), 160, 120);
    const world = projection.toWorld(
      projection.toMinimap({ x: 1.25, z: -0.5 }),
    );

    expect(world.x).toBeCloseTo(1.25);
    expect(world.y).toBe(0);
    expect(world.z).toBeCloseTo(-0.5);
  });

  test("fits a non-square minimap with room to spare on every side", () => {
    const { mapRect } = minimapProjection(
      flatMap({ width: 8, height: 4 }),
      100,
      100,
    );

    expect(mapRect.x).toBeGreaterThan(0);
    expect(mapRect.x + mapRect.width).toBeLessThan(100);
    expect(mapRect.width / mapRect.height).toBeCloseTo(2);
    expect(mapRect.y + mapRect.height / 2).toBeCloseTo(50);
  });

  test("stays finite for a minimap with no size", () => {
    const point = minimapProjection(flatMap(), 0, 0).toWorld({ x: 0, y: 0 });

    expect(Number.isFinite(point.x)).toBe(true);
    expect(Number.isFinite(point.z)).toBe(true);
  });
});

describe("clampToMap", () => {
  test("pulls outside points onto the nearest map edge", () => {
    const map = flatMap({ width: 4, height: 2, tileSize: 2 });

    expect(clampToMap(new Vector3(10, 3, -10), map)).toEqual(
      new Vector3(4, 0, -2),
    );
    expect(clampToMap(new Vector3(1, 0, 1), map)).toEqual(new Vector3(1, 0, 1));
  });
});

describe("pointNearPolygon", () => {
  const diamond = [
    { x: 0, y: -2 },
    { x: 2, y: 0 },
    { x: 0, y: 2 },
    { x: -2, y: 0 },
  ];

  test("finds points on and close to a rotated outline", () => {
    expect(pointNearPolygon({ x: 0, y: -2 }, diamond, 0)).toBe(true);
    expect(pointNearPolygon({ x: 0, y: -1.7 }, diamond, 0.25)).toBe(true);
  });

  test("rejects the interior and points beyond the grab radius", () => {
    expect(pointNearPolygon({ x: 0, y: 0 }, diamond, 0.25)).toBe(false);
    expect(pointNearPolygon({ x: 3, y: 0 }, diamond, 0.25)).toBe(false);
    expect(pointNearPolygon({ x: 0, y: 0 }, [], 1)).toBe(false);
  });
});

describe("tileColor", () => {
  test("an opaque untextured layer shows its own color on flat ground", () => {
    const map = flatMap({ createLayers: () => [{ color: opaque(1, 0, 0) }] });

    expect(tileColor(map, 1, 1)).toEqual([1, 0, 0]);
  });

  test("composites layers in slot order rather than array order", () => {
    const map = flatMap({
      createLayers: () => [
        { color: new Color4(0, 0, 1, 0.5), slot: 1 },
        { color: opaque(1, 0, 0), slot: 0 },
      ],
    });

    expect(tileColor(map, 0, 0)).toEqual([0.5, 0, 0.5]);
  });

  test("tints each texture's mean color by the layer color", () => {
    const map = flatMap({
      createLayers: () => [{ texture: "terrain/dirt", color: opaque(1, 1, 1) }],
    });

    expect(tileColor(map, 0, 0)).toEqual([0.472, 0.339, 0.217]);
  });

  test("lights slopes facing the northwest and shades those facing away", () => {
    const layers = () => [{ color: opaque(0.5, 0.5, 0.5) }];
    // Rising eastward faces west, towards the light.
    const facingWest = flatMap({
      createHeight: (x) => x * 0.1,
      createLayers: layers,
    });
    // Rising northward faces south, away from it.
    const facingSouth = flatMap({
      createHeight: (_, z) => z * 0.1,
      createLayers: layers,
    });

    expect(tileColor(facingWest, 1, 1)[0]).toBeGreaterThan(0.5);
    expect(tileColor(facingSouth, 1, 1)[0]).toBeLessThan(0.5);
  });
});

describe("paintTerrain", () => {
  test("writes the northernmost row first and only inside the bounds", () => {
    const map = flatMap({
      width: 2,
      height: 2,
      createLayers: (x, z) => [{ color: opaque(x, z, 0) }],
    });
    const pixels = new Uint8ClampedArray(2 * 2 * 4);

    paintTerrain(map, pixels, { minX: 0, minZ: 1, maxX: 1, maxZ: 1 });

    // Row 0 is z = 1, the north edge; row 1 (z = 0) stays untouched.
    expect([...pixels]).toEqual([
      0, 255, 0, 255, 255, 255, 0, 255, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
  });
});
