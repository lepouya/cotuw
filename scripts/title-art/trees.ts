// Painterly alpine spruce trees, mossy shrubs, foreground ferns, and wildflowers.
import { clamp, HEIGHT, mix, mixRgb, smoothstep, WIDTH } from "./canvas.ts";

import type { Canvas, Noise2D, Rgb } from "./canvas.ts";

/** Draws an organic alpine spruce with drooping boughs and bushy needle clusters. */
export function drawPineTree(
  canvas: Canvas,
  baseX: number,
  baseY: number,
  height: number,
  widthRatio: number,
  darkColor: Rgb,
  lightColor: Rgb,
  alpha: number,
  rand: () => number,
): void {
  const lean = (rand() - 0.5) * height * 0.028;
  const trunkW = Math.max(0.7, height * 0.019);
  canvas.drawSegment(
    baseX,
    baseY,
    baseX + lean,
    baseY - height * 0.94,
    trunkW,
    Math.max(0.35, trunkW * 0.22),
    darkColor,
    alpha,
  );

  const tiers = Math.max(7, Math.min(56, Math.floor(height * 0.29)));
  for (let i = 0; i < tiers; i++) {
    const t = i / (tiers - 1);
    if (height > 80 && t > 0.18 && t < 0.85 && rand() < 0.07) continue;

    const ty = baseY - height * (0.06 + t * 0.91);
    const tx = baseX + lean * t;
    const envelope = Math.pow(1 - t, 0.83) * (0.72 + 0.52 * rand());
    const halfW = height * widthRatio * envelope;
    const droop = halfW * (0.24 + (1 - t) * 0.18);
    const thickness = Math.max(0.95, height * 0.017 * (1 - t * 0.45));
    const lit = smoothstep(0.15, 0.92, t) * 0.62;

    // Dense central foliage mass so tall foreground trees never look skeletal.
    if (height > 100 && i % 2 === 0) {
      canvas.drawSoftEllipse(
        tx,
        ty + droop * 0.2,
        halfW * 0.42,
        thickness * 2.4,
        mixRgb(darkColor, lightColor, lit * 0.3),
        alpha * 0.65,
        1.3,
      );
    }

    for (const dir of [-1, 1] as const) {
      const sideScale = 0.68 + rand() * 0.58;
      const tipX = tx + dir * halfW * sideScale;
      const tipY = ty + droop * (0.45 + rand() * 0.65);
      const sideLit = dir > 0 ? lit * 0.88 : lit * 0.22;
      const boughColor = mixRgb(darkColor, lightColor, sideLit);
      canvas.drawSegment(
        tx,
        ty,
        tipX,
        tipY,
        thickness,
        Math.max(0.5, thickness * 0.35),
        boughColor,
        alpha * (0.88 + rand() * 0.12),
      );

      const subCount = height > 180 ? 6 : height > 60 ? 3 : height > 24 ? 2 : 1;
      for (let s = 1; s <= subCount; s++) {
        const st = (s - 0.15 + rand() * 0.25) / (subCount + 0.15);
        const sx = mix(tx, tipX, clamp(st, 0, 1));
        const sy = mix(ty, tipY, clamp(st, 0, 1));
        const subLen = halfW * (0.23 + rand() * 0.16) * (1 - st * 0.28);
        const angleSpread = (rand() - 0.3) * 0.5;
        canvas.drawSegment(
          sx,
          sy,
          sx + dir * subLen * (0.55 + angleSpread),
          sy + subLen * (0.74 + rand() * 0.35),
          thickness * 0.88,
          0.45,
          boughColor,
          alpha * 0.9,
        );
        if (height > 110) {
          canvas.drawSoftEllipse(
            sx + dir * subLen * 0.22,
            sy + subLen * 0.26,
            thickness * 2.2,
            thickness * 1.45,
            boughColor,
            alpha * 0.52,
            1.4,
          );
        }
      }
    }
  }
  canvas.drawSegment(
    baseX + lean * 0.92,
    baseY - height * 0.9,
    baseX + lean,
    baseY - height * 1.03,
    Math.max(0.7, height * 0.011),
    0.3,
    lightColor,
    alpha,
  );
}

/** Draws a delicate arching fern frond with paired pinnae leaflets. */
function drawFern(
  canvas: Canvas,
  baseX: number,
  baseY: number,
  length: number,
  angle: number,
  curve: number,
  color: Rgb,
): void {
  const steps = 20;
  let prevX = baseX;
  let prevY = baseY;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const a = angle + curve * t;
    const nx = prevX + (Math.cos(a) * length) / steps;
    const ny = prevY + (Math.sin(a) * length) / steps;
    canvas.drawSegment(
      prevX,
      prevY,
      nx,
      ny,
      1.25 * (1 - t * 0.6),
      0.9 * (1 - t * 0.6),
      color,
      0.92,
    );
    const leafLen = Math.sin(t * Math.PI) * length * 0.24;
    if (leafLen > 1.4) {
      const tipLit = 1.05 + t * 0.25;
      const leafCol: Rgb = [
        color[0] * tipLit,
        color[1] * (tipLit + 0.05),
        color[2] * 1.05,
      ];
      for (const side of [-1, 1] as const) {
        const la = a + side * 1.12;
        canvas.drawSegment(
          nx,
          ny,
          nx + Math.cos(la) * leafLen,
          ny + Math.sin(la) * leafLen,
          1.35 * (1 - t * 0.42),
          0.38,
          leafCol,
          0.9,
        );
      }
    }
    prevX = nx;
    prevY = ny;
  }
}

