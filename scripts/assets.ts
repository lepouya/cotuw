// Every bundled file under public/assets, with the code that generates it.
import { PNG } from "pngjs";

import { MUSIC_ASSETS, SOUND_ASSETS } from "../src/content/audio-assets.ts";
import { buildAudioPreview, buildMusic, buildSound } from "./audio-assets.ts";
import { buildGrassSheet, GRASS_CLIP, GRASS_SHEETS } from "./grass-sheet.ts";
import { exportInfantry, INFANTRY_ROLES } from "./infantry-model.ts";
import { exportModelAsset, MODEL_ASSETS } from "./model-assets.ts";
import {
  buildMuzzleFlashSheet,
  MUZZLE_FLASH_CLIP,
} from "./muzzle-flash-sheet.ts";
import { minimapColor } from "./sprite-sheet.ts";
import { buildTerrainTexture, TERRAIN_TEXTURES } from "./terrain-textures.ts";

import type { MusicId, SoundId } from "../src/content/audio-assets.ts";
import type { TextureClip } from "../src/content/texture-clip.ts";
import type { Rgba } from "./sprite-sheet.ts";

/** One file by its path under `public/assets`; textures build as images. */
export type GeneratedAsset = {
  path: string;
  build: () => PNG | Uint8Array | Promise<PNG | Uint8Array>;
};

/** Files one command regenerates, and clips content packs copy by ID. */
export type AssetFamily = {
  assets: readonly GeneratedAsset[];
  clips?: Readonly<Record<string, TextureClip>>;
};

export const ASSET_FAMILIES = {
  audio: {
    assets: [
      ...(Object.keys(SOUND_ASSETS) as SoundId[]).map((id) => ({
        path: `audio/${id}.wav`,
        build: () => buildSound(id),
      })),
      ...(Object.keys(MUSIC_ASSETS) as MusicId[]).map((id) => ({
        path: `audio/${id}.wav`,
        build: () => buildMusic(id),
      })),
      { path: "audio/index.html", build: buildAudioPreview },
    ],
  },
  terrain: {
    assets: TERRAIN_TEXTURES.map((kind) => ({
      path: `terrain/${kind}.png`,
      build: () => buildTerrainTexture(kind),
    })),
  },
  grass: {
    assets: Object.entries(GRASS_SHEETS).map(([id, style]) => ({
      path: `terrain/${id}.png`,
      build: () => buildGrassSheet(style),
    })),
    clips: { "grass-sway": GRASS_CLIP },
  },
  effects: {
    assets: [
      { path: "effects/muzzle-flash.png", build: buildMuzzleFlashSheet },
    ],
    clips: { "muzzle-flash": MUZZLE_FLASH_CLIP },
  },
  infantry: {
    assets: INFANTRY_ROLES.map((role) => ({
      path: `actors/arc-${role}.glb`,
      build: () => exportInfantry(role),
    })),
  },
  models: {
    assets: MODEL_ASSETS.map((kind) => ({
      path: `models/${kind}.glb`,
      build: () => exportModelAsset(kind),
    })),
  },
} satisfies Record<string, AssetFamily>;

export type AssetFamilyName = keyof typeof ASSET_FAMILIES;

/** The file's bytes, plus a texture's minimap color for content packs. */
export async function encodeAsset(
  asset: GeneratedAsset,
): Promise<{ bytes: Uint8Array; minimapColor?: Rgba }> {
  const built = await asset.build();
  return built instanceof PNG
    ? { bytes: PNG.sync.write(built), minimapColor: minimapColor(built) }
    : { bytes: built };
}
