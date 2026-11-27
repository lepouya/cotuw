// Shared canvas, deterministic noise, and painterly drawing primitives for the
// procedural frontier title art.
import { PNG } from "pngjs";

import { seededRandom } from "../sprite-sheet.ts";

export const WIDTH = 1600;
export const HEIGHT = 900;

export type Rgb = readonly [number, number, number];
export type Point = readonly [number, number];

export const clamp = (value: number, min: number, max: number) =>
  value < min ? min : value > max ? max : value;

export const mix = (a: number, b: number, t: number) => a + (b - a) * t;

export const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

export const mixRgb = (a: Rgb, b: Rgb, t: number): Rgb => [
  mix(a[0], b[0], t),
  mix(a[1], b[1], t),
  mix(a[2], b[2], t),
];

/** Fast deterministic 2D gradient noise, fBm, and ridged multifractal noise. */
export class Noise2D {
  private readonly perm = new Uint8Array(512);
  private readonly gradX = new Float32Array(256);
  private readonly gradY = new Float32Array(256);

  constructor(seed: number) {
    const rand = seededRandom(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      p[i] = i;
      const angle = rand() * Math.PI * 2;
      this.gradX[i] = Math.cos(angle);
      this.gradY[i] = Math.sin(angle);
    }
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const tmp = p[i]!;
      p[i] = p[j]!;
      p[j] = tmp;
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255]!;
  }

  sample(x: number, y: number): number {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
    const v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
    const x0 = ix & 255;
    const y0 = iy & 255;
    const perm = this.perm;
    const gx = this.gradX;
    const gy = this.gradY;

    const aa = perm[perm[x0]! + y0]!;
    const ba = perm[perm[x0 + 1]! + y0]!;
    const ab = perm[perm[x0]! + y0 + 1]!;
    const bb = perm[perm[x0 + 1]! + y0 + 1]!;

    const n00 = gx[aa]! * fx + gy[aa]! * fy;
    const n10 = gx[ba]! * (fx - 1) + gy[ba]! * fy;
    const n01 = gx[ab]! * fx + gy[ab]! * (fy - 1);
    const n11 = gx[bb]! * (fx - 1) + gy[bb]! * (fy - 1);
    return mix(mix(n00, n10, u), mix(n01, n11, u), v);
  }

  fbm(
    x: number,
    y: number,
    octaves: number,
    lacunarity = 2.04,
    gain = 0.5,
  ): number {
    let sum = 0;
    let amp = 0.5;
    let freq = 1;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += this.sample(x * freq, y * freq) * amp;
      norm += amp;
      freq *= lacunarity;
      amp *= gain;
    }
    return sum / norm;
  }

  ridged(x: number, y: number, octaves: number): number {
    let sum = 0;
    let amp = 0.5;
    let freq = 1;
    let weight = 1;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      let signal = 1 - Math.abs(this.sample(x * freq, y * freq) * 1.55);
      signal = clamp(signal, 0, 1);
      signal *= signal * weight;
      weight = clamp(signal * 1.9, 0.15, 1);
      sum += signal * amp;
      norm += amp;
      freq *= 2.12;
      amp *= 0.5;
    }
    return sum / norm;
  }
}

/** Float RGB canvas with alpha blending, additive glow, and vector primitives. */
export class Canvas {
  readonly width: number;
  readonly height: number;
  readonly data: Float32Array;

  constructor(width = WIDTH, height = HEIGHT) {
    this.width = width;
    this.height = height;
    this.data = new Float32Array(width * height * 3);
  }

