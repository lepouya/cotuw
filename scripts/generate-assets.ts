// Writes generated files under public/assets, then prints what content packs
// copy from them: texture minimap colors and clip definitions. Arguments name
// the families to regenerate; none means every family.
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { runnerImport } from "vite";

// Vite transforms the app modules that model builders import.
const {
  module: { ASSET_FAMILIES, encodeAsset },
} = await runnerImport<typeof import("./assets.ts")>(
  fileURLToPath(new URL("assets.ts", import.meta.url)),
);

const names = process.argv.slice(2);
const families = Object.entries(ASSET_FAMILIES);
const unknown = names.filter(
  (name) => !families.some(([family]) => family === name),
);
if (unknown.length > 0)
  throw new Error(`Unknown asset families: ${unknown.join(", ")}`);

const minimapColors: Record<string, readonly number[]> = {};
const clips: Record<string, unknown> = {};
for (const [name, family] of families) {
  if (names.length > 0 && !names.includes(name)) continue;
  for (const asset of family.assets) {
    const { bytes, minimapColor } = await encodeAsset(asset);
    const target = new URL(`../public/assets/${asset.path}`, import.meta.url);
    await mkdir(new URL(".", target), { recursive: true });
    await writeFile(target, bytes);
    if (minimapColor) minimapColors[asset.path] = minimapColor;
  }
  Object.assign(clips, family.clips);
}
console.log(JSON.stringify({ minimapColors, clips }, null, 2));
