// Layered alpine mountain ranges with finite-difference 3D normal shading,
// glaciated rock arêtes, gullied snowfields, forested foothill carpets, and mist.
import { clamp, HEIGHT, mix, smoothstep, WIDTH } from "./canvas.ts";

import type { Canvas, Noise2D, Rgb } from "./canvas.ts";

type MountainLayerOptions = {
  seedOffset: number;
  profile: (nx: number) => number;
  detailAmp: number;
  detailFreq: number;
  darkRock: Rgb;
  litRock: Rgb;
  snowColor: Rgb;
  snowShade: Rgb;
  snowLine: number;
  snowStrength: number;
  hazeColor: Rgb;
  hazeAmount: number;
  reliefScale?: number;
  forested?: boolean;
  treeLine?: { color: Rgb; density: number; maxHeight: number };
  rand?: () => number;
};

/**
 * Renders an alpine range with sharp ridged silhouette, 3D rock facets,
 * snow-filled chutes, optional forested slopes, and atmospheric valley haze.
 */
function renderMountainLayer(
  canvas: Canvas,
  noise: Noise2D,
  opts: MountainLayerOptions,
): Float32Array {
  const ridgeY = new Float32Array(WIDTH);
  for (let x = 0; x < WIDTH; x++) {
    const nx = x / WIDTH;
    const base = opts.profile(nx);
    const r1 = noise.ridged(
      nx * opts.detailFreq + opts.seedOffset,
      opts.seedOffset * 0.27,
      4,
    );
    const r2 = noise.ridged(
      nx * opts.detailFreq * 2.5 + opts.seedOffset + 5,
      1.7,
      3,
    );
    const r3 = noise.fbm(nx * opts.detailFreq * 5.2 + opts.seedOffset, 3.3, 2);
    const jagged = (r1 * 0.68 + r2 * 0.26 + r3 * 0.06 - 0.45) * opts.detailAmp;
    ridgeY[x] = (base - jagged) * HEIGHT;
  }

  const relief = opts.reliefScale ?? 1.0;
  const rockField = (nx: number, ny: number, depth: number) => {
    // Diagonal shear mimics glaciated alpine ribs & chutes fanning down from peaks.
    const primary = noise.ridged(
      nx * 14.0 + depth * 2.6 + opts.seedOffset,
      ny * 12.0 - depth * 1.2 + opts.seedOffset * 0.6,
      4,
    );
    const secondary = noise.ridged(
      nx * 26.0 - depth * 3.4 + opts.seedOffset * 1.7,
      ny * 22.0 + depth * 0.8,
      3,
    );
    const strata = noise.fbm(nx * 44 + opts.seedOffset, ny * 62, 2) * 0.1;
    return primary * 0.64 + secondary * 0.36 + strata;
  };

  const eps = 0.002;
  const bottomLimit = Math.min(HEIGHT, Math.floor(HEIGHT * 0.64));

  for (let x = 0; x < WIDTH; x++) {
    const topY = Math.max(0, Math.floor(ridgeY[x]!));
    const ridgeSlope =
      x > 0 && x < WIDTH - 1 ? (ridgeY[x + 1]! - ridgeY[x - 1]!) * 0.5 : 0;
    const nx = x / WIDTH;

    for (let y = topY; y < bottomLimit; y++) {
      const ny = y / HEIGHT;
      const depth = (y - topY) / HEIGHT;

      const h0 = rockField(nx, ny, depth);
      const hx = rockField(nx + eps, ny, depth);
      const hy = rockField(nx, ny + eps, depth + eps);
      const dx = (hx - h0) * 15 * relief - ridgeSlope * 0.035;
      const dy = (hy - h0) * 12.5 * relief;
      const invLen = 1 / Math.hypot(dx, dy, 1);
      const nx3 = -dx * invLen;
      const ny3 = -dy * invLen;
      const nz3 = invLen;
      // Twilight key light from upper-right sky.
      const ndotl = clamp(nx3 * 0.64 - ny3 * 0.34 + nz3 * 0.5, 0, 1);

      const facet = smoothstep(0.16, 0.84, ndotl);
      let r = mix(opts.darkRock[0], opts.litRock[0], facet);
      let g = mix(opts.darkRock[1], opts.litRock[1], facet);
      let b = mix(opts.darkRock[2], opts.litRock[2], facet);

      // High-frequency canopy carpet texture on lower forested foothills.
      if (opts.forested) {
        const canopy =
          noise.ridged(nx * 145 + opts.seedOffset, ny * 92, 3) * 0.6 +
          (noise.fbm(nx * 60, ny * 45, 2) * 0.5 + 0.5) * 0.4;
        const treeShade = smoothstep(0.25, 0.8, canopy);
        r = mix(r * 0.72, r * 1.15, treeShade);
        g = mix(g * 0.76, g * 1.22, treeShade);
        b = mix(b * 0.78, b * 1.1, treeShade);
      }

      // Snowfields nestled in concave alpine chutes & ledges; sharp arêtes stay dark rock.
      if (opts.snowStrength > 0 && ny < opts.snowLine + 0.09) {
        const elev = smoothstep(opts.snowLine + 0.05, opts.snowLine - 0.14, ny);
        const chute = smoothstep(0.68, 0.24, h0);
        const slopeHold = smoothstep(0.2, 0.72, ndotl * 0.68 + nz3 * 0.42);
        const streak = smoothstep(
          0.3,
          0.72,
          noise.fbm(nx * 28 + depth * 6.5, ny * 24, 3) * 0.5 + 0.5,
        );
        const snow = clamp(
          elev *
            (chute * 0.8 + streak * 0.44) *
            slopeHold *
            opts.snowStrength *
            1.48,
          0,
          1,
        );
        const snowLit = smoothstep(0.22, 0.76, ndotl);
        const sr = mix(opts.snowShade[0], opts.snowColor[0], snowLit);
        const sg = mix(opts.snowShade[1], opts.snowColor[1], snowLit);
        const sb = mix(opts.snowShade[2], opts.snowColor[2], snowLit);
        r = mix(r, sr, snow);
        g = mix(g, sg, snow);
        b = mix(b, sb, snow);
      }

      // Valley depth mist & aerial perspective.
      const valleyHaze = smoothstep(0.015, 0.25, depth) * 0.55;
      const haze = clamp(opts.hazeAmount + valleyHaze, 0, 0.9);
      r = mix(r, opts.hazeColor[0], haze);
      g = mix(g, opts.hazeColor[1], haze);
      b = mix(b, opts.hazeColor[2], haze);

      const edgeCov = y === topY ? clamp(1 - (ridgeY[x]! - topY), 0, 1) : 1;
      canvas.blend(x, y, r, g, b, edgeCov);
    }
  }

  // Dense conifer treeline silhouettes along forested foothill crests.
  if (opts.treeLine && opts.rand) {
    const { color, density, maxHeight } = opts.treeLine;
    for (let x = 14; x < WIDTH - 14; x += density) {
      const jx = x + (opts.rand() - 0.5) * density;
      const ix = clamp(Math.round(jx), 0, WIDTH - 1);
      const ty = ridgeY[ix]!;
      if (ty > HEIGHT * 0.58 || ty < HEIGHT * 0.2) continue;
      const th = maxHeight * (0.45 + opts.rand() * 0.85);
      canvas.drawSegment(
        jx,
        ty + 5,
        jx,
        ty - th,
        Math.max(1.0, th * 0.16),
        0.35,
        color,
        0.92,
      );
      if (th > 9) {
        canvas.drawSegment(
          jx - th * 0.24,
          ty - th * 0.28,
          jx + th * 0.24,
          ty - th * 0.28,
          0.9,
          0.9,
          color,
          0.86,
        );
        canvas.drawSegment(
          jx - th * 0.16,
          ty - th * 0.56,
          jx + th * 0.16,
          ty - th * 0.56,
          0.7,
          0.7,
          color,
          0.84,
        );
      }
    }
  }

  return ridgeY;
}

