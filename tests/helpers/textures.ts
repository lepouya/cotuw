import { readFile } from "node:fs/promises";
import { PNG } from "pngjs";

type TextureSource = { url: string; clip?: string };

/** Each sheet and clip pair has its own cell-edge contract. */
export function uniqueTextureSources<T extends TextureSource>(
  sources: readonly T[],
): T[] {
  return [
    ...new Map(
      sources.map((source) => [
        JSON.stringify([source.url, source.clip]),
        source,
      ]),
    ).values(),
  ];
}

const textures = new Map<string, Promise<PNG>>();

/** Shares decoded asset pixels; callers must not modify the image. */
export function readTexture(url: string): Promise<PNG> {
  let texture = textures.get(url);
  if (!texture) {
    texture = readFile(new URL(`../../public${url}`, import.meta.url)).then(
      (bytes) => PNG.sync.read(bytes),
    );
    textures.set(url, texture);
  }
  return texture;
}
