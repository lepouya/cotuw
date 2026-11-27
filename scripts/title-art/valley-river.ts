// Alpine valley meadow, winding whitewater river, glistening river boulders,
// clustered midground spruce groves, and bottom-right mossy granite outcrop.
import { clamp, HEIGHT, mix, smoothstep, WIDTH } from "./canvas.ts";
import { drawPineTree } from "./trees.ts";

import type { Canvas, Noise2D, Point } from "./canvas.ts";

/** Computes the winding river center X and half-width at normalized screen Y. */
function riverGeometry(ny: number): {
  centerX: number;
  halfWidth: number;
} {
  const t = clamp((ny - 0.555) / 0.445, 0, 1);
  const bend =
    Math.sin(t * Math.PI * 3.1 + 0.4) * 0.058 * (1 - t * 0.35) +
    Math.sin(t * Math.PI * 6.5) * 0.013;
  const centerX = mix(0.84, 0.51, Math.pow(t, 0.86)) + bend;
  const halfWidth = mix(0.007, 0.145, Math.pow(t, 1.55));
  return { centerX, halfWidth };
}

/** Draws an angular, faceted granite boulder with moss cap or whitewater spray collar. */
function drawRockBoulder(
  canvas: Canvas,
  noise: Noise2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  rand: () => number,
  inWater: boolean,
): void {
  const pts: Point[] = [];
  const sides = 8;
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2 + (rand() - 0.5) * 0.18;
    const jitter = 0.72 + rand() * 0.42;
    const flatBottom = Math.sin(a) > 0.15 ? 0.56 : 1.0;
    pts.push([
      cx + Math.cos(a) * rx * jitter,
      cy + Math.sin(a) * ry * jitter * flatBottom,
    ]);
  }
  if (inWater) {
    // Whitewater spray curling around and trailing downstream from a wet river rock.
    canvas.drawSoftEllipse(
      cx - rx * 0.22,
      cy + ry * 0.4,
      rx * 1.4,
      ry * 0.36,
      [0.76, 0.86, 0.92],
      0.48,
      1.5,
    );
    canvas.drawSoftEllipse(
      cx - rx * 0.55,
      cy + ry * 0.52,
      rx * 0.85,
      ry * 0.2,
      [0.84, 0.91, 0.95],
      0.34,
      1.6,
    );
  }
  canvas.fillPolygon(pts, (x, y, u, v) => {
    const h0 = noise.ridged(x * 0.055, y * 0.055, 3);
    const hx = noise.ridged((x + 2) * 0.055, y * 0.055, 2);
    const facet = clamp(
      (1 - v) * 0.75 + (hx - h0) * 3.8 + (u - 0.3) * 0.3,
      0,
      1,
    );
    // Wet river boulders catch a subtle cool sky specular sheen on upper faces.
    const wetSheen = inWater ? smoothstep(0.65, 0.95, facet) * 0.18 : 0;
    const moss = inWater
      ? 0
      : smoothstep(0.52, 0.08, v) * smoothstep(0.32, 0.74, h0);
    const r = mix(mix(0.04, 0.21, facet) + wetSheen * 0.7, 0.17, moss * 0.8);
    const g = mix(mix(0.06, 0.24, facet) + wetSheen * 0.85, 0.26, moss * 0.8);
    const b = mix(mix(0.07, 0.26, facet) + wetSheen, 0.1, moss * 0.8);
    return [r, g, b, 1];
  });
}

