// Brutalist ARC frontier outpost perched on a fractured rocky cliff bluff,
// with stepped bunker wings, radar tower, glowing observation deck, and bridge.
import { clamp, HEIGHT, mix, smoothstep, WIDTH } from "./canvas.ts";

import type { Canvas, Noise2D, Point, Rgb } from "./canvas.ts";

export function renderArcOutpost(
  canvas: Canvas,
  noise: Noise2D,
  rand: () => number,
): void {
  // 1. Fractured granite bluff & stepped cliff ledges beneath the outpost.
  const bluff: Point[] = [
    [WIDTH * 0.432, HEIGHT * 0.622],
    [WIDTH * 0.454, HEIGHT * 0.548],
    [WIDTH * 0.484, HEIGHT * 0.533],
    [WIDTH * 0.74, HEIGHT * 0.534],
    [WIDTH * 0.77, HEIGHT * 0.578],
    [WIDTH * 0.75, HEIGHT * 0.628],
    [WIDTH * 0.632, HEIGHT * 0.644],
    [WIDTH * 0.514, HEIGHT * 0.636],
    [WIDTH * 0.438, HEIGHT * 0.63],
  ];
  canvas.fillPolygon(bluff, (x, y, _u, v) => {
    const nx = x / WIDTH;
    const ny = y / HEIGHT;
    const h0 = noise.ridged(nx * 46 + 4.2, ny * 52 + 1.8, 4);
    const hx = noise.ridged((nx + 0.002) * 46 + 4.2, ny * 52 + 1.8, 3);
    const strata = noise.fbm(nx * 18, ny * 85, 2) * 0.12;
    const cragLit = clamp(
      0.42 + (hx - h0) * 6.8 + (h0 - 0.5) * 0.6 + strata - v * 0.22,
      0,
      1,
    );
    const moss =
      smoothstep(0.45, 0.75, noise.fbm(nx * 30 + 9, ny * 30, 3) * 0.5 + 0.5) *
      smoothstep(0.6, 0.08, v);
    const r = mix(mix(0.055, 0.24, cragLit), 0.16, moss * 0.75);
    const g = mix(mix(0.08, 0.27, cragLit), 0.25, moss * 0.75);
    const b = mix(mix(0.095, 0.29, cragLit), 0.12, moss * 0.75);
    return [r, g, b, 1];
  });

  // Helper for weathered brutalist armor concrete/steel structures.
  const drawArmorBlock = (
    poly: readonly Point[],
    baseDark: Rgb,
    baseLight: Rgb,
    rimColor?: Rgb,
  ) => {
    canvas.fillPolygon(poly, (x, y, u, v) => {
      const grain = noise.fbm(x * 0.09, y * 0.09, 3) * 0.1;
      const stain = noise.fbm(x * 0.03 + 12, y * 0.08, 2) * 0.08;
      const hSeam = Math.abs(((y % 9) - 4.5) / 4.5) > 0.9 ? -0.06 : 0;
      const vSeam = Math.abs(((x % 20) - 10) / 10) > 0.94 ? -0.045 : 0;
      const shade = clamp(
        mix(0.84, 0.18, v) * mix(0.55, 1.0, u) + grain + stain + hSeam + vSeam,
        0,
        1,
      );
      return [
        mix(baseDark[0], baseLight[0], shade),
        mix(baseDark[1], baseLight[1], shade),
        mix(baseDark[2], baseLight[2], shade),
        1,
      ];
    });
    if (rimColor && poly.length >= 2) {
      canvas.drawSegment(
        poly[0]![0],
        poly[0]![1],
        poly[1]![0],
        poly[1]![1],
        1.0,
        1.0,
        rimColor,
        0.78,
      );
    }
  };

  // 2. Arched steel truss bridge connecting the ARC outpost to the Circle hillside.
  const bridgeY = HEIGHT * 0.534;
  const bX0 = WIDTH * 0.726;
  const bX1 = WIDTH * 0.842;
  // Underslung arch girder.
  canvas.drawCubicCurve(
    [bX0 + 16, bridgeY + 18],
    [mix(bX0, bX1, 0.35), bridgeY + 4],
    [mix(bX0, bX1, 0.65), bridgeY + 4],
    [bX1 - 12, bridgeY + 18],
    1.8,
    1.8,
    [0.14, 0.18, 0.2],
    [0.2, 0.24, 0.26],
    0.92,
    16,
  );
  canvas.drawSegment(
    bX0,
    bridgeY,
    bX1,
    bridgeY + 1,
    2.5,
    2.5,
    [0.22, 0.26, 0.28],
    0.96,
  );
  canvas.drawSegment(
    bX0,
    bridgeY - 3,
    bX1,
    bridgeY - 2,
    0.85,
    0.85,
    [0.46, 0.49, 0.46],
    0.82,
  );
  for (let i = 0; i <= 9; i++) {
    const t = i / 9;
    const bx = mix(bX0 + 14, bX1 - 10, t);
    const pillarH = 15 + Math.sin(t * Math.PI) * 18;
    canvas.drawSegment(
      bx,
      bridgeY + 1,
      bx,
      bridgeY + pillarH,
      1.3,
      1.8,
      [0.12, 0.16, 0.18],
      0.95,
    );
    if (i < 9) {
      const nx = mix(bX0 + 14, bX1 - 10, (i + 1) / 9);
      canvas.drawSegment(
        bx,
        bridgeY + 2,
        nx,
        bridgeY + 9,
        0.65,
        0.65,
        [0.18, 0.22, 0.24],
        0.78,
      );
      canvas.drawSegment(
        nx,
        bridgeY + 2,
        bx,
        bridgeY + 9,
        0.55,
        0.55,
        [0.16, 0.2, 0.22],
        0.65,
      );
    }
    if (i % 2 === 1) {
      canvas.drawGlow(bx, bridgeY - 2, 7.5, 5.5, [1.0, 0.74, 0.36], 0.46);
      canvas.drawSoftEllipse(
        bx,
        bridgeY - 2,
        1.2,
        1.2,
        [1.0, 0.92, 0.68],
        0.95,
      );
    }
  }

  // 3. Tall tapered radar & communications tower behind the main bunker.
  drawArmorBlock(
    [
      [WIDTH * 0.642, HEIGHT * 0.427],
      [WIDTH * 0.665, HEIGHT * 0.427],
      [WIDTH * 0.68, HEIGHT * 0.526],
      [WIDTH * 0.629, HEIGHT * 0.526],
    ],
    [0.095, 0.135, 0.165],
    [0.29, 0.35, 0.38],
    [0.48, 0.54, 0.57],
  );
  // Vertical structural ribs on tower pylon.
  canvas.drawSegment(
    WIDTH * 0.649,
    HEIGHT * 0.429,
    WIDTH * 0.644,
    HEIGHT * 0.522,
    1.2,
    1.5,
    [0.08, 0.11, 0.13],
    0.8,
  );
  canvas.drawSegment(
    WIDTH * 0.659,
    HEIGHT * 0.429,
    WIDTH * 0.665,
    HEIGHT * 0.522,
    1.2,
    1.5,
    [0.36, 0.42, 0.45],
    0.65,
  );

  // Tower observation collar & balcony railing.
  drawArmorBlock(
    [
      [WIDTH * 0.635, HEIGHT * 0.415],
      [WIDTH * 0.672, HEIGHT * 0.415],
      [WIDTH * 0.669, HEIGHT * 0.43],
      [WIDTH * 0.638, HEIGHT * 0.43],
    ],
    [0.12, 0.16, 0.19],
    [0.36, 0.42, 0.45],
    [0.58, 0.62, 0.6],
  );
  for (let i = 0; i < 5; i++) {
    const wx = mix(WIDTH * 0.641, WIDTH * 0.664, i / 4);
    canvas.drawSegment(
      wx,
      HEIGHT * 0.422,
      wx + 2.6,
      HEIGHT * 0.422,
      1.25,
      1.25,
      [1.0, 0.78, 0.4],
      0.94,
    );
  }
  canvas.drawGlow(
    WIDTH * 0.653,
    HEIGHT * 0.422,
    20,
    10,
    [1.0, 0.68, 0.28],
    0.4,
  );

  // Parabolic lattice radar dish atop the tower.
  const dishCx = WIDTH * 0.654;
  const dishCy = HEIGHT * 0.381;
  // Support truss & pedestal.
  canvas.drawSegment(
    dishCx - 5,
    HEIGHT * 0.415,
    dishCx - 2,
    dishCy + 7,
    1.6,
    1.2,
    [0.12, 0.16, 0.19],
    0.95,
  );
  canvas.drawSegment(
    dishCx + 5,
    HEIGHT * 0.415,
    dishCx + 2,
    dishCy + 7,
    1.6,
    1.2,
    [0.16, 0.21, 0.24],
    0.95,
  );
  const dishPts: Point[] = [];
  for (let i = 0; i <= 16; i++) {
    const a = mix(Math.PI * 0.11, Math.PI * 0.89, i / 16);
    dishPts.push([dishCx + Math.cos(a) * 33, dishCy + Math.sin(a) * 14.5 - 4]);
  }
  for (let i = 16; i >= 0; i--) {
    const a = mix(Math.PI * 0.11, Math.PI * 0.89, i / 16);
    dishPts.push([dishCx + Math.cos(a) * 29, dishCy + Math.sin(a) * 7.5 - 8.5]);
  }
  canvas.fillPolygon(dishPts, (_x, _y, u, v) => [
    mix(0.09, 0.29, u * 0.6 + (1 - v) * 0.4),
    mix(0.13, 0.34, u * 0.6 + (1 - v) * 0.4),
    mix(0.17, 0.38, u * 0.6 + (1 - v) * 0.4),
    0.92,
  ]);
  for (let i = -3; i <= 3; i++) {
    canvas.drawSegment(
      dishCx + i * 8,
      dishCy + 4,
      dishCx + i * 9.5,
      dishCy - 7,
      0.6,
      0.5,
      [0.36, 0.43, 0.47],
      0.74,
    );
  }
  canvas.drawCubicCurve(
    [dishCx - 32, dishCy - 1],
    [dishCx - 16, dishCy - 11.5],
    [dishCx + 16, dishCy - 11.5],
    [dishCx + 32, dishCy - 1],
    1.25,
    1.25,
    [0.36, 0.44, 0.49],
    [0.56, 0.62, 0.65],
    0.94,
  );
  canvas.drawSegment(
    dishCx - 19,
    dishCy + 2,
    dishCx,
    dishCy - 13,
    0.8,
    0.55,
    [0.28, 0.35, 0.39],
    0.92,
  );
  canvas.drawSegment(
    dishCx + 19,
    dishCy + 2,
    dishCx,
    dishCy - 13,
    0.8,
    0.55,
    [0.28, 0.35, 0.39],
    0.92,
  );
  canvas.drawSegment(
    dishCx,
    dishCy + 5,
    dishCx,
    dishCy - 14,
    1.0,
    0.7,
    [0.38, 0.45, 0.49],
    0.96,
  );

  // Twin comms masts with glowing red-orange aviation beacon.
  canvas.drawSegment(
    WIDTH * 0.668,
    HEIGHT * 0.418,
    WIDTH * 0.668,
    HEIGHT * 0.352,
    0.95,
    0.4,
    [0.24, 0.3, 0.34],
    0.92,
  );
  canvas.drawSegment(
    WIDTH * 0.665,
    HEIGHT * 0.372,
    WIDTH * 0.671,
    HEIGHT * 0.372,
    0.6,
    0.6,
    [0.26, 0.32, 0.36],
    0.85,
  );
  canvas.drawGlow(
    WIDTH * 0.668,
    HEIGHT * 0.352,
    9.5,
    9.5,
    [1.0, 0.44, 0.2],
    0.92,
  );
  canvas.drawSoftEllipse(
    WIDTH * 0.668,
    HEIGHT * 0.352,
    1.8,
    1.8,
    [1.0, 0.86, 0.6],
    1,
  );

  // 4. Stepped left wing barracks, roof vents, and antenna masts.
  drawArmorBlock(
    [
      [WIDTH * 0.49, HEIGHT * 0.502],
      [WIDTH * 0.562, HEIGHT * 0.5],
      [WIDTH * 0.562, HEIGHT * 0.537],
      [WIDTH * 0.482, HEIGHT * 0.537],
    ],
    [0.09, 0.125, 0.155],
    [0.25, 0.3, 0.33],
    [0.42, 0.48, 0.51],
  );
  drawArmorBlock(
    [
      [WIDTH * 0.516, HEIGHT * 0.483],
      [WIDTH * 0.568, HEIGHT * 0.483],
      [WIDTH * 0.573, HEIGHT * 0.506],
      [WIDTH * 0.51, HEIGHT * 0.506],
    ],
    [0.11, 0.15, 0.18],
    [0.29, 0.35, 0.38],
    [0.48, 0.54, 0.57],
  );
  // Roof cooling unit & masts on left wing.
  drawArmorBlock(
    [
      [WIDTH * 0.534, HEIGHT * 0.474],
      [WIDTH * 0.556, HEIGHT * 0.474],
      [WIDTH * 0.558, HEIGHT * 0.484],
      [WIDTH * 0.532, HEIGHT * 0.484],
    ],
    [0.1, 0.14, 0.17],
    [0.26, 0.32, 0.35],
    [0.46, 0.52, 0.55],
  );
  canvas.drawSegment(
    WIDTH * 0.528,
    HEIGHT * 0.502,
    WIDTH * 0.528,
    HEIGHT * 0.45,
    1.0,
    0.4,
    [0.22, 0.27, 0.3],
    0.9,
  );
  canvas.drawSegment(
    WIDTH * 0.591,
    HEIGHT * 0.448,
    WIDTH * 0.591,
    HEIGHT * 0.4,
    0.9,
    0.4,
    [0.24, 0.3, 0.34],
    0.9,
  );
  canvas.drawSegment(
    WIDTH * 0.602,
    HEIGHT * 0.436,
    WIDTH * 0.602,
    HEIGHT * 0.412,
    0.75,
    0.35,
    [0.26, 0.32, 0.36],
    0.85,
  );

  // 5. Main central sloped Command Center bunker + roof superstructure + armored buttresses.
  drawArmorBlock(
    [
      [WIDTH * 0.59, HEIGHT * 0.435],
      [WIDTH * 0.627, HEIGHT * 0.435],
      [WIDTH * 0.632, HEIGHT * 0.449],
      [WIDTH * 0.584, HEIGHT * 0.449],
    ],
    [0.12, 0.16, 0.19],
    [0.33, 0.39, 0.42],
    [0.54, 0.6, 0.62],
  );
  drawArmorBlock(
    [
      [WIDTH * 0.578, HEIGHT * 0.446],
      [WIDTH * 0.636, HEIGHT * 0.446],
      [WIDTH * 0.674, HEIGHT * 0.537],
      [WIDTH * 0.547, HEIGHT * 0.537],
    ],
    [0.1, 0.14, 0.17],
    [0.31, 0.37, 0.4],
    [0.52, 0.58, 0.6],
  );
  // Sloped armor ribs flanking the central command bay.
  drawArmorBlock(
    [
      [WIDTH * 0.572, HEIGHT * 0.452],
      [WIDTH * 0.583, HEIGHT * 0.452],
      [WIDTH * 0.561, HEIGHT * 0.537],
      [WIDTH * 0.545, HEIGHT * 0.537],
    ],
    [0.14, 0.18, 0.21],
    [0.35, 0.41, 0.44],
    [0.54, 0.59, 0.6],
  );
  drawArmorBlock(
    [
      [WIDTH * 0.633, HEIGHT * 0.446],
      [WIDTH * 0.648, HEIGHT * 0.45],
      [WIDTH * 0.679, HEIGHT * 0.537],
      [WIDTH * 0.658, HEIGHT * 0.537],
    ],
    [0.17, 0.21, 0.24],
    [0.4, 0.46, 0.48],
    [0.62, 0.66, 0.64],
  );
  // Right lower apron, retaining wall, and vehicle bay.
  drawArmorBlock(
    [
      [WIDTH * 0.668, HEIGHT * 0.498],
      [WIDTH * 0.727, HEIGHT * 0.502],
      [WIDTH * 0.742, HEIGHT * 0.545],
      [WIDTH * 0.664, HEIGHT * 0.545],
    ],
    [0.1, 0.14, 0.16],
    [0.28, 0.33, 0.36],
    [0.48, 0.52, 0.52],
  );
  // Lower concrete retaining foundation wall gripping the cliff edge.
  drawArmorBlock(
    [
      [WIDTH * 0.544, HEIGHT * 0.534],
      [WIDTH * 0.736, HEIGHT * 0.538],
      [WIDTH * 0.738, HEIGHT * 0.556],
      [WIDTH * 0.54, HEIGHT * 0.55],
    ],
    [0.07, 0.1, 0.12],
    [0.2, 0.25, 0.27],
    [0.38, 0.44, 0.45],
  );

  // 6. Overhanging armored brow, recessed louver vents, and glowing observation deck.
  const winY0 = HEIGHT * 0.489;
  const winY1 = HEIGHT * 0.503;
  const winX0 = WIDTH * 0.581;
  const winX1 = WIDTH * 0.633;
  // Armored brow overhang & cast shadow above observation windows.
  drawArmorBlock(
    [
      [winX0 - 9, winY0 - 9],
      [winX1 + 9, winY0 - 9],
      [winX1 + 11, winY0 - 3],
      [winX0 - 11, winY0 - 3],
    ],
    [0.08, 0.11, 0.14],
    [0.24, 0.3, 0.33],
    [0.5, 0.56, 0.58],
  );
  // Dark structural panel ribs & recessed exhaust louvers below observation bay.
  for (let i = 0; i < 6; i++) {
    const lx = mix(winX0 - 6, winX1 + 6, i / 5);
    canvas.drawSegment(
      lx,
      winY1 + 5,
      lx + (i - 2.5) * 1.2,
      HEIGHT * 0.534,
      1.3,
      1.6,
      [0.07, 0.1, 0.12],
      0.78,
    );
  }
  // Recessed dark window frame.
  canvas.fillPolygon(
    [
      [winX0 - 4, winY0 - 3],
      [winX1 + 4, winY0 - 3],
      [winX1 + 6, winY1 + 3],
      [winX0 - 6, winY1 + 3],
    ],
    () => [0.05, 0.07, 0.08, 0.96],
  );
  const paneCount = 8;
  for (let i = 0; i < paneCount; i++) {
    const px0 = mix(winX0, winX1, i / paneCount) + 1.3;
    const px1 = mix(winX0, winX1, (i + 1) / paneCount) - 1.3;
    const brightness = 0.74 + rand() * 0.26;
    canvas.fillPolygon(
      [
        [px0, winY0],
        [px1, winY0],
        [px1, winY1],
        [px0, winY1],
      ],
      (_x, _y, _u, v) => [
        brightness * mix(1.0, 0.92, v),
        brightness * mix(0.84, 0.56, v),
        brightness * mix(0.45, 0.2, v),
        1,
      ],
    );
  }
  canvas.drawGlow(
    (winX0 + winX1) * 0.5,
    (winY0 + winY1) * 0.5,
    78,
    32,
    [1.0, 0.68, 0.26],
    0.48,
  );
  // Warm light spilling down onto the sloped apron and cliff ledge below.
  canvas.drawGlow(
    (winX0 + winX1) * 0.5,
    winY1 + 20,
    66,
    18,
    [1.0, 0.64, 0.24],
    0.2,
  );

  const smallLights: readonly (readonly [number, number, number, number])[] = [
    [0.505, 0.517, 9, 3],
    [0.516, 0.517, 7, 3],
    [0.538, 0.495, 8, 2.5],
    [0.659, 0.52, 7, 5],
    [0.696, 0.52, 12, 3],
    [0.723, 0.562, 4, 4],
  ];
  for (const [lx, ly, lw, lh] of smallLights) {
    const cx = WIDTH * lx;
    const cy = HEIGHT * ly;
    canvas.fillPolygon(
      [
        [cx - lw * 0.5, cy - lh * 0.5],
        [cx + lw * 0.5, cy - lh * 0.5],
        [cx + lw * 0.5, cy + lh * 0.5],
        [cx - lw * 0.5, cy + lh * 0.5],
      ],
      () => [1.0, 0.76, 0.36, 0.95],
    );
    canvas.drawGlow(cx, cy, lw * 2.5, lh * 3.5 + 8, [1.0, 0.65, 0.24], 0.38);
  }
}
