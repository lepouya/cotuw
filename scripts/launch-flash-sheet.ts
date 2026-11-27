import {
  blendPixel,
  createFrame,
  drawDisc,
  mixRgba,
  packSheet,
  seededRandom,
} from "./sprite-sheet.ts";

import type { Rgba } from "./sprite-sheet.ts";

const PERIOD = 63;
const HOT: Rgba = [1, 0.96, 0.76, 1];
const AMBER: Rgba = [1, 0.43, 0.075, 1];
const EXHAUST: Rgba = [0.62, 0.64, 0.61, 1];
const STAGES = [
  { radius: 10, width: 5, flare: 1, haze: 0.2, core: 7, seconds: 0.04 },
  { radius: 16, width: 6, flare: 0.83, haze: 0.36, core: 4.5, seconds: 0.045 },
  { radius: 20, width: 7, flare: 0.17, haze: 0.54, core: 2.5, seconds: 0.05 },
  { radius: 22, width: 7, flare: 0, haze: 0.28, core: 0, seconds: 0.065 },
];

export const LAUNCH_FLASH_CLIP = {
  columns: STAGES.length,
  rows: 1,
  frames: STAGES.map(({ seconds }, cell) => ({ cell, seconds })),
  playback: "once",
} as const;

/** An uneven ring of hot gas that opens into curling exhaust. */
export function buildLaunchFlashSheet() {
  const random = seededRandom(0x1a0c);
  const embers = Array.from({ length: 7 }, (_, index) => {
    const angle = ((index + random() * 0.62) / 7) * Math.PI * 2;
    return {
      x: Math.cos(angle),
      y: Math.sin(angle),
      reach: 0.8 + random() * 0.2,
    };
  });
  const center = PERIOD / 2;
  const frames = STAGES.map(({ radius, width, flare, haze, core }, stage) => {
    const frame = createFrame(PERIOD);
    for (let y = 1; y < PERIOD; y++) {
      for (let x = 1; x < PERIOD; x++) {
        const dx = (x + 0.5 - center) * 1.09;
        const dy = y + 0.5 - center;
        const distance = Math.hypot(dx, dy);
        const angle = Math.atan2(dy, dx);
        const wave = Math.cos(angle * 3 + 1.2);
        const curl = Math.sin(angle * 5 + distance * 0.27);
        const crest = radius * (1 + wave * 0.13 + curl * 0.07);
        const band = Math.max(0, 1 - Math.abs(distance - crest) / width);
        const taper = Math.min(1, Math.max(0, (29.5 - distance) / 4));
        const pressure = band * (0.68 + wave * 0.2 + curl * 0.12) * flare;
        const smoke = band * (0.63 + curl * 0.37) * haze;
        const ignition = core ? Math.max(0, 1 - distance / (core + 3)) : 0;
        const heat = Math.max(ignition * 1.25, pressure * 0.88);
        const opacity = Math.min(1, (pressure + smoke + ignition * 2) * taper);
        const [red, green, blue] = mixRgba(
          mixRgba(EXHAUST, AMBER, flare),
          HOT,
          Math.min(1, heat),
        );
        if (opacity > 0) blendPixel(frame, x, y, [red, green, blue, opacity]);
      }
    }
    if (stage === 1 || stage === 2) {
      for (const ember of embers) {
        const distance = (19 + stage * 3.8) * ember.reach;
        drawDisc(
          frame,
          center + ember.x * distance,
          center + ember.y * distance,
          stage === 1 ? 1.45 : 1.1,
          [1, 0.63, 0.21, stage === 1 ? 0.88 : 0.46],
        );
      }
    }
    return frame;
  });

  return packSheet(frames, STAGES.length);
}