/** Renders the alpine valley floor, river, boulders, midground pines, and right outcrop. */
export function renderValleyAndRiver(
  canvas: Canvas,
  noise: Noise2D,
  rand: () => number,
): void {
  const startY = Math.floor(HEIGHT * 0.545);

  for (let y = startY; y < HEIGHT; y++) {
    const ny = y / HEIGHT;
    const persp = clamp((ny - 0.54) / 0.46, 0, 1);
    const { centerX, halfWidth } = riverGeometry(ny);

    for (let x = 0; x < WIDTH; x++) {
      const nx = x / WIDTH;

      const horizonY =
        0.555 +
        Math.sin(nx * 5.2 + 0.8) * 0.015 -
        smoothstep(0.75, 0.98, nx) * 0.055 +
        smoothstep(0.45, 0.72, nx) * 0.042;
      if (ny < horizonY) continue;
      const groundAlpha = smoothstep(horizonY, horizonY + 0.018, ny);

      // Perspective-projected undulating alpine meadow with grassy hummocks & scree.
      const worldZ = 1 / Math.max(0.055, persp + 0.055);
      const tx = (nx - 0.5) * worldZ * 1.45;
      const ty = worldZ * 0.95;
      const hummock = noise.fbm(tx * 1.5 + 2.3, ty * 1.5, 4) * 0.5 + 0.5;
      const hummockX = noise.fbm(tx * 1.5 + 2.38, ty * 1.5, 3) * 0.5 + 0.5;
      const tuft = noise.ridged(nx * 64, ny * 80, 3);
      const slopeLit = clamp(
        0.5 + (hummockX - hummock) * 4.8 + (tuft - 0.5) * 0.45,
        0,
        1,
      );
      const distFade = smoothstep(0.0, 0.45, persp);

      // Olive-moss meadows with dark damp hollows and ochre alpine grass highlights.
      const dryGrass = smoothstep(0.56, 0.84, hummock);
      let r = mix(mix(0.055, 0.21, slopeLit), 0.29, dryGrass * 0.48);
      let g = mix(mix(0.085, 0.275, slopeLit), 0.31, dryGrass * 0.48);
      let b = mix(mix(0.065, 0.14, slopeLit), 0.12, dryGrass * 0.48);

      const leftShade = mix(0.28, 1.0, smoothstep(0.18, 0.56, nx));
      r *= leftShade;
      g *= leftShade;
      b *= leftShade;

      // Subtle winding dirt footpath descending from the outpost.
      const pathX =
        mix(0.71, 0.65, smoothstep(0.56, 0.68, ny)) + Math.sin(ny * 36) * 0.015;
      const pathDist = Math.abs(nx - pathX);
      if (ny > 0.565 && ny < 0.7 && pathDist < 0.011) {
        const pt =
          smoothstep(0.011, 0.002, pathDist) * smoothstep(0.7, 0.64, ny);
        r = mix(r, 0.35, pt * 0.64);
        g = mix(g, 0.28, pt * 0.64);
        b = mix(b, 0.18, pt * 0.64);
      }

      // Distance atmospheric mist on far valley floor.
      r = mix(0.18, r, mix(0.42, 1.0, distFade));
      g = mix(0.25, g, mix(0.42, 1.0, distFade));
      b = mix(0.3, b, mix(0.42, 1.0, distFade));

      // River channel, wet dark shingle banks, and cascading whitewater.
      const bankWarp = noise.fbm(nx * 24 + 5, ny * 38, 3) * halfWidth * 0.42;
      const riverDist = Math.abs(nx - centerX) + bankWarp;
      const bankEdge = halfWidth * 1.28;

      if (riverDist < bankEdge) {
        if (riverDist > halfWidth) {
          const bt = smoothstep(bankEdge, halfWidth, riverDist);
          const stone = noise.ridged(nx * 54, ny * 80, 3);
          r = mix(r, mix(0.05, 0.19, stone), bt * 0.88);
          g = mix(g, mix(0.07, 0.21, stone), bt * 0.88);
          b = mix(b, mix(0.08, 0.23, stone), bt * 0.88);
        } else {
          const edgeMask = smoothstep(halfWidth, halfWidth * 0.74, riverDist);
          const ripple = noise.fbm(nx * 36, ny * 170 + nx * 14, 4) * 0.5 + 0.5;
          const flow = noise.ridged(nx * 26 + ripple * 0.55, ny * 92, 3);

          // Glossy dark wet river edges, sky-reflective steel-blue center pools.
          let wr = mix(0.07, 0.34, ripple * 0.58 + edgeMask * 0.42);
          let wg = mix(0.12, 0.44, ripple * 0.58 + edgeMask * 0.42);
          let wb = mix(0.16, 0.52, ripple * 0.58 + edgeMask * 0.42);

          // Warm amber dusk/outpost shimmer dancing across the calm mid-river pool.
          const warmRef =
            Math.exp(-Math.pow((nx - 0.585) * 14, 2)) *
            smoothstep(0.69, 0.79, ny) *
            smoothstep(0.9, 0.81, ny) *
            smoothstep(0.42, 0.8, ripple);
          wr += warmRef * 0.55;
          wg += warmRef * 0.36;
          wb += warmRef * 0.15;

          // Stepped whitewater cascades pouring over submerged rock ledges.
          const cascade =
            Math.exp(-Math.pow((ny - 0.858) * 48, 2)) +
            Math.exp(-Math.pow((ny - 0.735) * 58, 2)) * 0.78 +
            Math.exp(-Math.pow((ny - 0.642) * 72, 2)) * 0.72;
          const foam = clamp(
            smoothstep(0.64, 0.88, flow + cascade * 0.48) * edgeMask +
              smoothstep(0.54, 0.88, ripple) * cascade * 0.8,
            0,
            0.95,
          );
          wr = mix(wr, 0.78, foam);
          wg = mix(wg, 0.86, foam);
          wb = mix(wb, 0.91, foam);

          r = mix(r, wr, edgeMask);
          g = mix(g, wg, edgeMask);
          b = mix(b, wb, edgeMask);
        }
      }

      canvas.blend(x, y, r, g, b, groundAlpha);
    }
  }

  // Scatter rugged wet boulders mostly along the banks, leaving open reflective pools.
  const boulders: {
    x: number;
    y: number;
    rx: number;
    ry: number;
    inWater: boolean;
  }[] = [];
  for (let i = 0; i < 42; i++) {
    const ny = mix(0.59, 0.99, Math.pow(rand(), 0.72));
    const { centerX, halfWidth } = riverGeometry(ny);
    const bankBias =
      rand() < 0.72
        ? (rand() < 0.5 ? -1 : 1) * (0.65 + rand() * 0.58)
        : (rand() - 0.5) * 1.1;
    const scale = mix(4.0, 29, (ny - 0.58) / 0.42) * (0.5 + rand() * 0.85);
    boulders.push({
      x: (centerX + bankBias * halfWidth) * WIDTH,
      y: ny * HEIGHT,
      rx: scale * 1.45,
      ry: scale * 0.7,
      inWater: Math.abs(bankBias) < 0.86,
    });
  }
  boulders.sort((a, b) => a.y - b.y);
  for (const b of boulders) {
    drawRockBoulder(canvas, noise, b.x, b.y, b.rx, b.ry, rand, b.inWater);
  }

  // Painterly alpine grass tufts & shoreline sedges along the riverbanks and meadow.
  for (let i = 0; i < 110; i++) {
    const ny = mix(0.62, 0.97, Math.pow(rand(), 0.8));
    const { centerX, halfWidth } = riverGeometry(ny);
    const onBank = rand() < 0.55;
    const nx = onBank
      ? centerX + (rand() < 0.5 ? -1 : 1) * halfWidth * (1.02 + rand() * 0.45)
      : mix(0.38, 0.88, rand());
    if (!onBank && Math.abs(nx - centerX) < halfWidth * 1.05) continue;
    const gx = nx * WIDTH;
    const gy = ny * HEIGHT;
    const bladeH = mix(5, 19, (ny - 0.6) / 0.38) * (0.65 + rand() * 0.7);
    const isOchre = rand() < 0.35;
    const col: readonly [number, number, number] = isOchre
      ? [0.28, 0.27, 0.12]
      : [0.14, 0.24, 0.11];
    for (let b = 0; b < 4; b++) {
      const lean = (rand() - 0.5) * bladeH * 0.75;
      canvas.drawSegment(
        gx + (b - 1.5) * 2.2,
        gy,
        gx + lean,
        gy - bladeH,
        0.9,
        0.35,
        col,
        0.78,
      );
    }
  }

  // Clustered natural groves of midground spruce along the riverbanks & foothills.
  const midTrees: { x: number; y: number; h: number }[] = [];
  const clusters: readonly (readonly [number, number, number, number])[] = [
    [0.52, 0.62, 6, 36],
    [0.59, 0.61, 5, 42],
    [0.73, 0.62, 6, 48],
    [0.8, 0.69, 7, 74],
    [0.86, 0.62, 7, 66],
    [0.44, 0.68, 6, 54],
  ];
  for (const [cx, cy, count, baseH] of clusters) {
    for (let i = 0; i < count; i++) {
      const nx = cx + (rand() - 0.5) * 0.08;
      const ny = cy + (rand() - 0.5) * 0.06;
      const { centerX, halfWidth } = riverGeometry(ny);
      if (Math.abs(nx - centerX) < halfWidth * 1.18) continue;
      midTrees.push({
        x: nx * WIDTH,
        y: ny * HEIGHT,
        h: baseH * (0.62 + rand() * 0.72),
      });
    }
  }
  midTrees.sort((a, b) => a.y - b.y);
  for (const t of midTrees) {
    drawPineTree(
      canvas,
      t.x,
      t.y,
      t.h,
      0.21,
      [0.032, 0.068, 0.068],
      [0.085, 0.16, 0.125],
      0.95,
      rand,
    );
  }

  // Tiny warm trail lanterns along the outpost approach slope.
  for (const [lx, ly] of [
    [0.629, 0.621],
    [0.678, 0.626],
  ] as const) {
    canvas.drawGlow(WIDTH * lx, HEIGHT * ly, 10, 10, [1.0, 0.72, 0.3], 0.56);
    canvas.drawSoftEllipse(
      WIDTH * lx,
      HEIGHT * ly,
      1.5,
      1.5,
      [1.0, 0.9, 0.62],
      1,
    );
  }
}

