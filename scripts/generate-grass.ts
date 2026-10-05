// Writes the grass terrain clip sprite sheets, then prints the clip and each
// sheet's minimap color to copy into the content pack after changing the art.
import { writeFile } from "node:fs/promises";

import { PNG } from "pngjs";

import { buildGrassSheet, GRASS_CLIP, GRASS_SHEETS } from "./grass-sheet.ts";
import { minimapColor } from "./sprite-sheet.ts";

const minimapColors: Record<string, readonly number[]> = {};
for (const [id, style] of Object.entries(GRASS_SHEETS)) {
  const sheet = buildGrassSheet(style);
  await writeFile(
    new URL(`../public/assets/terrain/${id}.png`, import.meta.url),
    PNG.sync.write(sheet),
  );
  minimapColors[id] = minimapColor(sheet);
}
console.log(JSON.stringify({ clip: GRASS_CLIP, minimapColors }, null, 2));
