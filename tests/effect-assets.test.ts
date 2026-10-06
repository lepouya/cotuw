import { readFile } from "node:fs/promises";

import { PNG } from "pngjs";
import { expect, test } from "vitest";

import { BASE_CONTENT } from "./helpers/content";
import { clipCellRect } from "../src/content/texture-clip";

const effects = Object.entries(BASE_CONTENT.presentation).flatMap(
  ([id, { frameEffects }]) =>
    Object.entries(frameEffects ?? {}).map(
      ([trigger, effect]) => [`${id} ${trigger}`, effect!] as const,
    ),
);

async function readSheet(url: string): Promise<PNG> {
  return PNG.sync.read(
    await readFile(new URL(`../public${url}`, import.meta.url)),
  );
}

// A frame effect's square shows the whole cell, so a visible edge would
// draw a hard border around it.
test.each(effects)(
  "%s effect cells fade out before their edges",
  async (_name, { clip: id, url }) => {
    const clip = BASE_CONTENT.clips![id]!;
    const sheet = await readSheet(url);
    expect(sheet.width % clip.columns).toBe(0);
    expect(sheet.height % clip.rows).toBe(0);
    for (const { cell } of clip.frames) {
      const { x, y, width, height } = clipCellRect(clip, cell, sheet);
      let edge = 0;
      for (let row = y; row < y + height; row++)
        for (let column = x; column < x + width; column++)
          if (
            row === y ||
            column === x ||
            row === y + height - 1 ||
            column === x + width - 1
          )
            edge = Math.max(
              edge,
              sheet.data[(row * sheet.width + column) * 4 + 3]!,
            );
      expect(edge).toBe(0);
    }
  },
);
