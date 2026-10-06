import {
  blendPixel,
  createFrame,
  drawDisc,
  mixRgba,
  packSheet,
  seededRandom,
  wrap,
} from "./sprite-sheet.ts";

import type { PNG } from "pngjs";
import type { Frame, Rgba } from "./sprite-sheet.ts";

export const TERRAIN_TEXTURES = ["dirt", "water", "clutter", "rock"] as const;
export type TerrainTexture = (typeof TERRAIN_TEXTURES)[number];
const PERIOD = 1023;
/** Toward the upper left and above, matching the sun's usual screen side. */
const LIGHT = [-0.45, -0.55, 0.7].map(
  (value, _, all) => value / Math.hypot(...all),
);

const mix = (from: number, to: number, t: number) => from + (to - from) * t;
const smoothstep = (from: number, to: number, value: number) => {
  const t = Math.max(0, Math.min(1, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
};

/** Seeded, periodic value noise with smooth interpolation between samples. */
function valueNoise(seed: number, cells: number) {
  const random = seededRandom(seed);
  const grid = Array.from({ length: cells * cells }, () => random());
  const at = (x: number, y: number) => grid[(y % cells) * cells + (x % cells)]!;
  return (x: number, y: number) => {
    const u = (x / PERIOD) * cells;
    const v = (y / PERIOD) * cells;
    const ix = Math.floor(u);
    const iy = Math.floor(v);
    const tx = smoothstep(0, 1, u - ix);
    const ty = smoothstep(0, 1, v - iy);
    return mix(
      mix(at(ix, iy), at(ix + 1, iy), tx),
      mix(at(ix, iy + 1), at(ix + 1, iy + 1), tx),
      ty,
    );
  };
}

/**
 * Seeded, periodic gradient noise, roughly within ±0.7. Unlike value noise it
 * shows no blocks along its grid.
 */
function gradientNoise(seed: number, cells: number) {
  const random = seededRandom(seed);
  const gradients = Array.from({ length: cells * cells }, () => {
    const angle = random() * Math.PI * 2;
    return [Math.cos(angle), Math.sin(angle)] as const;
  });
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  return (x: number, y: number) => {
    const u = (x / PERIOD) * cells;
    const v = (y / PERIOD) * cells;
    const ix = Math.floor(u);
    const iy = Math.floor(v);
    const fx = u - ix;
    const fy = v - iy;
    const dot = (cx: number, cy: number) => {
      const [gx, gy] =
        gradients[wrap(iy + cy, cells) * cells + wrap(ix + cx, cells)]!;
      return gx * (fx - cx) + gy * (fy - cy);
    };
    const tx = fade(fx);
    return mix(
      mix(dot(0, 0), dot(1, 0), tx),
      mix(dot(0, 1), dot(1, 1), tx),
      fade(fy),
    );
  };
}

/** Octaves of gradient noise, each with twice the cells and half the weight. */
function fractalNoise(seed: number, cells: number, octaves: number) {
  const layers = Array.from({ length: octaves }, (_, octave) =>
    gradientNoise(seed + octave, cells * 2 ** octave),
  );
  return (x: number, y: number) =>
    layers.reduce((sum, layer, octave) => sum + layer(x, y) / 2 ** octave, 0);
}

/** Offsets coordinates by smooth noise so features wander instead of lining up. */
function warp(seed: number, pixels: number) {
  const along = fractalNoise(seed, 3, 3);
  const across = fractalNoise(seed + 16, 3, 3);
  return (x: number, y: number) =>
    [x + along(x, y) * pixels, y + across(x, y) * pixels] as const;
}

function fill(frame: Frame, color: (x: number, y: number) => Rgba) {
  for (let y = 0; y < PERIOD; y++)
    for (let x = 0; x < PERIOD; x++) {
      const index = (y * PERIOD + x) * 4;
      const value = color(x, y);
      const alpha = value[3];
      for (let channel = 0; channel < 3; channel++)
        frame.pixels[index + channel] =
          Math.max(0, Math.min(1, value[channel]!)) * alpha;
      frame.pixels[index + 3] = alpha;
    }
}

/**
 * Draws a lit, irregular stone over a soft drop shadow. Stones crossing an
 * edge wrap, so the frame stays seamless.
 */
function drawStone(
  frame: Frame,
  x: number,
  y: number,
  radius: number,
  [red, green, blue, alpha]: Rgba,
  random: () => number,
) {
  const lobes = [2, 3, 5].map((count) => ({
    count,
    size: (random() * 0.3) / count,
    phase: random() * Math.PI * 2,
  }));
  const squash = 0.6 + random() * 0.4;
  const angle = random() * Math.PI;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  /** Distance from the center and the outline's distance in that direction. */
  const outline = (dx: number, dy: number) => {
    const along = dx * cos + dy * sin;
    const across = (dy * cos - dx * sin) / squash;
    const theta = Math.atan2(across, along);
    const edge =
      radius *
      (1 +
        lobes.reduce(
          (sum, { count, size, phase }) =>
            sum + size * Math.cos(count * theta + phase),
          0,
        ));
    return [Math.hypot(along, across), edge] as const;
  };
  const reach = Math.ceil(radius * 1.5 + 3);
  const left = Math.floor(x - reach);
  const top = Math.floor(y - reach);
  for (let py = top; py <= top + reach * 2; py++)
    for (let px = left; px <= left + reach * 2; px++) {
      const [distance, edge] = outline(px - 0.3 - x, py - 0.1 - y);
      const coverage = Math.max(0, Math.min(1, (edge + 1.2 - distance) / 2));
      if (coverage > 0)
        blendPixel(frame, px, py, [0.09, 0.07, 0.05, alpha * 0.45], coverage);
    }
  for (let py = top; py <= top + reach * 2; py++)
    for (let px = left; px <= left + reach * 2; px++) {
      const dx = px + 0.5 - x;
      const dy = py + 0.5 - y;
      const [distance, edge] = outline(dx, dy);
      const coverage = Math.max(0, Math.min(1, edge + 0.5 - distance));
      if (coverage === 0) continue;
      // A dome normal from the share of the way to the outline.
      const reachShare = Math.min(1, distance / edge);
      const scale = distance > 0 ? reachShare / distance : 0;
      const normal = [
        dx * scale,
        dy * scale,
        Math.sqrt(1 - reachShare * reachShare),
      ];
      const lit = Math.max(
        0,
        normal.reduce((sum, value, axis) => sum + value * LIGHT[axis]!, 0),
      );
      const shade = 0.5 + lit * 0.7;
      blendPixel(
        frame,
        px,
        py,
        [red * shade, green * shade, blue * shade, alpha],
        coverage,
      );
    }
}

function dirt(frame: Frame) {
  const warped = warp(0xd1a0, 90);
  const soil = fractalNoise(0xd171, 6, 6);
  const damp = fractalNoise(0xda40, 4, 3);
  const grain = seededRandom(0xd17);
  fill(frame, (x, y) => {
    const shade = soil(...warped(x, y)) * 0.16 + (grain() - 0.5) * 0.06;
    const wet = smoothstep(0.05, 0.4, damp(x, y)) * 0.5;
    const tone = 1 + shade;
    return mixRgba(
      [0.48 * tone, 0.355 * tone, 0.25 * tone, 1],
      [0.35, 0.255, 0.175, 1],
      wet,
    );
  });
  const scatter = seededRandom(0x570e);
  for (let fleck = 0; fleck < 1600; fleck++) {
    const shade = scatter() * 0.15;
    drawDisc(frame, scatter() * PERIOD, scatter() * PERIOD, 0.5 + scatter(), [
      0.42 + shade,
      0.36 + shade,
      0.28 + shade,
      0.35,
    ]);
  }
  for (let pebble = 0; pebble < 700; pebble++) {
    const shade = scatter() * 0.12;
    drawStone(
      frame,
      scatter() * PERIOD,
      scatter() * PERIOD,
      1 + scatter() ** 2 * 2.5,
      [0.46 + shade, 0.4 + shade, 0.32 + shade, 0.9],
      scatter,
    );
  }
}

function water(frame: Frame) {
  const broad = valueNoise(0xd171, 4);
  const medium = valueNoise(0x5011, 12);
  fill(frame, (x, y) => {
    const ripple = Math.sin(
      ((y * 6 + x) / PERIOD + broad(x, y) * 0.6) * Math.PI * 2,
    );
    const crest = Math.max(0, ripple) ** 3;
    const strength = 0.45 + medium(x, y) * 0.55;
    const shade = (broad(x, y) - 0.5) * 0.05 + crest * strength * 0.28;
    return [
      0.17 + shade,
      0.48 + shade,
      0.54 + shade,
      0.2 + crest * strength * 0.7,
    ];
  });
}

/** Clusters of stones, larger at each cluster's heart, plus loose strays. */
function clutter(frame: Frame) {
  const scatter = seededRandom(0xc107);
  const stone = (x: number, y: number, radius: number) => {
    const shade = scatter() * 0.16;
    drawStone(
      frame,
      x,
      y,
      radius,
      [0.42 + shade, 0.38 + shade, 0.33 + shade, 1],
      scatter,
    );
  };
  for (let cluster = 0; cluster < 110; cluster++) {
    const x = scatter() * PERIOD;
    const y = scatter() * PERIOD;
    const count = 2 + Math.floor(scatter() * 7);
    for (let index = 0; index < count; index++) {
      const angle = scatter() * Math.PI * 2;
      const distance = scatter() * 22;
      stone(
        x + Math.cos(angle) * distance,
        y + Math.sin(angle) * distance,
        (3 + scatter() * 7) * (1 - distance / 40),
      );
    }
  }
  for (let stray = 0; stray < 240; stray++)
    stone(scatter() * PERIOD, scatter() * PERIOD, 1.5 + scatter() ** 2 * 5);
}

/**
 * Seeded, periodic cellular noise with one jittered point per cell. Returns
 * the nearest point's index and the pixel gap between the nearest two, which
 * narrows to zero along the borders between cells.
 */
function cellularNoise(seed: number, cells: number) {
  const random = seededRandom(seed);
  const size = PERIOD / cells;
  const points = Array.from(
    { length: cells * cells },
    () => [0.15 + random() * 0.7, 0.15 + random() * 0.7] as const,
  );
  return (x: number, y: number) => {
    const ix = Math.floor(x / size);
    const iy = Math.floor(y / size);
    let nearest = Infinity;
    let second = Infinity;
    let cell = 0;
    for (let oy = -1; oy <= 1; oy++)
      for (let ox = -1; ox <= 1; ox++) {
        const index = wrap(iy + oy, cells) * cells + wrap(ix + ox, cells);
        const [px, py] = points[index]!;
        const distance = Math.hypot(
          (ix + ox + px) * size - x,
          (iy + oy + py) * size - y,
        );
        if (distance < nearest) {
          second = nearest;
          nearest = distance;
          cell = index;
        } else if (distance < second) second = distance;
      }
    return { cell, gap: second - nearest };
  };
}

/** Angular stone plates split by cracks, with lichen, for steep ground. */
function rock(frame: Frame) {
  const warped = warp(0x70c0, 70);
  const detail = fractalNoise(0x70c2, 8, 5);
  const plates = cellularNoise(0x70c3, 9);
  const chips = cellularNoise(0x70c4, 23);
  const tilt = seededRandom(0x70c6);
  // Each plate faces its own way, so light picks out the facets.
  const facets = Array.from({ length: 23 * 23 }, () => {
    const angle = tilt() * Math.PI * 2;
    const lean = 0.25 + tilt() * 0.35;
    return (
      Math.sin(lean) *
        (Math.cos(angle) * LIGHT[0]! + Math.sin(angle) * LIGHT[1]!) +
      Math.cos(lean) * LIGHT[2]!
    );
  });
  const grain = seededRandom(0x70c5);
  fill(frame, (x, y) => {
    const [wx, wy] = warped(x, y);
    const plate = plates(wx, wy);
    const chip = chips(wx, wy);
    const facet = facets[plate.cell]! * 0.75 + facets[chip.cell]! * 0.25;
    const shade =
      (facet - 0.75) * 0.5 + detail(x, y) * 0.24 + (grain() - 0.5) * 0.05;
    const crack = Math.max(
      (1 - smoothstep(0.5, 3, plate.gap)) * 0.65,
      (1 - smoothstep(0, 1, chip.gap)) * 0.12,
    );
    // A lit lip along the upper side of each crack.
    const lip = smoothstep(3, 5, plate.gap) * (1 - smoothstep(5, 8, plate.gap));
    const light = (1 + shade + lip * 0.06) * (1 - crack);
    return [0.5 * light, 0.47 * light, 0.43 * light, 1];
  });
  const scatter = seededRandom(0x11c4);
  for (let patch = 0; patch < 90; patch++) {
    const x = scatter() * PERIOD;
    const y = scatter() * PERIOD;
    for (let spot = 0; spot < 8; spot++)
      drawDisc(
        frame,
        x + (scatter() - 0.5) * 18,
        y + (scatter() - 0.5) * 18,
        1 + scatter() * 2.5,
        [0.5 + scatter() * 0.1, 0.54, 0.32, 0.45],
      );
  }
}

const BUILDERS: Record<TerrainTexture, (frame: Frame) => void> = {
  dirt,
  water,
  clutter,
  rock,
};

/** Builds original terrain pixels without reading an image or editor source. */
export function buildTerrainTexture(kind: TerrainTexture): PNG {
  const frame = createFrame(PERIOD);
  BUILDERS[kind](frame);
  return packSheet([frame], 1);
}
