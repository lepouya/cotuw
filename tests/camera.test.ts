import { Vector3 } from "@babylonjs/core";
import { describe, expect, test } from "vitest";

import {
  orthographicViewFootprint,
  projectOntoPlane,
} from "../src/render/camera";

import type { OrthographicFrame } from "../src/render/camera";

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
