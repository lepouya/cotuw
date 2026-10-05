// Builds grass terrain clip sprite sheets: tufts over a carpet of short blades,
// seen from above, clustered by a tiling density field so repeats are hard to
// spot. Blade tips sway in a looping westerly wind.
import {
  createFrame,
  drawDisc,
  mixRgba,
  packSheet,
  seededRandom,
} from "./sprite-sheet.ts";

import type { PNG } from "pngjs";
import type { Frame, Rgba } from "./sprite-sheet.ts";

/** Pixels before the image repeats; one cell spans `TILES_PER_REPEAT` tiles. */
const PERIOD = 383;
export const TILES_PER_REPEAT = 4;
const FRAMES = 8;
const COLUMNS = 4;
/** Disc samples per pixel of blade length, so strokes stay continuous. */
const SAMPLES_PER_PIXEL = 2;
/** Frames near the ends of each sway hold longer, like a gust easing. */
const FRAME_SECONDS = [0.14, 0.16, 0.22, 0.16, 0.14, 0.16, 0.22, 0.16];

/** The content pack's clip for every grass sheet. */
export const GRASS_CLIP = {
  columns: COLUMNS,
  rows: FRAMES / COLUMNS,
  frames: FRAME_SECONDS.map((seconds, cell) => ({ cell, seconds })),
  playback: "loop",
} as const;

export type GrassStyle = {
  seed: number;
  tufts: number;
  /** Short blades scattered between tufts. */
  carpet: number;
  /** 0 spreads grass evenly; 1 leaves bare gaps between dense patches. */
  clumping: number;
};

/** Sheets by content-pack tile type: dense rough ground and lighter plains. */
export const GRASS_SHEETS: Readonly<Record<string, GrassStyle>> = {
  grass: { seed: 0x6a55, tufts: 150, carpet: 2600, clumping: 0.45 },
  "grass-sparse": { seed: 0x51e7, tufts: 55, carpet: 900, clumping: 0.85 },
};

type Blade = {
  x: number;
  y: number;
  angle: number;
  length: number;
  width: number;
  bend: number;
  sway: number;
  phase: number;
  root: Rgba;
  tip: Rgba;
};

/** Rebuilds a sheet the same way on every run. */
export function buildGrassSheet(style: GrassStyle): PNG {
  const random = seededRandom(style.seed);
  const between = (low: number, high: number) => low + (high - low) * random();
  // Whole waves per period keep the field seamless.
  const offsets = Array.from({ length: 4 }, () => random() * Math.PI * 2);
  const wave = (x: number, y: number, fx: number, fy: number, k: number) =>
    Math.sin(((fx * x + fy * y) / PERIOD) * Math.PI * 2 + offsets[k]!);
  const density = (x: number, y: number) =>
    1 -
    style.clumping *
      (0.5 -
        0.25 * wave(x, y, 1, 2, 0) -
        0.15 * wave(x, y, 3, -1, 1) -
        0.1 * wave(x, y, 2, 3, 2));
  /** A point whose odds of acceptance follow the density field. */
  const place = () => {
    for (;;) {
      const x = random() * PERIOD;
      const y = random() * PERIOD;
      if (random() < density(x, y)) return { x, y, dense: density(x, y) };
    }
  };
  /** Sparse ground looks drier. */
  const colors = (dense: number, light: number): [Rgba, Rgba] => {
    const dry = (1 - dense) * 0.12 + between(-0.05, 0.05);
    return [
      [0.2 + dry, 0.3 + dry * 0.4, 0.11, 0.95],
      [0.5 + dry + light, 0.62 + light, 0.25, 0.9],
    ];
  };
  const blades: Blade[] = [];
  const shades: { x: number; y: number }[] = [];
  for (let index = 0; index < style.carpet; index++) {
    const { x, y, dense } = place();
    const [root, tip] = colors(dense, -0.06);
    blades.push({
      x,
      y,
      angle: between(0, Math.PI * 2),
      length: between(5, 12),
      width: between(0.7, 1.2),
      bend: between(-0.4, 0.4),
      sway: between(1, 3),
      phase: random() * 2,
      root,
      tip,
    });
  }
  for (let tuft = 0; tuft < style.tufts; tuft++) {
    const { x, y, dense } = place();
    shades.push({ x, y });
    // Neighboring tufts sway slightly out of step.
    const phase = between(0, 0.9);
    const [root, tip] = colors(dense, 0);
    const count = Math.floor(between(8, 15));
    for (let blade = 0; blade < count; blade++)
      blades.push({
        x: x + between(-4, 4),
        y: y + between(-4, 4),
        angle: between(0, Math.PI * 2),
        length: between(10, 26),
        width: between(1, 1.9),
        bend: between(-0.5, 0.5),
        sway: between(3, 6),
        phase,
        root,
        tip,
      });
  }

  const frames: Frame[] = Array.from({ length: FRAMES }, (_, index) => {
    const frame = createFrame(PERIOD);
    // Soft shade grounds each tuft.
    for (const { x, y } of shades)
      for (let radius = 8; radius > 2; radius -= 2)
        drawDisc(frame, x, y, radius, [0.1, 0.16, 0.06, 0.1]);
    for (const blade of blades) {
      const dx = Math.cos(blade.angle);
      const dy = Math.sin(blade.angle);
      // Tips bend sideways by `bend` and downwind by the frame's gust.
      const tipX = blade.x + dx * blade.length - dy * blade.bend * blade.length;
      const tipY = blade.y + dy * blade.length + dx * blade.bend * blade.length;
      const gust =
        Math.sin(((index / FRAMES) * 2 + blade.phase) * Math.PI) * blade.sway;
      const steps = Math.ceil(blade.length * SAMPLES_PER_PIXEL);
      for (let step = 0; step <= steps; step++) {
        const t = step / steps;
        const color = mixRgba(blade.root, blade.tip, t);
        // Bows the blade sideways between its root and tip.
        const curl = blade.bend * blade.length * 0.4 * t * (1 - t);
        drawDisc(
          frame,
          blade.x + (tipX - blade.x) * t - dy * curl + gust * t * t,
          blade.y + (tipY - blade.y) * t + dx * curl,
          blade.width * (1 - t) + 0.5,
          color,
        );
      }
    }
    return frame;
  });

  return packSheet(frames, COLUMNS);
}
