import { Color3, NullEngine, Scene, VertexBuffer } from "@babylonjs/core";
import { expect, test } from "vitest";

import { TerrainMap } from "../src/map";
import {
  createFootprintOverlay,
  footprintOverlayOffset,
} from "../src/render/footprint-overlay";

test("footprint fills match the terrain diagonal and never intercept picks", () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  try {
    const map = new TerrainMap({
      width: 2,
      height: 2,
      tileSize: 0.5,
      createHeight: (x, z) => (x === 1 && z === 1 ? 2 : 0),
    });
    const overlay = createFootprintOverlay(
      scene,
      map,
      [
        { x: 0, z: 0 },
        { x: -1, z: 0 },
      ],
      { name: "preview", color: Color3.Red(), blocked: true },
    );
    const fill = scene.getMeshByName("preview-fill")!;
    const positions = fill.getVerticesData(VertexBuffer.PositionKind)!;
    const offset = footprintOverlayOffset(map);
    expect([...fill.getIndices()!]).toEqual([0, 1, 3, 1, 2, 3]);
    expect(positions[1]).toBeCloseTo(offset);
    expect(positions[7]).toBeCloseTo(2 + offset);
    const outline = scene.getMeshByName("preview-outline")!;
    const outlinePositions = outline.getVerticesData(
      VertexBuffer.PositionKind,
    )!;
    // The crossing diagonal must bend at the terrain's low center.
    expect(outlinePositions[19]).toBeCloseTo(offset);
    expect(fill.isPickable).toBe(false);
    expect(outline.isPickable).toBe(false);
    const material = fill.material;
    overlay.dispose();
    expect(fill.isDisposed()).toBe(true);
    expect(outline.isDisposed()).toBe(true);
    expect(scene.materials).not.toContain(material);
  } finally {
    engine.dispose();
  }
});
