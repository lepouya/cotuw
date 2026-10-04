import baseSource from "./packs/base.json?raw";
import { parseContentPack } from "./content-pack";

import type { ContentPack, ContentReference } from "./content-pack";

const SOURCES: ReadonlyMap<string, string> = new Map([["base", baseSource]]);
const parsed = new Map<string, ContentPack>();

/** The current version of a bundled pack, as new levels use it. */
export function currentContentPack(id: string): ContentPack {
  let pack = parsed.get(id);
  if (!pack) {
    const source = SOURCES.get(id);
    if (source === undefined)
      throw new RangeError(`This build has no content pack named "${id}".`);
    pack = parseContentPack(source);
    if (pack.id !== id)
      throw new RangeError(
        `Content pack "${pack.id}" is registered as "${id}".`,
      );
    parsed.set(id, pack);
  }
  return pack;
}

/** The bundled pack a mission names, which must match its version. */
export function contentPack({ id, version }: ContentReference): ContentPack {
  const pack = currentContentPack(id);
  if (pack.version !== version)
    throw new RangeError(
      `This mission uses content pack ${id} version ${version}; this build has version ${pack.version}.`,
    );
  return pack;
}
