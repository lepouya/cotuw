import {
  createFrame,
  drawDisc,
  packSheet,
  seededRandom,
} from "./sprite-sheet.ts";
import type { Rgba } from "./sprite-sheet.ts";

const STAGES = [0.04, 0.045, 0.05, 0.065];
export const LAUNCH_FLASH_CLIP = {
  columns: 4,
  rows: 1,
  frames: STAGES.map((seconds, cell) => ({ cell, seconds })),
  playback: "once",
} as const;

/** A broad amber pressure flash with a fading exhaust cloud. */
export function buildLaunchFlashSheet() {
  const random = seededRandom(0x1a0c);
  const clouds = Array.from({ length: 9 }, () => ({
    angle: random() * Math.PI * 2,
    reach: 0.6 + random() * 0.4,
  }));
  return packSheet(
    STAGES.map((_, index) => {
      const frame = createFrame(63);
      const radius = [9, 14, 17, 21][index]!;
      for (const { angle, reach } of clouds) {
        const color: Rgba =
          index < 2
            ? [1, 0.55, 0.12, 0.6 - index * 0.1]
            : [0.53, 0.49, 0.4, 0.25 - (index - 2) * 0.1];
        drawDisc(
          frame,
          31.5 + Math.cos(angle) * radius * reach * 0.5,
          31.5 + Math.sin(angle) * radius * reach * 0.5,
          radius * 0.7,
          color,
        );
      }
      if (index < 3)
        drawDisc(frame, 31.5, 31.5, 9 - index * 2, [
          1,
          0.93,
          0.65,
          1 - index * 0.3,
        ]);
      return frame;
    }),
    4,
  );
}
