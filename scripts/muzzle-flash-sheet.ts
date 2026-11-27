import {
  blendPixel,
  createFrame,
  drawDisc,
  mixRgba,
  packSheet,
  seededRandom,
} from "./sprite-sheet.ts";

import type { PNG } from "pngjs";
import type { Rgba } from "./sprite-sheet.ts";

const PERIOD = 63;
const HOT: Rgba = [1, 0.96, 0.8, 1];
const AMBER: Rgba = [1, 0.41, 0.08, 1];
/** Each frame's core radius, longest spike, and brightness. */
const STAGES = [
  { core: 8, reach: 22, alpha: 1, seconds: 0.025 },
  { core: 8.5, reach: 28, alpha: 1, seconds: 0.035 },
  { core: 4.5, reach: 18, alpha: 0.62, seconds: 0.03 },
  { core: 2.5, reach: 9, alpha: 0.28, seconds: 0.04 },
];

const SPIKES = [
  { angle: -1.05, length: 1, width: 5 },
  { angle: 0.49, length: 0.86, width: 5 },
  { angle: 1.94, length: 0.76, width: 4 },
  { angle: 3.26, length: 0.68, width: 3.5 },
  { angle: 4.14, length: 0.53, width: 2.6 },
].map((spike) => ({
  ...spike,
  x: Math.cos(spike.angle),
  y: Math.sin(spike.angle),
}));

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
  const center = PERIOD / 2;
  const sparks = Array.from({ length: 5 }, (_, index) => {
    const angle = ((index + random() * 0.6) / 5) * Math.PI * 2;
    return {
      x: Math.cos(angle),
      y: Math.sin(angle),
      reach: 0.8 + random() * 0.2,
    };
  });
  const frames = STAGES.map(({ core, reach, alpha }, stage) => {
    const frame = createFrame(PERIOD);
    for (let y = 1; y < PERIOD; y++) {
      for (let x = 1; x < PERIOD; x++) {
        const dx = x + 0.5 - center;
        const dy = y + 0.5 - center;
        const radius = Math.hypot(dx, dy);
        let light = Math.max(0, 1 - radius / (core + 4));
        for (const spike of SPIKES) {
          const along = (dx * spike.x + dy * spike.y) / (reach * spike.length);
          if (along < 0 || along >= 1) continue;
          const across = Math.abs(dy * spike.x - dx * spike.y);
          const width = spike.width * (1 - along);
          const edge = Math.min(1, Math.max(0, width + 0.55 - across));
          light = Math.max(light, edge * (1 - along * 0.66));
        }
        const heat = Math.max(light * 0.42, 1 - radius / (core * 1.5));
        const [red, green, blue] = mixRgba(AMBER, HOT, heat);
        blendPixel(frame, x, y, [red, green, blue, light * alpha]);
      }
    }
    if (stage >= 1) {
      for (const spark of sparks) {
        const distance = spark.reach * (19 + stage * 3.4);
        drawDisc(
          frame,
          center + spark.x * distance,
          center + spark.y * distance,
          1.85 - stage * 0.23,
          [1, 0.66, 0.2, alpha * 0.9],
        );
      }
    }
    return frame;
  });
  return packSheet(frames, STAGES.length);
}
