import { readFile } from "node:fs/promises";

import { PNG } from "pngjs";
import { describe, expect, test } from "vitest";

import { BASE_CONTENT } from "./helpers/content";

import { clipCellRect } from "../src/content/texture-clip";
import { GRASS_SHEETS, TILES_PER_REPEAT } from "../scripts/grass-sheet";

import type { TileGraphics } from "../src/map";
import type { TextureClip } from "../src/content/texture-clip";

const { tileTypes } = BASE_CONTENT.terrain;
const tileGraphics = Object.entries(tileTypes).map(
  ([id, { graphics }]): [string, TileGraphics] => [id, graphics!],
);
// Several types can sample one file, so seams only need checking once per file.
const texturePaths = [
  ...new Map(
    tileGraphics.map(([, { url, clip }]) => [
      url,
      clip ? BASE_CONTENT.clips![clip] : undefined,
    ]),
  ),
];

async function readTexture(url: string): Promise<PNG> {
  return PNG.sync.read(
    await readFile(new URL(`../public${url}`, import.meta.url)),
  );
}

describe("terrain texture assets", () => {
  // Terrain samples with WRAP_ADDRESSMODE, so a texture whose opposite edges
  // disagree shows a seam at every repeat.
  // Clips repeat each cell on its own, so each cell must tile.
  test.each(texturePaths)(
    "%s has matching opposite edges",
    async (url, clip) => {
      const png = await readTexture(url);
      const cells = clip
        ? clip.frames.map(({ cell }) => cropCell(png, clip, cell))
        : [png];
      for (const cell of cells)
        expect(maximumEdgeDelta(cell)).toEqual({ horizontal: 0, vertical: 0 });
    },
  );

  test.each(tileGraphics)(
    "%s declares its alpha channel honestly",
    async (_id, source) => {
      const alpha = alphaRange(await readTexture(source.url));

      if (source.hasAlpha) {
        expect(alpha.minimum).toBeLessThan(255);
        expect(alpha.maximum).toBeGreaterThan(0);
      } else {
        expect(alpha).toEqual({ minimum: 255, maximum: 255 });
      }
    },
  );

  test.each(tileGraphics)(
    "%s has a minimap color matching its pixels",
    async (_id, source) => {
      const mean = meanColor(await readTexture(source.url));
      // Layer-alpha-only textures cover the tile however sparse their alpha.
      const coverage = source.layerAlphaOnly ? 1 : mean.coverage;
      const [red, green, blue, minimapCoverage] = source.minimapColor;

      expect(red).toBeCloseTo(mean.red, 2);
      expect(green).toBeCloseTo(mean.green, 2);
      expect(blue).toBeCloseTo(mean.blue, 2);
      expect(minimapCoverage).toBeCloseTo(coverage, 2);
    },
  );

  test.each(Object.keys(GRASS_SHEETS))(
    "the %s sheet repeats as its generator expects",
    (id) => {
      expect(tileTypes[id]!.graphics!.scale).toEqual({
        u: 1 / TILES_PER_REPEAT,
        v: 1 / TILES_PER_REPEAT,
      });
    },
  );

  test("clutter masks tiles rather than tinting them", async () => {
    const clutter = alphaRange(
      await readTexture(tileTypes.clutter.graphics!.url),
    );

    expect(clutter).toEqual({ minimum: 0, maximum: 255 });
  });
});

function cropCell(png: PNG, clip: TextureClip, cell: number): PNG {
  const rect = clipCellRect(clip, cell, png);
  const cropped = new PNG({ width: rect.width, height: rect.height });
  PNG.bitblt(png, cropped, rect.x, rect.y, rect.width, rect.height, 0, 0);
  return cropped;
}

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

/** Alpha-weighted mean color in 0-1 channels, and the mean alpha. */
function meanColor(png: PNG) {
  let red = 0;
  let green = 0;
  let blue = 0;
  let weight = 0;

  for (let index = 0; index < png.data.length; index += 4) {
    const alpha = png.data[index + 3] / 255;
    red += png.data[index] * alpha;
    green += png.data[index + 1] * alpha;
    blue += png.data[index + 2] * alpha;
    weight += alpha;
  }

  return {
    red: red / weight / 255,
    green: green / weight / 255,
    blue: blue / weight / 255,
    coverage: weight / (png.data.length / 4),
  };
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
