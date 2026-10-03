import { ArcRotateCamera, NullEngine, Scene, Vector3 } from "@babylonjs/core";
import { describe, expect, test } from "vitest";

import {
  createStrategyCamera,
  orthographicViewFootprint,
  projectOntoPlane,
} from "../src/render/camera";
import { TerrainMap } from "../src/map";
import { limitToExplored } from "../src/render/fog";

import type { OrthographicFrame } from "../src/render/camera";

test("camera glides stay within the explored frontier on every frame", () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  try {
    const map = new TerrainMap({ width: 100, height: 10, tileSize: 1 });
    const canvas = Object.assign(new EventTarget(), {
      clientWidth: 800,
      clientHeight: 600,
    });
    const camera = createStrategyCamera(
      scene,
      canvas as HTMLCanvasElement,
      map,
    );
    const fog = {
      version: 0,
      exploredCount: 2,
      isExplored: (x: number, z: number) => (x === 10 || x === 90) && z === 5,
      isVisible: () => false,
    };
    camera.setFocusLimit((point) => limitToExplored(map, fog, point, 4));
    const from = map.tileCenter(10, 5);
    const to = map.tileCenter(90, 5);
    camera.focusOnPoint(new Vector3(from.x, 0, from.z));
    camera.glideToPoint(new Vector3(to.x, 0, to.z));
    engine.getDeltaTime = () => 30;
    for (let frame = 0; frame < 11; frame += 1) {
      scene.onBeforeRenderObservable.notifyObservers(scene);
      const target = (scene.activeCamera as ArcRotateCamera).target;
      const distance = Math.min(
        Math.hypot(target.x - from.x, target.z - from.z),
        Math.hypot(target.x - to.x, target.z - to.z),
      );
      expect(distance).toBeLessThanOrEqual(4 + 1e-9);
    }
    expect((scene.activeCamera as ArcRotateCamera).target.x).toBeCloseTo(to.x);
  } finally {
    scene.dispose();
    engine.dispose();
  }
});

describe("projectOntoPlane", () => {
  test("drops straight onto the plane below a top-down frame", () => {
    const frame: OrthographicFrame = {
      position: new Vector3(0, 10, 0),
      right: new Vector3(1, 0, 0),
      up: new Vector3(0, 0, 1),
      forward: new Vector3(0, -1, 0),
    };

    expect(projectOntoPlane(frame, 2, 3, 0)).toEqual(new Vector3(2, 0, 3));
  });

  test("follows an oblique forward vector to the target height", () => {
    // An unnormalized forward still solves correctly: it need not be a unit
    // vector, only non-horizontal.
    const frame: OrthographicFrame = {
      position: new Vector3(0, 10, 0),
      right: new Vector3(1, 0, 0),
      up: new Vector3(0, 0, 1),
      forward: new Vector3(0, -1, 1),
    };

    expect(projectOntoPlane(frame, 2, 3, 0)).toEqual(new Vector3(2, 0, 13));
  });

  test("lands above ground when the target height is not zero", () => {
    const frame: OrthographicFrame = {
      position: new Vector3(0, 10, 0),
      right: new Vector3(1, 0, 0),
      up: new Vector3(0, 0, 1),
      forward: new Vector3(0, -1, 0),
    };

    expect(projectOntoPlane(frame, 0, 0, 4)).toEqual(new Vector3(0, 4, 0));
  });
});

describe("orthographicViewFootprint", () => {
  test("returns the four ground corners in order around the quad", () => {
    const frame: OrthographicFrame = {
      position: new Vector3(0, 10, 0),
      right: new Vector3(1, 0, 0),
      up: new Vector3(0, 0, 1),
      forward: new Vector3(0, -1, 0),
    };
    const bounds = { left: -1, right: 1, top: 2, bottom: -2 };

    expect(orthographicViewFootprint(frame, bounds, 0)).toEqual([
      new Vector3(-1, 0, -2),
      new Vector3(1, 0, -2),
      new Vector3(1, 0, 2),
      new Vector3(-1, 0, 2),
    ]);
  });
});
