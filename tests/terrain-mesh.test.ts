import { Color4, NullEngine, Scene } from "@babylonjs/core";
import { describe, expect, test } from "vitest";

import { TerrainMap } from "../src/map";
import {
  chunksForBounds,
  cornerAlpha,
  CLIP_PHASE_GROUPS,
  createTerrainMeshes,
} from "../src/render/terrain-mesh";

import type { TileLayer, TileType } from "../src/map";

const waterType: TileType = { id: "water", featherEdges: true };
const water = (alpha: number): TileLayer => ({
  type: waterType,
  color: new Color4(1, 1, 1, alpha),
});

/** A map whose tiles carry a feathered water layer only where `wet` says so. */
function wetMap(
  width: number,
  height: number,
  wet: (x: number, z: number) => boolean,
): TerrainMap {
  return new TerrainMap({
    width,
    height,
    tileSize: 1,
    createLayers: (x, z) => (wet(x, z) ? [water(1)] : []),
  });
}

describe("cornerAlpha", () => {
  test("keeps the flat tile alpha when the layer does not feather", () => {
    const map = wetMap(3, 3, () => true);
    const layer: TileLayer = {
      type: { id: "water" },
      color: new Color4(1, 1, 1, 0.4),
    };

    expect(cornerAlpha(map, layer, 0, 0)).toBe(0.4);
    expect(cornerAlpha(map, layer, 1, 1)).toBe(0.4);
  });

  test("averages the four tiles meeting at an interior corner", () => {
    // Only tile (1, 1) is wet, so corner (1, 1) has one wet tile of four.
    const map = wetMap(3, 3, (x, z) => x === 1 && z === 1);

    expect(cornerAlpha(map, water(1), 1, 1)).toBe(0.25);
    expect(cornerAlpha(map, water(1), 2, 2)).toBe(0.25);
  });

  test("counts a tile without the layer as clear", () => {
    const map = wetMap(3, 3, (x) => x <= 1);

    // Corner (2, 1) touches wet (1, 0) and (1, 1), dry (2, 0) and (2, 1).
    expect(cornerAlpha(map, water(1), 2, 1)).toBe(0.5);
    // Corner (1, 1) is surrounded by wet tiles.
    expect(cornerAlpha(map, water(1), 1, 1)).toBe(1);
  });

  test("leaves tiles off the map out of the average", () => {
    // One row of three tiles, wet only in the middle: each corner of the wet
    // tile has one on-map neighbor of two, so none of them feather inward.
    const map = wetMap(3, 1, (x) => x === 1);

    expect(cornerAlpha(map, water(1), 1, 0)).toBe(0.5);
    expect(cornerAlpha(map, water(1), 2, 1)).toBe(0.5);
  });

  test("blends the neighbors' own alphas, not just their presence", () => {
    const map = new TerrainMap({
      width: 2,
      height: 2,
      tileSize: 1,
      createLayers: (x, z) => [water(x === 0 && z === 0 ? 1 : 0.5)],
    });

    expect(cornerAlpha(map, water(1), 1, 1)).toBeCloseTo((1 + 0.5 * 3) / 4);
  });

  test("ignores a neighbor layer of a different type", () => {
    const map = new TerrainMap({
      width: 2,
      height: 2,
      tileSize: 1,
      createLayers: (x, z) =>
        x === 0 && z === 0
          ? [water(1)]
          : [{ type: { id: "dirt" }, color: new Color4(1, 1, 1, 1) }],
    });

    expect(cornerAlpha(map, water(1), 1, 1)).toBe(0.25);
  });
});