  blend(
    x: number,
    y: number,
    r: number,
    g: number,
    b: number,
    a: number,
  ): void {
    if (a <= 0 || x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const alpha = a > 1 ? 1 : a;
    const i = (y * this.width + x) * 3;
    const keep = 1 - alpha;
    this.data[i] = this.data[i]! * keep + r * alpha;
    this.data[i + 1] = this.data[i + 1]! * keep + g * alpha;
    this.data[i + 2] = this.data[i + 2]! * keep + b * alpha;
  }

  add(
    x: number,
    y: number,
    r: number,
    g: number,
    b: number,
    strength: number,
  ): void {
    if (strength <= 0 || x < 0 || y < 0 || x >= this.width || y >= this.height)
      return;
    const i = (y * this.width + x) * 3;
    this.data[i] = this.data[i]! + r * strength;
    this.data[i + 1] = this.data[i + 1]! + g * strength;
    this.data[i + 2] = this.data[i + 2]! + b * strength;
  }

  drawGlow(
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    color: Rgb,
    intensity: number,
    falloff = 2.2,
  ): void {
    const x0 = Math.max(0, Math.floor(cx - rx));
    const x1 = Math.min(this.width - 1, Math.ceil(cx + rx));
    const y0 = Math.max(0, Math.floor(cy - ry));
    const y1 = Math.min(this.height - 1, Math.ceil(cy + ry));
    const invRx = 1 / Math.max(rx, 0.5);
    const invRy = 1 / Math.max(ry, 0.5);
    for (let y = y0; y <= y1; y++) {
      const dy = (y + 0.5 - cy) * invRy;
      const dy2 = dy * dy;
      if (dy2 >= 1) continue;
      for (let x = x0; x <= x1; x++) {
        const dx = (x + 0.5 - cx) * invRx;
        const d2 = dx * dx + dy2;
        if (d2 >= 1) continue;
        const w = Math.pow(1 - Math.sqrt(d2), falloff) * intensity;
        this.add(x, y, color[0], color[1], color[2], w);
      }
    }
  }

  drawSoftEllipse(
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    color: Rgb,
    alpha: number,
    softness = 1.6,
  ): void {
    const x0 = Math.max(0, Math.floor(cx - rx));
    const x1 = Math.min(this.width - 1, Math.ceil(cx + rx));
    const y0 = Math.max(0, Math.floor(cy - ry));
    const y1 = Math.min(this.height - 1, Math.ceil(cy + ry));
    const invRx = 1 / Math.max(rx, 0.5);
    const invRy = 1 / Math.max(ry, 0.5);
    for (let y = y0; y <= y1; y++) {
      const dy = (y + 0.5 - cy) * invRy;
      const dy2 = dy * dy;
      if (dy2 >= 1) continue;
      for (let x = x0; x <= x1; x++) {
        const dx = (x + 0.5 - cx) * invRx;
        const d2 = dx * dx + dy2;
        if (d2 >= 1) continue;
        const w = Math.pow(1 - Math.sqrt(d2), softness) * alpha;
        this.blend(x, y, color[0], color[1], color[2], w);
      }
    }
  }

  /** Scanline polygon fill with per-pixel shader callback. */
  fillPolygon(
    points: readonly Point[],
    shade: (
      x: number,
      y: number,
      u: number,
      v: number,
    ) => readonly [number, number, number, number],
  ): void {
    if (points.length < 3) return;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [px, py] of points) {
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
    }
    const yStart = Math.max(0, Math.floor(minY));
    const yEnd = Math.min(this.height - 1, Math.ceil(maxY));
    const spanX = Math.max(1, maxX - minX);
    const spanY = Math.max(1, maxY - minY);
    const intersections: number[] = [];

    for (let y = yStart; y <= yEnd; y++) {
      const py = y + 0.5;
      intersections.length = 0;
      for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const [x1, y1] = points[j]!;
        const [x2, y2] = points[i]!;
        if ((y1 <= py && y2 > py) || (y2 <= py && y1 > py)) {
          intersections.push(x1 + ((py - y1) * (x2 - x1)) / (y2 - y1));
        }
      }
      intersections.sort((a, b) => a - b);
      const v = (py - minY) / spanY;
      for (let k = 0; k + 1 < intersections.length; k += 2) {
        const x0 = Math.max(0, Math.floor(intersections[k]!));
        const x1 = Math.min(this.width - 1, Math.ceil(intersections[k + 1]!));
        for (let x = x0; x <= x1; x++) {
          const leftCov = clamp(x + 1 - intersections[k]!, 0, 1);
          const rightCov = clamp(intersections[k + 1]! - x, 0, 1);
          const cov = Math.min(leftCov, rightCov);
          if (cov <= 0) continue;
          const u = (x + 0.5 - minX) / spanX;
          const [r, g, b, a] = shade(x, y, u, v);
          this.blend(x, y, r, g, b, a * cov);
        }
      }
    }
  }

  /** Antialiased variable-width line segment. */
  drawSegment(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    r0: number,
    r1: number,
    color: Rgb,
    alpha = 1,
    endColor?: Rgb,
  ): void {
    const pad = Math.max(r0, r1) + 1.5;
    const minX = Math.max(0, Math.floor(Math.min(x0, x1) - pad));
    const maxX = Math.min(this.width - 1, Math.ceil(Math.max(x0, x1) + pad));
    const minY = Math.max(0, Math.floor(Math.min(y0, y1) - pad));
    const maxY = Math.min(this.height - 1, Math.ceil(Math.max(y0, y1) + pad));
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len2 = dx * dx + dy * dy;
    const c1 = endColor ?? color;

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5 - x0;
        const py = y + 0.5 - y0;
        const t = len2 > 0 ? clamp((px * dx + py * dy) / len2, 0, 1) : 0;
        const dist = Math.hypot(px - dx * t, py - dy * t);
        const rad = mix(r0, r1, t);
        const cov = clamp(rad + 0.65 - dist, 0, 1);
        if (cov <= 0) continue;
        this.blend(
          x,
          y,
          mix(color[0], c1[0], t),
          mix(color[1], c1[1], t),
          mix(color[2], c1[2], t),
          alpha * cov,
        );
      }
    }
  }

  /** Draws a smooth cubic Bezier stroke with tapering radius and color. */
  drawCubicCurve(
    p0: Point,
    p1: Point,
    p2: Point,
    p3: Point,
    r0: number,
    r1: number,
    c0: Rgb,
    c1: Rgb,
    alpha = 1,
    steps = 18,
  ): void {
    let prevX = p0[0];
    let prevY = p0[1];
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const mt = 1 - t;
      const nx =
        mt * mt * mt * p0[0] +
        3 * mt * mt * t * p1[0] +
        3 * mt * t * t * p2[0] +
        t * t * t * p3[0];
      const ny =
        mt * mt * mt * p0[1] +
        3 * mt * mt * t * p1[1] +
        3 * mt * t * t * p2[1] +
        t * t * t * p3[1];
      const tPrev = (i - 1) / steps;
      this.drawSegment(
        prevX,
        prevY,
        nx,
        ny,
        mix(r0, r1, tPrev),
        mix(r0, r1, t),
        mixRgb(c0, c1, tPrev),
        alpha,
        mixRgb(c0, c1, t),
      );
      prevX = nx;
      prevY = ny;
    }
  }
}

