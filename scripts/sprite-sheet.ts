// Tools for generated texture-clip sprite sheets: tiling frames drawn with soft
// discs, packed into a grid PNG whose cells each repeat without a seam.
import { PNG } from "pngjs";

export type Rgba = readonly [number, number, number, number];

/** `value` within `[0, period)`, so coordinates repeat every period. */
export function wrap(value: number, period: number): number {
  return ((value % period) + period) % period;
}

/** The color `t` of the way from `from` to `to`. */
export function mixRgba(from: Rgba, to: Rgba, t: number): Rgba {
  return [0, 1, 2, 3].map(
    (channel) => from[channel]! + (to[channel]! - from[channel]!) * t,
  ) as unknown as Rgba;
}

/** A frame that repeats every `period` pixels, in premultiplied 0-1 RGBA. */
export type Frame = { period: number; pixels: Float32Array };

export function createFrame(period: number): Frame {
  return { period, pixels: new Float32Array(period * period * 4) };
}

/**
 * Composites a disc over the frame with an antialiased edge. Discs crossing
 * an edge wrap to the opposite side, so the frame tiles seamlessly.
 */
export function drawDisc(
  frame: Frame,
  x: number,
  y: number,
  radius: number,
  color: Rgba,
): void {
  const reach = Math.ceil(radius + 1);
  for (let py = Math.floor(y - reach); py <= Math.ceil(y + reach); py++)
    for (let px = Math.floor(x - reach); px <= Math.ceil(x + reach); px++) {
      const coverage = Math.min(
        1,
        Math.max(0, radius + 0.5 - Math.hypot(px + 0.5 - x, py + 0.5 - y)),
      );
      if (coverage > 0) blendPixel(frame, px, py, color, coverage);
    }
}

/** Composites a straight-alpha color over one pixel, wrapping at the edges. */
export function blendPixel(
  { period, pixels }: Frame,
  px: number,
  py: number,
  [red, green, blue, alpha]: Rgba,
  coverage = 1,
): void {
  const source = alpha * coverage;
  const index = (wrap(py, period) * period + wrap(px, period)) * 4;
  const keep = 1 - source;
  pixels[index] = red * source + pixels[index]! * keep;
  pixels[index + 1] = green * source + pixels[index + 1]! * keep;
  pixels[index + 2] = blue * source + pixels[index + 2]! * keep;
  pixels[index + 3] = source + pixels[index + 3]! * keep;
}

/**
 * Packs frames into a grid, row by row from the top left. Each cell is one
 * pixel wider and taller than its period and repeats its first row and
 * column there, because terrain samples a texture's edges as the same point.
 */
export function packSheet(frames: readonly Frame[], columns: number): PNG {
  const cell = frames[0]!.period + 1;
  const rows = Math.ceil(frames.length / columns);
  const png = new PNG({ width: cell * columns, height: cell * rows });
  frames.forEach(({ period, pixels }, index) => {
    const left = (index % columns) * cell;
    const top = Math.floor(index / columns) * cell;
    for (let y = 0; y < cell; y++)
      for (let x = 0; x < cell; x++) {
        const from = ((y % period) * period + (x % period)) * 4;
        const to = ((top + y) * png.width + left + x) * 4;
        const alpha = pixels[from + 3]!;
        // PNG stores straight alpha.
        for (let channel = 0; channel < 3; channel++)
          png.data[to + channel] = Math.round(
            alpha > 0 ? (pixels[from + channel]! / alpha) * 255 : 0,
          );
        png.data[to + 3] = Math.round(alpha * 255);
      }
  });
  return png;
}

/**
 * The alpha-weighted mean color and mean alpha, rounded for a content pack's
 * `minimapColor`.
 */
export function minimapColor(png: PNG): Rgba {
  let red = 0;
  let green = 0;
  let blue = 0;
  let weight = 0;
  for (let index = 0; index < png.data.length; index += 4) {
    const alpha = png.data[index + 3]! / 255;
    red += png.data[index]! * alpha;
    green += png.data[index + 1]! * alpha;
    blue += png.data[index + 2]! * alpha;
    weight += alpha;
  }
  if (weight === 0) return [0, 0, 0, 0];
  const round = (value: number) => Math.round(value * 1000) / 1000;
  return [
    round(red / weight / 255),
    round(green / weight / 255),
    round(blue / weight / 255),
    round(weight / (png.data.length / 4)),
  ];
}

/** A repeatable pseudo-random sequence in [0, 1), so reruns match. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
