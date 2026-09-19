import { describe, expect, test, vi } from "vitest";
import { TerrainMap } from "../src/map";

describe("TerrainMap", () => {
  test("stores tiles in a two-dimensional array", () => {
    const map = new TerrainMap(3, 2, 2, (x, z) => x + z * 10);

    expect(map.tiles).toHaveLength(2);
    expect(map.tiles[0]).toHaveLength(3);
    expect(map.getTile(1, 1).corners).toEqual({
      nw: 11,
      ne: 12,
      sw: 21,
      se: 22,
    });
  });

  test("keeps shared corners and layer stacks synchronized", () => {
    const map = new TerrainMap(2, 2, 1, () => 0);
    const tile = map.getTile(0, 0);
    map.addTileLayer(0, 0, {
      texture: "addons/verdant-clutter",
      tint: [1, 1, 1],
      alpha: 0.5,
    });

    map.setCorner(1, 1, 4);

    expect(tile.corners.se).toBe(4);
    expect(map.getTile(1, 0).corners.sw).toBe(4);
    expect(map.getTile(0, 1).corners.ne).toBe(4);
    expect(map.getTile(1, 1).corners.nw).toBe(4);
    expect(tile.layers).toEqual([
      { texture: "addons/verdant-clutter", tint: [1, 1, 1], alpha: 0.5 },
    ]);
    expect(map.getCorner(1, 1)).toBe(4);
  });

  test("reads every corner back through getCorner", () => {
    const map = new TerrainMap(3, 2, 2, (x, z) => x + z * 10);

    for (let z = 0; z <= 2; z += 1) {
      for (let x = 0; x <= 3; x += 1) {
        expect(map.getCorner(x, z)).toBe(x + z * 10);
      }
    }
  });

  test("reports the deepest layer stack on any tile", () => {
    const map = new TerrainMap(2, 1, 1, () => 0);
    expect(map.layerCount).toBe(0);

    map.addTileLayer(0, 0, { tint: [1, 1, 1], alpha: 1 });
    map.setTileLayers(1, 0, [
      { tint: [1, 1, 1], alpha: 1 },
      { tint: [1, 1, 1], alpha: 0.5 },
    ]);

    expect(map.layerCount).toBe(2);
  });

  test("validates map coordinates, heights, and layer values", () => {
    expect(() => new TerrainMap(1.5, 1, 1, () => 0)).toThrow(RangeError);
    expect(() => new TerrainMap(1, 1, Number.NaN, () => 0)).toThrow(RangeError);
    expect(() => new TerrainMap(1, 1, 1, () => Number.NaN)).toThrow(RangeError);

    const map = new TerrainMap(1, 1, 1, () => 0);
    expect(() => map.getTile(0.5, 0)).toThrow(RangeError);
    expect(() => map.setCorner(0.5, 0, 1)).toThrow(RangeError);
    expect(() => map.addTileLayer(1, 0, { tint: [1, 1, 1], alpha: 1 })).toThrow(
      RangeError,
    );
    expect(() =>
      map.addTileLayer(0, 0, { tint: [1, 1, 1], alpha: 1.1 }),
    ).toThrow(RangeError);
  });

  test("notifies renderers when its terrain data changes", () => {
    const map = new TerrainMap(1, 1, 1, () => 0);
    const listener = vi.fn();
    const unsubscribe = map.onChange(listener);

    map.setCorner(0, 0, 2);
    map.addTileLayer(0, 0, { tint: [0.5, 0.4, 0.3], alpha: 0.75 });
    map.setTileLayers(0, 0, []);
    unsubscribe();
    map.setCorner(1, 1, 3);

    expect(listener).toHaveBeenCalledTimes(3);
  });

  test("coalesces batched height and layer edits into one dirty region", () => {
    const map = new TerrainMap(3, 2, 1, () => 0);
    const listener = vi.fn();
    map.onChange(listener);

    map.edit((terrain) => {
      terrain.setCorner(1, 1, 2);
      terrain.addTileLayer(2, 0, { tint: [0.4, 0.3, 0.2], alpha: 0.8 });
      terrain.setTileLayer(2, 0, 0, {
        tint: [0.6, 0.5, 0.4],
        alpha: 0.7,
      });
    });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({
      bounds: { minX: 0, minZ: 0, maxX: 2, maxZ: 1 },
      heightsChanged: true,
      layersChanged: true,
    });
    expect(map.getTile(2, 0).layers).toEqual([
      { tint: [0.6, 0.5, 0.4], alpha: 0.7 },
    ]);
  });

  test("updates and removes individual tile layers", () => {
    const map = new TerrainMap(1, 1, 1, () => 0);
    map.setTileLayers(0, 0, [
      { texture: "terrain/base", tint: [0.2, 0.3, 0.4], alpha: 1 },
      { texture: "terrain/effect", tint: [1, 0.8, 0.4], alpha: 0.5 },
    ]);

    const removed = map.removeTileLayer(0, 0, 0);

    expect(removed).toEqual({
      texture: "terrain/base",
      tint: [0.2, 0.3, 0.4],
      alpha: 1,
    });
    expect(map.getTileLayers(0, 0)).toEqual([
      { texture: "terrain/effect", tint: [1, 0.8, 0.4], alpha: 0.5 },
    ]);
  });
});
