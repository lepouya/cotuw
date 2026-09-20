import { readFile } from "node:fs/promises";

import { PNG } from "pngjs";
import { describe, expect, test } from "vitest";

const texturePaths = ["dirt.png", "clutter.png", "water.png"] as const;

describe("terrain texture assets", () => {
  test.each(texturePaths)("%s has matching opposite edges", async (name) => {
    const png = PNG.sync.read(
      await readFile(
        new URL(`../public/assets/terrain/${name}`, import.meta.url),
      ),
    );

    expect(maximumEdgeDelta(png)).toEqual({ horizontal: 0, vertical: 0 });
  });

  test("keeps the intended alpha channels", async () => {
    const textures = await Promise.all(
      texturePaths.map(async (name) =>
        PNG.sync.read(
          await readFile(
            new URL(`../public/assets/terrain/${name}`, import.meta.url),
          ),
        ),
      ),
    );
    const [dirt, clutter, water] = textures.map(alphaRange);

    expect(dirt).toEqual({ minimum: 255, maximum: 255 });
    expect(clutter.minimum).toBe(0);
    expect(clutter.maximum).toBe(255);
    expect(water.minimum).toBeLessThan(255);
    expect(water.maximum).toBeGreaterThan(0);
  });
});

function maximumEdgeDelta(png: PNG) {
  let horizontal = 0;
  let vertical = 0;

  for (let y = 0; y < png.height; y += 1) {
    for (let channel = 0; channel < 4; channel += 1) {
      const left = y * png.width * 4 + channel;
      const right = (y * png.width + png.width - 1) * 4 + channel;
      horizontal = Math.max(
        horizontal,
        Math.abs(png.data[left] - png.data[right]),
      );
    }
  }

  for (let x = 0; x < png.width; x += 1) {
    for (let channel = 0; channel < 4; channel += 1) {
      const top = x * 4 + channel;
      const bottom = ((png.height - 1) * png.width + x) * 4 + channel;
      vertical = Math.max(vertical, Math.abs(png.data[top] - png.data[bottom]));
    }
  }

  return { horizontal, vertical };
}

function alphaRange(png: PNG) {
  let minimum = 255;
  let maximum = 0;

  for (let index = 3; index < png.data.length; index += 4) {
    minimum = Math.min(minimum, png.data[index]);
    maximum = Math.max(maximum, png.data[index]);
  }

  return { minimum, maximum };
}
