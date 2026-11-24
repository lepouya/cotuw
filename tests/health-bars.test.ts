import { ArcRotateCamera, Vector3 } from "@babylonjs/core";
import { expect, test, vi } from "vitest";

import { testScene } from "./helpers/scene";
import { TerrainMap } from "../src/map";
import {
  createHealthBarView,
  healthBarOpacity,
} from "../src/render/health-bars";

import type { Mesh } from "@babylonjs/core";

test("health bars show while selected or fighting, then fade out", () => {
  expect(healthBarOpacity(true, Infinity)).toBe(1);
  expect(healthBarOpacity(false, Infinity)).toBe(0);
  expect(healthBarOpacity(false, 0)).toBe(1);
  expect(healthBarOpacity(false, 3)).toBe(1);
  expect(healthBarOpacity(false, 3.5)).toBe(0.5);
  expect(healthBarOpacity(false, 4)).toBe(0);
});

test("every health bar shares three instanced meshes facing the camera", () => {
  const scene = testScene();
  new ArcRotateCamera("camera", 1, 0.8, 20, Vector3.Zero(), scene);
  const map = new TerrainMap({ width: 10, height: 10, tileSize: 1 });
  const view = createHealthBarView(scene, map);
  const bar = (actorId: string, x: number, fraction: number) => ({
    actorId,
    worldPosition: { x, z: 0 },
    height: 2,
    width: 1,
    fraction,
    opacity: 0.5,
  });
  view.update([bar("a", 0, 0.9), bar("b", 3, 0.2)]);
  const mesh = (name: string) => scene.getMeshByName(name) as Mesh;
  const frames = mesh("health-bar-frames");
  const fills = mesh("health-bar-fills");
  expect(scene.meshes).toHaveLength(3);
  expect(frames.thinInstanceCount).toBe(2);
  expect(fills.thinInstanceCount).toBe(2);
  expect(mesh("health-bar-dividers").thinInstanceCount).toBe(8);
  const second = frames.metadata.frameFor("b");
  expect(second!.getTranslation()).toMatchObject({ x: 3, y: 2, z: 0 });
  // A critical fill is red, and each instance carries the bar's opacity.
  const colors = (
    fills as unknown as {
      _userThinInstanceBuffersStorage: { data: Record<string, Float32Array> };
    }
  )._userThinInstanceBuffersStorage.data.instanceColor!;
  expect(colors[4]).toBeGreaterThan(colors[5]!);
  expect(colors[7]).toBe(0.5);
  view.update([bar("a", 0, 0.9)]);
  const upload = vi.spyOn(scene.getEngine(), "updateDynamicVertexBuffer");
  view.update([bar("a", 0, 0.9), bar("c", -3, 0.7)]);
  expect(
    upload.mock.calls
      .filter(([, , , bytes]) => bytes)
      .map(([, , , bytes]) => bytes),
  ).toEqual([128, 128, 512]);
  upload.mockRestore();
  expect(frames.metadata.frameFor("b")).toBeUndefined();
  expect(frames.metadata.frameFor("c").getTranslation().x).toBe(-3);
  view.update([]);
  expect(frames.isVisible).toBe(false);
  view.dispose();
  expect(scene.meshes).toHaveLength(0);
});
