// Writes the actor effect sprite sheets, then prints the clip to copy into the
// content pack after changing the art.
import { mkdir, writeFile } from "node:fs/promises";

import { PNG } from "pngjs";

import {
  buildMuzzleFlashSheet,
  MUZZLE_FLASH_CLIP,
} from "./muzzle-flash-sheet.ts";

const output = new URL("../public/assets/effects/", import.meta.url);
await mkdir(output, { recursive: true });
await writeFile(
  new URL("muzzle-flash.png", output),
  PNG.sync.write(buildMuzzleFlashSheet()),
);
console.log(JSON.stringify({ clip: MUZZLE_FLASH_CLIP }, null, 2));