const BAYER_4X4 = [
  0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5,
] as const;

/** Applies twilight filmic tone mapping, subtle vignette, and ordered dithering. */
export function finalizeToPng(canvas: Canvas): PNG {
  const png = new PNG({ width: canvas.width, height: canvas.height });
  const data = canvas.data;
  const out = png.data;

  for (let y = 0; y < canvas.height; y++) {
    const vy = (y / canvas.height - 0.5) * 2;
    const row = (y & 3) * 4;
    for (let x = 0; x < canvas.width; x++) {
      const vx = (x / canvas.width - 0.5) * 2;
      const vignette =
        1 - Math.max(0, (vx * vx * 0.34 + vy * vy * 0.44 - 0.36) * 0.22);
      const i = (y * canvas.width + x) * 3;
      const o = (y * canvas.width + x) * 4;
      // Ordered dithering prevents gradient banding while keeping PNGs compact.
      const dither = (BAYER_4X4[row + (x & 3)]! / 16 - 0.5) * (1 / 255);

      for (let c = 0; c < 3; c++) {
        let v = Math.max(0, data[i + c]!) * vignette;
        v = v / (1 + v * 0.22);
        v = mix(v, v * v * (3 - 2 * v), 0.24) + dither;
        out[o + c] = Math.round(clamp(v, 0, 1) * 255);
      }
      out[o + 3] = 255;
    }
  }
  return png;
}
