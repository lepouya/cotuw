import { describe, expect, test } from "vitest";

import {
  clipCellRect,
  clipDuration,
  clipFrameAt,
  validateTextureClip,
} from "../src/content/texture-clip";

import type { TextureClip } from "../src/content/texture-clip";

const frames = [
  { cell: 0, seconds: 0.1 },
  { cell: 1, seconds: 0.2 },
  { cell: 2, seconds: 0.3 },
];
const clip = (playback: TextureClip["playback"]): TextureClip => ({
  columns: 2,
  rows: 2,
  frames,
  playback,
});
const at = (playback: TextureClip["playback"], times: number[]) =>
  times.map((seconds) => clipFrameAt(clip(playback), seconds));

describe("texture clips", () => {
  test("each frame holds for its own duration and loops", () => {
    expect(clipDuration(clip("loop"))).toBeCloseTo(0.6);
    expect(at("loop", [0, 0.05, 0.11, 0.29, 0.31, 0.59, 0.61, 0.65])).toEqual([
      0, 0, 1, 1, 2, 2, 0, 0,
    ]);
    // Negative time, as a phase lag gives, wraps backward.
    expect(at("loop", [-0.05, -0.35])).toEqual([2, 1]);
  });

  test("ping-pong returns without repeating its end frames", () => {
    expect(clipDuration(clip("ping-pong"))).toBeCloseTo(0.8);
    expect(at("ping-pong", [0.05, 0.15, 0.35, 0.65, 0.75, 0.85])).toEqual([
      0, 1, 2, 1, 1, 0,
    ]);
  });

  test("once holds its first frame before and its last frame after", () => {
    expect(at("once", [-1, 0.05, 0.35, 0.6, 10])).toEqual([0, 0, 2, 2, 2]);
  });

  test("cells are numbered row by row from the top left", () => {
    expect(clipCellRect(clip("loop"), 3, { width: 512, height: 256 })).toEqual({
      x: 256,
      y: 128,
      width: 256,
      height: 128,
    });
  });

  test.each([
    ["no frames", { ...clip("loop"), frames: [] }],
    [
      "a cell outside the sheet",
      { ...clip("loop"), frames: [{ cell: 4, seconds: 1 }] },
    ],
    ["a zero duration", { ...clip("loop"), frames: [{ cell: 0, seconds: 0 }] }],
    ["an unknown mode", { ...clip("loop"), playback: "shuffle" }],
    ["an empty grid", { ...clip("loop"), columns: 0 }],
    [
      "an unsafe cell count",
      { ...clip("loop"), columns: Number.MAX_SAFE_INTEGER, rows: 2 },
    ],
    [
      "an overflowing duration",
      {
        ...clip("loop"),
        frames: [
          { cell: 0, seconds: Number.MAX_VALUE },
          { cell: 1, seconds: Number.MAX_VALUE },
        ],
      },
    ],
  ])("rejects %s", (_, value) => {
    expect(() => validateTextureClip("bad", value)).toThrow(/"bad"/);
  });
});
