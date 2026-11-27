// Organic Circle Heartgrove: interwoven bone-wood living canopy tree,
// vaulted warm interior glow, cyan root bioluminescence, and grounded dome pods.
import { clamp, HEIGHT, mix, smoothstep, WIDTH } from "./canvas.ts";
import { drawPineTree } from "./trees.ts";

import type { Canvas, Noise2D, Point, Rgb } from "./canvas.ts";

export function renderCircleHeartgrove(
  canvas: Canvas,
  noise: Noise2D,
  rand: () => number,
): void {
  const cx = WIDTH * 0.885;
  const baseY = HEIGHT * 0.53;
  const canopyY = HEIGHT * 0.372;

  // 1. Dense spruce grove framing behind the Heartgrove.
  for (let i = 0; i < 30; i++) {
    const tx = mix(WIDTH * 0.71, WIDTH * 0.99, i / 29) + (rand() - 0.5) * 14;
    const ty =
      HEIGHT * (0.5 - smoothstep(0.72, 0.98, tx / WIDTH) * 0.065) + rand() * 18;
    const th = 38 + rand() * 56;
    drawPineTree(
      canvas,
      tx,
      ty,
      th,
      0.22,
      [0.045, 0.1, 0.1],
      [0.11, 0.2, 0.18],
      0.94,
      rand,
    );
  }

  // 2. Mossy rocky hillside terrace grounding the Heartgrove and its pods.
  const terrace: Point[] = [
    [WIDTH * 0.75, HEIGHT * 0.545],
    [WIDTH * 0.785, HEIGHT * 0.482],
    [WIDTH * 0.845, HEIGHT * 0.468],
    [WIDTH * 0.915, HEIGHT * 0.458],
    [WIDTH * 0.995, HEIGHT * 0.448],
    [WIDTH * 1.01, HEIGHT * 0.595],
    [WIDTH * 0.85, HEIGHT * 0.585],
    [WIDTH * 0.76, HEIGHT * 0.568],
  ];
  canvas.fillPolygon(terrace, (x, y, _u, v) => {
    const crag = noise.ridged(x * 0.025 + 6, y * 0.03 + 2, 3);
    const moss = smoothstep(0.32, 0.75, crag) * smoothstep(0.85, 0.1, v);
    return [
      mix(0.06, 0.16, moss),
      mix(0.1, 0.25, moss),
      mix(0.09, 0.14, moss),
      1,
    ];
  });

  // 3. Warm interior canopy luminescence + cyan bioluminescence in the root hollows.
  canvas.drawGlow(cx, canopyY + 26, 138, 62, [0.98, 0.82, 0.5], 0.45, 2.0);
  canvas.drawGlow(cx + 6, canopyY + 14, 74, 34, [1.0, 0.91, 0.68], 0.48, 2.2);
  canvas.drawGlow(cx - 10, baseY - 26, 80, 38, [0.22, 0.88, 0.8], 0.38, 2.1);
  canvas.drawGlow(cx + 30, baseY - 36, 54, 28, [0.26, 0.92, 0.8], 0.34, 2.0);

  // 4. Sculpted organic umbrella canopy with scalloped lobes & glowing radial venation.
  const canopyPts: Point[] = [];
  const topSteps = 22;
  for (let i = 0; i <= topSteps; i++) {
    const t = i / topSteps;
    const px = mix(WIDTH * 0.755, WIDTH * 0.998, t);
    const arch = Math.sin(t * Math.PI);
    const scallop = Math.sin(t * Math.PI * 9) * 3.2;
    const py = HEIGHT * (0.386 - arch * 0.053 - t * 0.014) + scallop;
    canopyPts.push([px, py]);
  }
  for (let i = topSteps; i >= 0; i--) {
    const t = i / topSteps;
    const px = mix(WIDTH * 0.76, WIDTH * 0.994, t);
    const arch = Math.sin(t * Math.PI);
    const py = HEIGHT * (0.39 + arch * 0.02 - t * 0.006);
    canopyPts.push([px, py]);
  }
  canvas.fillPolygon(canopyPts, (x, y, u, v) => {
    const n = noise.fbm(x * 0.045, y * 0.065, 4) * 0.5 + 0.5;
    const fine = noise.ridged(x * 0.08 + 4, y * 0.09, 3);
    const under = smoothstep(0.28, 0.88, v);
    const domeTop = smoothstep(0.56, 0.04, v);
    const radialLit = 1 - Math.abs(u - 0.52) * 1.04;

    // Fan-shaped organic ribs radiating from the central trunk crown apex.
    const ang = Math.atan2((y - (canopyY + 58)) * 1.8, x - cx);
    const radialRib = Math.pow(
      Math.abs(Math.sin(ang * 13 + (n - 0.5) * 1.1)),
      7,
    );
    const rimGlow = smoothstep(0.72, 0.94, v) * 0.28;

    let r =
      mix(0.22, 0.82, under * radialLit) + domeTop * (0.24 * n + 0.08 * fine);
    let g =
      mix(0.29, 0.78, under * radialLit) + domeTop * (0.27 * n + 0.09 * fine);
    let b =
      mix(0.29, 0.58, under * radialLit) + domeTop * (0.24 * n + 0.08 * fine);
    const filigree = clamp(radialRib * 0.34 + rimGlow, 0, 0.44);
    r = mix(r, 0.92, filigree);
    g = mix(g, 0.88, filigree);
    b = mix(b, 0.73, filigree * 0.85);
    return [clamp(r, 0, 1), clamp(g, 0, 1), clamp(b, 0, 1), 0.97];
  });
  // Crisp sculpted rim highlight along the scalloped canopy crest.
  for (let i = 0; i < topSteps; i++) {
    const a = canopyPts[i]!;
    const b = canopyPts[i + 1]!;
    canvas.drawSegment(
      a[0],
      a[1],
      b[0],
      b[1],
      1.4,
      1.4,
      [0.74, 0.8, 0.76],
      0.75,
    );
  }

  // 5. Interwoven, twisting organic bone-wood trunk ribs & sprawling buttress roots.
  const ribs: readonly (readonly [
    number,
    number,
    number,
    number,
    number,
    number,
  ])[] = [
    [-156, -54, -82, -172, 4.0, 2.0],
    [-118, -32, -50, -126, 5.2, 2.5],
    [-82, -10, -34, -84, 5.8, 2.8],
    [-48, 10, -24, -42, 6.2, 3.0],
    [-16, -24, 14, -6, 6.4, 3.1],
    [14, 24, -12, 26, 6.4, 3.0],
    [46, -8, 28, 60, 5.8, 2.7],
    [80, 18, 46, 98, 5.2, 2.4],
    [114, 42, 74, 140, 4.4, 2.0],
    [142, 58, 96, 174, 3.6, 1.8],
  ];

  // Rear shaded branches for 3D lattice depth.
  for (const [rx, c1x, c2x, tx, bT, tT] of ribs) {
    canvas.drawCubicCurve(
      [cx + rx * 0.88, baseY + 6],
      [cx + c1x * 0.9, mix(baseY, canopyY, 0.35)],
      [cx + c2x * 0.9, mix(baseY, canopyY, 0.72)],
      [cx + tx * 0.92, canopyY + 14],
      bT * 1.15,
      tT * 1.1,
      [0.09, 0.14, 0.13],
      [0.24, 0.28, 0.24],
      0.92,
      20,
    );
  }
  // Lit ivory-wood foreground ribs + canopy arch forks + bright inner rim highlight.
  for (let i = 0; i < ribs.length; i++) {
    const [rx, c1x, c2x, tx, bT, tT] = ribs[i]!;
    const centerWarm = 1 - Math.abs(i / (ribs.length - 1) - 0.5) * 1.5;
    const baseCol: Rgb = [
      mix(0.3, 0.55, Math.max(0, centerWarm)),
      mix(0.36, 0.59, Math.max(0, centerWarm)),
      mix(0.32, 0.49, Math.max(0, centerWarm)),
    ];
    const topCol: Rgb = [
      mix(0.58, 0.92, Math.max(0, centerWarm)),
      mix(0.62, 0.88, Math.max(0, centerWarm)),
      mix(0.52, 0.7, Math.max(0, centerWarm)),
    ];
    canvas.drawCubicCurve(
      [cx + rx, baseY + 4],
      [cx + c1x, mix(baseY, canopyY, 0.36)],
      [cx + c2x, mix(baseY, canopyY, 0.72)],
      [cx + tx, canopyY + 10],
      bT * 0.75,
      tT * 0.78,
      baseCol,
      topCol,
      0.95,
      22,
    );
    // Fine bright bark rim along the lit side of each rib.
    canvas.drawCubicCurve(
      [cx + rx + 1.5, baseY + 4],
      [cx + c1x + 1.5, mix(baseY, canopyY, 0.36)],
      [cx + c2x + 1.2, mix(baseY, canopyY, 0.72)],
      [cx + tx + 1, canopyY + 10],
      bT * 0.24,
      tT * 0.28,
      [0.54, 0.62, 0.58],
      [0.95, 0.92, 0.78],
      0.55,
      18,
    );
    // Secondary branching fork flaring under the vaulted canopy.
    canvas.drawCubicCurve(
      [cx + c2x * 0.85, mix(baseY, canopyY, 0.66)],
      [cx + (c2x + tx) * 0.5, mix(baseY, canopyY, 0.82)],
      [cx + tx * 0.82, canopyY + 16],
      [cx + tx * 0.66, canopyY + 12],
      tT * 0.78,
      tT * 0.4,
      topCol,
      topCol,
      0.86,
      12,
    );
  }

  // Cyan bioluminescent spore clusters & drifting twilight motes around the roots.
  const cyanNodes: readonly Point[] = [
    [cx - 56, baseY - 16],
    [cx - 20, baseY - 34],
    [cx + 6, baseY - 22],
    [cx + 36, baseY - 40],
    [cx - 92, baseY - 10],
    [cx + 58, baseY - 14],
    [cx - 34, baseY - 10],
    [cx - 4, baseY - 52],
  ];
  for (const [nx, ny] of cyanNodes) {
    canvas.drawGlow(nx, ny, 18, 15, [0.24, 0.94, 0.88], 0.5);
    canvas.drawSoftEllipse(nx, ny, 3.0, 2.2, [0.72, 1.0, 0.97], 0.94);
  }
  for (let i = 0; i < 16; i++) {
    const mx = cx + (rand() - 0.5) * 240;
    const my = mix(canopyY + 18, baseY - 4, rand());
    const isCyan = rand() > 0.45;
    const moteCol: Rgb = isCyan ? [0.45, 0.98, 0.92] : [1.0, 0.88, 0.58];
    canvas.drawGlow(mx, my, 5.5, 5.5, moteCol, 0.42);
    canvas.drawSoftEllipse(mx, my, 1.2, 1.2, moteCol, 0.9);
  }

  // 6. Grounded glowing organic sanctuary dome pods sitting on the hillside terrace.
  const drawPod = (px: number, py: number, scale: number) => {
    const w = 34 * scale;
    const h = 15 * scale;
    canvas.drawSoftEllipse(
      px,
      py + h * 0.62,
      w * 0.82,
      h * 0.36,
      [0.03, 0.06, 0.05],
      0.8,
      1.3,
    );
    canvas.drawGlow(
      px,
      py + h * 0.15,
      w * 1.2,
      h * 1.3,
      [1.0, 0.78, 0.4],
      0.48,
    );
    canvas.fillPolygon(
      [
        [px - w * 0.46, py - h * 0.08],
        [px + w * 0.46, py - h * 0.08],
        [px + w * 0.42, py + h * 0.56],
        [px - w * 0.42, py + h * 0.56],
      ],
      (_x, _y, _u, v) => [
        mix(0.98, 0.56, v),
        mix(0.78, 0.42, v),
        mix(0.38, 0.2, v),
        0.96,
      ],
    );
    canvas.fillPolygon(
      [
        [px - w * 0.78, py + h * 0.06],
        [px - w * 0.44, py - h * 0.56],
        [px, py - h * 0.8],
        [px + w * 0.44, py - h * 0.56],
        [px + w * 0.78, py + h * 0.06],
      ],
      (_x, _y, u, v) => [
        mix(0.28, 0.6, (1 - v) * 0.7 + u * 0.3),
        mix(0.34, 0.64, (1 - v) * 0.7 + u * 0.3),
        mix(0.3, 0.54, (1 - v) * 0.7 + u * 0.3),
        0.98,
      ],
    );
    // Scalloped rim & arched doorway mullions.
    canvas.drawSegment(
      px - w * 0.76,
      py + h * 0.05,
      px + w * 0.76,
      py + h * 0.05,
      1.1 * scale,
      1.1 * scale,
      [0.64, 0.68, 0.58],
      0.8,
    );
    for (const dx of [-0.28, 0, 0.28]) {
      canvas.drawSegment(
        px + dx * w,
        py - h * 0.05,
        px + dx * w * 1.05,
        py + h * 0.56,
        1.1 * scale,
        1.1 * scale,
        [0.16, 0.2, 0.18],
        0.9,
      );
    }
  };
  drawPod(WIDTH * 0.808, HEIGHT * 0.474, 1.02);
  drawPod(WIDTH * 0.942, HEIGHT * 0.448, 1.14);
  drawPod(WIDTH * 0.902, HEIGHT * 0.492, 0.82);
}
