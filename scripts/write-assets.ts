// Writes generated files under public/assets, then prints what content packs
// copy from them: texture minimap colors and clip definitions.
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { runnerImport } from "vite";

import type { AssetFamilyName } from "./assets.ts";

/** Regenerates the named families, or every family when none are named. */
export async function writeAssets(...names: AssetFamilyName[]) {
  // Vite transforms the app modules that model builders import.
  const {
    module: { ASSET_FAMILIES, encodeAsset },
  } = await runnerImport<typeof import("./assets.ts")>(
    fileURLToPath(new URL("assets.ts", import.meta.url)),
  );
  const minimapColors: Record<string, readonly number[]> = {};
  const clips: Record<string, unknown> = {};
  for (const [name, family] of Object.entries(ASSET_FAMILIES)) {
    if (names.length > 0 && !names.includes(name as AssetFamilyName)) continue;
    for (const asset of family.assets) {
      const { bytes, minimapColor } = await encodeAsset(asset);
      const target = new URL(`../public/assets/${asset.path}`, import.meta.url);
      await mkdir(new URL(".", target), { recursive: true });
      await writeFile(target, bytes);
      if (minimapColor) minimapColors[asset.path] = minimapColor;
    }
    Object.assign(clips, "clips" in family ? family.clips : {});
  }
  console.log(JSON.stringify({ minimapColors, clips }, null, 2));
}