/** Renders wispy volumetric-looking valley mist ribbons. */
export function renderMistBand(
  canvas: Canvas,
  noise: Noise2D,
  centerY: (nx: number) => number,
  thickness: number,
  xMin: number,
  xMax: number,
  color: Rgb,
  opacity: number,
  seed: number,
): void {
  const startX = Math.max(0, Math.floor(xMin * WIDTH));
  const endX = Math.min(WIDTH - 1, Math.ceil(xMax * WIDTH));
  for (let x = startX; x <= endX; x++) {
    const nx = x / WIDTH;
    const edgeFade =
      smoothstep(xMin, xMin + 0.1, nx) * smoothstep(xMax, xMax - 0.1, nx);
    if (edgeFade <= 0.001) continue;
    const cy = centerY(nx) * HEIGHT;
    const y0 = Math.max(0, Math.floor(cy - thickness * HEIGHT));
    const y1 = Math.min(HEIGHT - 1, Math.ceil(cy + thickness * HEIGHT));
    for (let y = y0; y <= y1; y++) {
      const dy = (y - cy) / (thickness * HEIGHT);
      const env = Math.exp(-dy * dy * 2.5);
      const w =
        noise.fbm(nx * 5.4 + seed, (y / HEIGHT) * 11.5 + seed * 0.6, 3) * 0.38;
      const n =
        noise.fbm(
          nx * 7.2 + w + seed,
          (y / HEIGHT) * 15.5 - w * 0.5 + seed * 0.7,
          4,
        ) *
          0.5 +
        0.5;
      const wisp = smoothstep(0.28, 0.78, n);
      const a = env * wisp * edgeFade * opacity;
      if (a > 0.003) canvas.blend(x, y, color[0], color[1], color[2], a);
    }
  }
}