/** Renders the dark framing pines on both edges, bottom-right foliage, and left mist veil. */
export function renderForegroundForest(
  canvas: Canvas,
  noise: Noise2D,
  rand: () => number,
): void {
  // 1. Tall framing spruce silhouettes on the far right edge.
  drawPineTree(
    canvas,
    WIDTH * 0.962,
    HEIGHT * 0.74,
    510,
    0.15,
    [0.018, 0.048, 0.055],
    [0.055, 0.115, 0.095],
    0.98,
    rand,
  );
  drawPineTree(
    canvas,
    WIDTH * 0.992,
    HEIGHT * 0.72,
    580,
    0.16,
    [0.015, 0.04, 0.048],
    [0.048, 0.095, 0.085],
    0.98,
    rand,
  );
  drawPineTree(
    canvas,
    WIDTH * 0.922,
    HEIGHT * 0.7,
    290,
    0.18,
    [0.028, 0.068, 0.068],
    [0.075, 0.145, 0.115],
    0.96,
    rand,
  );

  // 2. Foreground fern fronds & alpine wildflower clusters in the bottom-right corner.
  const fernBases: readonly (readonly [
    number,
    number,
    number,
    number,
    number,
  ])[] = [
    [0.832, 0.995, 145, -1.96, 0.48],
    [0.855, 0.995, 132, -1.48, -0.34],
    [0.885, 0.985, 122, -1.16, 0.32],
    [0.81, 0.995, 104, -2.26, 0.36],
    [0.952, 0.965, 118, -1.86, 0.36],
    [0.785, 0.998, 86, -1.68, -0.25],
  ];
  for (const [fx, fy, len, ang, crv] of fernBases) {
    drawFern(
      canvas,
      WIDTH * fx,
      HEIGHT * fy,
      len,
      ang,
      crv,
      [0.14, 0.26, 0.095],
    );
  }
  for (let i = 0; i < 18; i++) {
    const wx = mix(WIDTH * 0.89, WIDTH * 0.995, rand());
    const wy = mix(HEIGHT * 0.865, HEIGHT * 0.985, rand());
    canvas.drawSegment(
      wx,
      wy + 28,
      wx,
      wy,
      1.0,
      0.65,
      [0.09, 0.17, 0.09],
      0.86,
    );
    for (let p = 0; p < 6; p++) {
      canvas.drawSoftEllipse(
        wx + (rand() - 0.5) * 13,
        wy + (rand() - 0.5) * 9,
        2.4,
        2.0,
        [0.66, 0.78, 0.74],
        0.82,
      );
    }
  }

  // 3. Left-side feathery foreground spruce silhouettes & deep teal mist veil for title UI.
  const leftPines: readonly (readonly [
    number,
    number,
    number,
    number,
    number,
  ])[] = [
    [0.34, 0.66, 250, 0.16, 0.72],
    [0.3, 0.78, 560, 0.155, 0.88],
    [0.245, 0.9, 820, 0.165, 0.95],
    [0.165, 0.98, 890, 0.195, 0.98],
    [0.08, 1.02, 840, 0.215, 0.99],
  ];
  for (const [px, py, ph, wr, a] of leftPines) {
    drawPineTree(
      canvas,
      WIDTH * px,
      HEIGHT * py,
      ph,
      wr,
      [0.02, 0.052, 0.06],
      [0.05, 0.105, 0.112],
      a,
      rand,
    );
  }

  // Deep twilight mist & dark teal-slate vignette sweeping over the left third.
  for (let y = 0; y < HEIGHT; y++) {
    const ny = y / HEIGHT;
    for (let x = 0; x < WIDTH * 0.48; x++) {
      const nx = x / WIDTH;
      const veil = smoothstep(0.44, 0.02, nx + Math.sin(ny * 3.1) * 0.04);
      const mistN = noise.fbm(nx * 5.2 + 19, ny * 6.4 + 3.2, 4) * 0.5 + 0.5;
      const darkVeil =
        Math.pow(veil, 1.5) * mix(0.74, 0.96, smoothstep(0.18, 0.82, ny));
      const r = mix(0.026, 0.072, mistN * (1 - veil * 0.6));
      const g = mix(0.062, 0.132, mistN * (1 - veil * 0.6));
      const b = mix(0.08, 0.152, mistN * (1 - veil * 0.6));
      canvas.blend(x, y, r, g, b, darkVeil);
    }
  }
}