describe("createTerrainMeshes", () => {
  test("groups and feathers layers by type ID, not object identity", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    // Each tile builds its own type object, as loaded or modded maps may.
    const map = new TerrainMap({
      width: 2,
      height: 2,
      tileSize: 1,
      createLayers: () => [
        {
          type: { id: "water", featherEdges: true },
          color: new Color4(1, 1, 1, 1),
        },
      ],
    });

    createTerrainMeshes(scene, map, { debugOverlay: true });
    const water = scene.meshes.filter(({ name }) =>
      name.includes("tile-water"),
    );
    const overlay = scene.meshes.filter(({ name }) =>
      ["tile-grid", "major-grid", "map-boundary"].includes(name),
    );

    expect(water).toHaveLength(1);
    expect(
      cornerAlpha(
        map,
        { type: { id: "water", featherEdges: true }, color: new Color4() },
        1,
        1,
      ),
    ).toBe(1);
    expect(overlay).toHaveLength(3);
    expect(overlay.every(({ isPickable }) => !isPickable)).toBe(true);
    engine.dispose();
  });

  test("clip layers split into phase groups that wrap with the cycle", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const map = new TerrainMap({
      width: CLIP_PHASE_GROUPS + 1,
      height: 1,
      tileSize: 1,
      createLayers: () => [
        {
          type: {
            id: "grass",
            graphics: {
              url: "/grass.png",
              clip: "sway",
              // One eighth of the 0.8 second cycle per tile.
              clipPhase: { u: 0.1, v: 0 },
              hasAlpha: true,
              minimapColor: [0.4, 0.5, 0.2, 0.3],
            },
          },
          color: new Color4(1, 1, 1, 1),
        },
      ],
    });
    const frames = Array.from({ length: 8 }, (_, cell) => ({
      cell,
      seconds: 0.1,
    }));

    createTerrainMeshes(scene, map, {
      clips: { sway: { columns: 4, rows: 2, frames, playback: "loop" } },
    });
    const grass = scene.meshes.filter(({ name }) =>
      name.includes("tile-grass"),
    );

    expect(grass).toHaveLength(CLIP_PHASE_GROUPS);
    // The first and last tiles lag a whole cycle apart, so they share one.
    expect(
      grass.map((mesh) => mesh.getTotalVertices()).sort((a, b) => b - a)[0],
    ).toBe(8);
    // Frames are not drawn until the sheet loads.
    expect(grass.every(({ material }) => material!.alpha === 0)).toBe(true);
    engine.dispose();
  });

  test("rejects conflicting definitions for one type ID", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const map = new TerrainMap({
      width: 2,
      height: 1,
      tileSize: 1,
      createLayers: (x) => [
        {
          type: {
            id: "ground",
            graphics: {
              url: x === 0 ? "/dirt.png" : "/grass.png",
              hasAlpha: false,
              minimapColor: [0.5, 0.5, 0.5, 1],
            },
          },
          color: new Color4(1, 1, 1, 1),
        },
      ],
    });

    expect(() => createTerrainMeshes(scene, map)).toThrow(
      "Conflicting terrain tile type ID: ground",
    );
    engine.dispose();
  });
});

describe("chunksForBounds", () => {
  const map = new TerrainMap({ width: 100, height: 100, tileSize: 1 });

  test("dirties one chunk for an edit well inside it", () => {
    expect(
      chunksForBounds(map, { minX: 10, minZ: 10, maxX: 10, maxZ: 10 }),
    ).toEqual(["0,0"]);
  });

  test("dirties the neighbor an edit's feathering reaches across", () => {
    // Tile 31 is the last of chunk 0, and its corner alpha reads tile 32.
    expect(
      chunksForBounds(map, { minX: 31, minZ: 10, maxX: 31, maxZ: 10 }),
    ).toEqual(["0,0", "1,0"]);
    expect(
      chunksForBounds(map, { minX: 32, minZ: 10, maxX: 32, maxZ: 10 }),
    ).toEqual(["0,0", "1,0"]);
  });

  test("dirties all four chunks meeting at a chunk corner", () => {
    expect(
      chunksForBounds(map, { minX: 32, minZ: 32, maxX: 32, maxZ: 32 }),
    ).toEqual(["0,0", "1,0", "0,1", "1,1"]);
  });

  test("clamps the expanded bounds to the map", () => {
    expect(
      chunksForBounds(map, { minX: 0, minZ: 0, maxX: 0, maxZ: 0 }),
    ).toEqual(["0,0"]);
    expect(
      chunksForBounds(map, { minX: 99, minZ: 99, maxX: 99, maxZ: 99 }),
    ).toEqual(["3,3"]);
  });

  test("covers every chunk for a whole-map rebuild", () => {
    const keys = chunksForBounds(map, {
      minX: 0,
      minZ: 0,
      maxX: 99,
      maxZ: 99,
    });

    // 100 tiles at 32 per chunk is four chunks per axis, the last one partial.
    expect(keys).toHaveLength(16);
    expect(new Set(keys).size).toBe(16);
  });
});
