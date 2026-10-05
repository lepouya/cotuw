// Builds the muzzle flash clip's sprite sheet: a hot core and uneven rays that
// flare, then fade. Each cell keeps a transparent border, so nothing wraps.
import {
  createFrame,
  drawDisc,
  mixRgba,
  packSheet,
  seededRandom,
} from "./sprite-sheet.ts";

import type { PNG } from "pngjs";
import type { Rgba } from "./sprite-sheet.ts";

const PERIOD = 63;
const RAYS = 9;
/** Disc samples per pixel of ray length, so strokes stay continuous. */
const SAMPLES_PER_PIXEL = 2;
const HOT: Rgba = [1, 0.97, 0.82, 1];
const FLAME: Rgba = [1, 0.62, 0.18, 0.7];
/** Each frame's core radius, longest ray, and brightness. */
const STAGES = [
  { core: 6, ray: 15, alpha: 1, seconds: 0.025 },
  { core: 9, ray: 27, alpha: 1, seconds: 0.035 },
  { core: 7, ray: 21, alpha: 0.65, seconds: 0.03 },
  { core: 4, ray: 12, alpha: 0.3, seconds: 0.04 },
];

/** The content pack's muzzle flash clip. */
export const MUZZLE_FLASH_CLIP = {
  columns: STAGES.length,
  rows: 1,
  frames: STAGES.map(({ seconds }, cell) => ({ cell, seconds })),
  playback: "once",
} as const;

/** Rebuilds the sheet the same way on every run. */
export function buildMuzzleFlashSheet(): PNG {
  const random = seededRandom(0xf1a5);
  const rays = Array.from({ length: RAYS }, (_, index) => ({
    angle: ((index + random() * 0.6) / RAYS) * Math.PI * 2,
    reach: 0.55 + random() * 0.45,
    width: 1.6 + random() * 1.4,
  }));
  const center = PERIOD / 2;
  const fade = (color: Rgba, alpha: number): Rgba => [
    color[0],
    color[1],
    color[2],
    color[3] * alpha,
  ];
  const frames = STAGES.map(({ core, ray, alpha }) => {
    const frame = createFrame(PERIOD);
    for (const { angle, reach, width } of rays) {
      const length = ray * reach;
      const steps = Math.ceil(length * SAMPLES_PER_PIXEL);
      for (let step = 0; step <= steps; step++) {
        const t = step / steps;
        drawDisc(
          frame,
          center + Math.cos(angle) * length * t,
          center + Math.sin(angle) * length * t,
          width * (1 - t) + 0.5,
          fade(mixRgba(HOT, FLAME, t), alpha * (1 - t * 0.6)),
        );
      }
    }
    for (let radius = core; radius > 0; radius -= 1.5)
      drawDisc(frame, center, center, radius, fade(HOT, alpha * 0.45));
    return frame;
  });
  return packSheet(frames, STAGES.length);
}
