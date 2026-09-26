// Makes a texture's opposite edges identical so it repeats without a seam,
// rewriting each PNG in place. Not idempotent: every run blends the edge band
// further, so run it on freshly edited art, never on an already-reconciled
// file. The terrain asset tests check the result.
import { readFile, writeFile } from "node:fs/promises";

import { PNG } from "pngjs";

type Axis = "horizontal" | "vertical";

const texturePaths = process.argv.slice(2);

if (texturePaths.length === 0) {
  throw new Error("Pass at least one PNG path.");
}

for (const texturePath of texturePaths) {
  const png = PNG.sync.read(await readFile(texturePath));
  // Blending across a band rather than the edge pixels alone keeps the
  // correction from reading as a hard line of its own.
  const band = Math.max(2, Math.round(Math.min(png.width, png.height) / 32));

  reconcileAxis(png, band, "horizontal");
  reconcileAxis(png, band, "vertical");
  await writeFile(texturePath, PNG.sync.write(png));
}

function reconcileAxis(png: PNG, band: number, axis: Axis): void {
  const source = Buffer.from(png.data);
  const span = axis === "horizontal" ? png.width : png.height;
  const crossSpan = axis === "horizontal" ? png.height : png.width;

  for (let distance = 0; distance < band; distance += 1) {
    const progress = distance / (band - 1);
    // Full blend at the edge easing to none at the band's inner limit, so the
    // two edges end up identical and the interior is untouched.
    const strength = (1 + Math.cos(Math.PI * progress)) / 2;

    for (let cross = 0; cross < crossSpan; cross += 1) {
      const start = pixelIndex(png, axis, distance, cross);
      const end = pixelIndex(png, axis, span - 1 - distance, cross);
      blendPair(source, png.data, start, end, strength);
    }
  }
}

function pixelIndex(
  png: PNG,
  axis: Axis,
  along: number,
  cross: number,
): number {
  const x = axis === "horizontal" ? along : cross;
  const y = axis === "horizontal" ? cross : along;
  return (y * png.width + x) * 4;
}

// Blends premultiplied, so color under near-transparent pixels cannot bleed
// into the result.
function blendPair(
  source: Buffer,
  target: Buffer,
  first: number,
  second: number,
  strength: number,
): void {
  const firstAlpha = source[first + 3] / 255;
  const secondAlpha = source[second + 3] / 255;
  const seamAlpha = (firstAlpha + secondAlpha) / 2;

  for (const index of [first, second]) {
    const sourceAlpha = source[index + 3] / 255;
    const outputAlpha = mix(sourceAlpha, seamAlpha, strength);

    for (let channel = 0; channel < 3; channel += 1) {
      const sourcePremultiplied = source[index + channel] * sourceAlpha;
      const seamPremultiplied =
        (source[first + channel] * firstAlpha +
          source[second + channel] * secondAlpha) /
        2;
      const outputPremultiplied = mix(
        sourcePremultiplied,
        seamPremultiplied,
        strength,
      );
      target[index + channel] =
        outputAlpha === 0 ? 0 : Math.round(outputPremultiplied / outputAlpha);
    }

    target[index + 3] = Math.round(outputAlpha * 255);
  }
}

function mix(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}
