import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { PNG } from "pngjs";

import { expect, test } from "vitest";

import { ASSET_FAMILIES, encodeAsset } from "../scripts/assets";
import { BASE_CONTENT } from "./helpers/content";

const families = Object.entries(ASSET_FAMILIES);
const assets = families.flatMap(([family, { assets }]) =>
  assets.map((asset) => [asset.path, family, asset] as const),
);

// Full-size terrain textures take seconds to generate, more on a busy runner.
const GENERATION_TIMEOUT_MS = 30_000;

test.each(assets)(
  "the committed %s matches its generator",
  async (path, family, asset) => {
    const { bytes } = await encodeAsset(asset);
    expect(
      Buffer.from(bytes).equals(readFileSync(`public/assets/${path}`)),
      `Regenerate with \`npm run assets:${family}\`.`,
    ).toBe(true);
  },
  GENERATION_TIMEOUT_MS,
);

test("every file asset has a generator", () => {
  const files = readdirSync("public/assets", {
    recursive: true,
    withFileTypes: true,
  })
    .filter((entry) => entry.isFile())
    .map((entry) =>
      relative("public/assets", join(entry.parentPath, entry.name))
        .split(sep)
        .join("/"),
    );
  expect(files.sort()).toEqual(assets.map(([path]) => path).sort());
});

test.each(
  families.flatMap(([, family]) =>
    Object.entries("clips" in family ? family.clips : {}),
  ),
)("the base pack's %s clip matches its generator", (id, clip) => {
  expect(BASE_CONTENT.clips![id]).toEqual(clip);
});

// Only the bundled pack is required to use local registered generators.
test("every base-pack asset URL names a registered generated file", () => {
  const registered = new Set(assets.map(([path]) => `/assets/${path}`));
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (key === "url")
        expect(registered.has(child), String(child)).toBe(true);
      else visit(child);
    }
  };
  visit(BASE_CONTENT);
});

test("asset encoding supports asynchronous images and synchronous binary data", async () => {
  const image = new PNG({ width: 1, height: 1 });
  const texture = await encodeAsset({
    path: "empty.png",
    build: async () => image,
  });
  expect(texture.minimapColor).toEqual([0, 0, 0, 0]);
  expect(Buffer.from(texture.bytes).equals(PNG.sync.write(image))).toBe(true);
  const bytes = new Uint8Array([1, 2, 3]);
  expect(await encodeAsset({ path: "model.glb", build: () => bytes })).toEqual({
    bytes,
  });
});