/** Renders the bottom-right faceted mossy granite foreground outcrop. */
export function renderForegroundOutcrop(
  canvas: Canvas,
  noise: Noise2D,
  rand: () => number,
): void {
  const rightBank: Point[] = [
    [WIDTH * 0.56, HEIGHT * 1.01],
    [WIDTH * 0.64, HEIGHT * 0.88],
    [WIDTH * 0.72, HEIGHT * 0.82],
    [WIDTH * 0.8, HEIGHT * 0.78],
    [WIDTH * 0.87, HEIGHT * 0.7],
    [WIDTH * 0.95, HEIGHT * 0.65],
    [WIDTH * 1.01, HEIGHT * 0.63],
    [WIDTH * 1.01, HEIGHT * 1.01],
  ];
  canvas.fillPolygon(rightBank, (x, y, u, v) => {
    const h0 = noise.ridged(x * 0.02 + 3.1, y * 0.024 + 7.4, 4);
    const hx = noise.ridged((x + 3) * 0.02 + 3.1, y * 0.024 + 7.4, 3);
    const fine = noise.fbm(x * 0.07, y * 0.07, 3) * 0.5 + 0.5;
    const moss =
      smoothstep(0.4, 0.74, h0 * 0.62 + fine * 0.5) * smoothstep(0.86, 0.1, v);
    const rockLit = clamp(
      0.45 + (hx - h0) * 5.4 + (h0 - 0.5) * 0.55 - v * 0.2 - u * 0.08,
      0,
      1,
    );
    const r = mix(mix(0.03, 0.18, rockLit), 0.17, moss * 0.84);
    const g = mix(mix(0.045, 0.21, rockLit), 0.275, moss * 0.84);
    const b = mix(mix(0.055, 0.22, rockLit), 0.09, moss * 0.84);
    return [r, g, b, 1];
  });
  drawRockBoulder(
    canvas,
    noise,
    WIDTH * 0.72,
    HEIGHT * 0.9,
    134,
    74,
    rand,
    false,
  );
  drawRockBoulder(
    canvas,
    noise,
    WIDTH * 0.93,
    HEIGHT * 0.78,
    128,
    82,
    rand,
    false,
  );
}