/** Renders all receding alpine mountain ranges, forested slopes, and valley mist. */
export function renderAlpineBackdrop(
  canvas: Canvas,
  noise: Noise2D,
  rand: () => number,
): void {
  // 1. Far misty blue-grey ridge range across the central-left horizon.
  renderMountainLayer(canvas, noise, {
    seedOffset: 11.3,
    profile: (nx) =>
      0.235 +
      Math.sin(nx * 6.5 + 1.2) * 0.032 +
      smoothstep(0.25, 0.52, nx) * 0.045 -
      smoothstep(0.55, 0.85, nx) * 0.08,
    detailAmp: 0.075,
    detailFreq: 5.5,
    darkRock: [0.15, 0.23, 0.31],
    litRock: [0.27, 0.37, 0.46],
    snowColor: [0.76, 0.83, 0.88],
    snowShade: [0.44, 0.55, 0.65],
    snowLine: 0.21,
    snowStrength: 0.35,
    hazeColor: [0.3, 0.4, 0.49],
    hazeAmount: 0.48,
    reliefScale: 0.72,
  });

  // 2. Mid-distance jagged snow-capped alpine range (center-right).
  renderMountainLayer(canvas, noise, {
    seedOffset: 27.8,
    profile: (nx) => {
      const passDip = Math.exp(-Math.pow((nx - 0.48) * 5.2, 2)) * 0.095;
      const midPeak = -Math.exp(-Math.pow((nx - 0.61) * 7.2, 2)) * 0.09;
      const rightRise = -smoothstep(0.68, 0.96, nx) * 0.13;
      return 0.27 + passDip + midPeak + rightRise + Math.sin(nx * 11) * 0.014;
    },
    detailAmp: 0.095,
    detailFreq: 7.4,
    darkRock: [0.1, 0.17, 0.23],
    litRock: [0.25, 0.36, 0.44],
    snowColor: [0.85, 0.9, 0.94],
    snowShade: [0.42, 0.55, 0.66],
    snowLine: 0.25,
    snowStrength: 0.88,
    hazeColor: [0.25, 0.35, 0.44],
    hazeAmount: 0.26,
    reliefScale: 1.18,
  });

  // 3. Hero snow-capped alpine massif on the upper right with sharp dark granite arêtes.
  renderMountainLayer(canvas, noise, {
    seedOffset: 43.1,
    profile: (nx) => {
      const mainPeak = -Math.exp(-Math.pow((nx - 0.888) * 8.4, 2)) * 0.235;
      const subPeak = -Math.exp(-Math.pow((nx - 0.805) * 11.5, 2)) * 0.125;
      const rightShoulder = -Math.exp(-Math.pow((nx - 0.965) * 10.0, 2)) * 0.14;
      const leftDrop = smoothstep(0.75, 0.22, nx) * 0.15;
      return 0.365 + mainPeak + subPeak + rightShoulder + leftDrop;
    },
    detailAmp: 0.088,
    detailFreq: 9.2,
    darkRock: [0.08, 0.14, 0.19],
    litRock: [0.24, 0.34, 0.42],
    snowColor: [0.89, 0.93, 0.96],
    snowShade: [0.4, 0.53, 0.64],
    snowLine: 0.27,
    snowStrength: 1.0,
    hazeColor: [0.23, 0.33, 0.42],
    hazeAmount: 0.12,
    reliefScale: 1.45,
  });

  // High valley mist pooling between the alpine peaks and forested foothills.
  renderMistBand(
    canvas,
    noise,
    (nx) => 0.33 - smoothstep(0.65, 1.0, nx) * 0.09,
    0.078,
    0.26,
    1.0,
    [0.44, 0.55, 0.64],
    0.58,
    3.1,
  );

  // 4. Forested mid-valley foothills with dense conifer carpet & treeline silhouettes.
  renderMountainLayer(canvas, noise, {
    seedOffset: 61.5,
    profile: (nx) => {
      const leftSlope = -smoothstep(0.46, 0.18, nx) * 0.11;
      const rightSlope = -smoothstep(0.68, 0.99, nx) * 0.14;
      return 0.435 + leftSlope + rightSlope + Math.sin(nx * 14) * 0.012;
    },
    detailAmp: 0.044,
    detailFreq: 9.0,
    darkRock: [0.06, 0.12, 0.145],
    litRock: [0.13, 0.21, 0.225],
    snowColor: [0.6, 0.7, 0.75],
    snowShade: [0.3, 0.4, 0.46],
    snowLine: 0.0,
    snowStrength: 0,
    hazeColor: [0.24, 0.34, 0.41],
    hazeAmount: 0.22,
    reliefScale: 0.7,
    forested: true,
    treeLine: { color: [0.05, 0.11, 0.13], density: 3.5, maxHeight: 17 },
    rand,
  });

  // Low valley mist curling behind the outpost and rising up the right alpine flank.
  renderMistBand(
    canvas,
    noise,
    (nx) => 0.47 - smoothstep(0.74, 1.0, nx) * 0.18,
    0.09,
    0.24,
    1.0,
    [0.48, 0.6, 0.68],
    0.56,
    12.7,
  );
}
