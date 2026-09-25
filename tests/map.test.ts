import { Color4 } from "@babylonjs/core";
import { describe, expect, test, vi } from "vitest";
import { TerrainMap } from "../src/map";

describe("TerrainMap", () => {
  test("stores shared corner heights separately from tile layers", () => {
    const map = new TerrainMap({
      width: 3,
      height: 2,
      tileSize: 2,
      createHeight: (x, z) => x + z * 10,
      createLayers: (x, z) => [
        { type: { id: `${x},${z}` }, color: new Color4(1, 1, 1, 1) },
      ],
    });

    expect([...map.heights]).toEqual([
      0, 1, 2, 3, 10, 11, 12, 13, 20, 21, 22, 23,
    ]);
    expect(map.layers).toHaveLength(6);
    expect(map.layersAt(1, 1)[0].type?.id).toBe("1,1");
    expect(map.layerCount).toBe(1);
  });

  test("interpolates terrain height at a continuous world position", () => {
    const map = new TerrainMap({
      width: 1,
      height: 1,
      tileSize: 2,
      createHeight: (x, z) => [0, 10, 20, 30][z * 2 + x]!,
    });

    // World (0, 0) is the tile centre. It lies on the mesh's diagonal.
    expect(map.heightAtWorldPosition(0, 0)).toBe(15);
    // This point lies on the first mesh triangle.
    expect(map.heightAtWorldPosition(-0.5, -0.5)).toBe(7.5);
    // This point lies on the second mesh triangle.
    expect(map.heightAtWorldPosition(0.5, 0.5)).toBe(22.5);
  });

  test("accepts world positions on map edges and rejects positions outside", () => {
    const map = new TerrainMap({
      width: 1,
      height: 1,
      tileSize: 2,
      createHeight: (x, z) => x + z * 2,
    });

    expect(map.heightAtWorldPosition(1, 1)).toBe(3);
    expect(map.heightAtWorldPosition(1 + 1e-12, 1)).toBe(3);
    expect(() => map.heightAtWorldPosition(-1.01, 0)).toThrow(RangeError);
    expect(() => map.heightAtWorldPosition(Number.NaN, 0)).toThrow(
      "not finite",
    );
  });

  test("exposes live mutable terrain storage", () => {
    const map = new TerrainMap({ width: 2, height: 2, tileSize: 1 });

    map.setHeight(1, 1, 4);
    map.layersAt(0, 0).push({
      type: { id: "grass" },
      color: new Color4(1, 1, 1, 0.5),
    });
    map.layersAt(0, 0)[0].color.a = 0.75;

    expect(map.heightAt(1, 1)).toBe(4);
    expect(map.heights[map.cornerIndex(1, 1)]).toBe(4);
    expect(map.layers[map.tileIndex(0, 0)][0].color.a).toBe(0.75);
  });

  test("converts map coordinates and corners to centered world points", () => {
    const map = new TerrainMap({
      width: 4,
      height: 2,
      tileSize: 2,
      createHeight: (x, z) => x + z,
    });

    expect(map.worldPoint(1, 1, 7).asArray()).toEqual([-2, 7, 0]);
    expect(map.cornerPoint(1, 1, 0.5).asArray()).toEqual([-2, 2.5, 0]);
  });

  test("reports the tiles affected by a shared corner", () => {
    const map = new TerrainMap({ width: 3, height: 2, tileSize: 1 });

    expect(map.tilesAroundCorner(1, 1)).toEqual({
      minX: 0,
      minZ: 0,
      maxX: 1,
      maxZ: 1,
    });
  });

  test("clips a border corner's affected tile bounds to the map", () => {
    const map = new TerrainMap({ width: 3, height: 2, tileSize: 1 });

    expect(map.tilesAroundCorner(3, 2)).toEqual({
      minX: 2,
      minZ: 1,
      maxX: 2,
      maxZ: 1,
    });
  });

  test("rejects coordinates outside the map instead of aliasing a neighbor", () => {
    const map = new TerrainMap({ width: 3, height: 2, tileSize: 1 });

    // Row-major indexing would quietly turn corner (4, 0) into corner (0, 1).
    expect(() => map.cornerIndex(4, 0)).toThrow(RangeError);
    expect(() => map.heightAt(-1, 0)).toThrow(RangeError);
    expect(() => map.setHeight(0, 3, 1)).toThrow(RangeError);
    expect(() => map.tileIndex(3, 0)).toThrow(RangeError);
    expect(() => map.layersAt(0, 2)).toThrow(RangeError);
  });

  test("accepts every corner and tile on the map", () => {
    const map = new TerrainMap({ width: 3, height: 2, tileSize: 1 });

    expect(map.containsCorner(3, 2)).toBe(true);
    expect(map.containsCorner(4, 2)).toBe(false);
    expect(map.containsTile(2, 1)).toBe(true);
    expect(map.containsTile(3, 1)).toBe(false);
    // Corners run one past the tiles on each axis.
    expect(() => map.heightAt(3, 2)).not.toThrow();
    expect(() => map.layersAt(2, 1)).not.toThrow();
  });

  test("counts pinned slots rather than stack depth", () => {
    const map = new TerrainMap({
      width: 2,
      height: 1,
      tileSize: 1,
      createLayers: (x) =>
        x === 0
          ? [{ color: new Color4(1, 1, 1, 1) }]
          : [
              { color: new Color4(1, 1, 1, 1) },
              { type: { id: "top", slot: 3 }, color: new Color4(1, 1, 1, 1) },
            ],
    });

    // Two layers, but the top one sits on slot 3, so the stack is four deep.
    expect(map.layerCount).toBe(4);
  });

  test("publishes bounded terrain changes to subscribers", () => {
    const map = new TerrainMap({ width: 2, height: 2, tileSize: 1 });
    const listener = vi.fn();
    const observer = map.onChangedObservable.add(listener);
    const bounds = { minX: 0, minZ: 0, maxX: 1, maxZ: 1 };

    map.notifyChange(bounds);
    map.onChangedObservable.remove(observer);
    map.notifyChange(bounds);

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(bounds, expect.anything());
  });
});
