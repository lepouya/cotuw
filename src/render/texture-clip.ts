// Frame-sequenced textures cut from a sprite sheet. Playback is presentation
// only: it reads render time and never feeds simulation state.
import { DynamicTexture, Tools } from "@babylonjs/core";

import { clipCellRect } from "../content/texture-clip";
import type { TextureClip } from "../content/texture-clip";

import type { Scene, Texture } from "@babylonjs/core";

/** A clip's frame textures by sheet cell, empty until the sheet loads. */
export type ClipFrames = {
  readonly frames: ReadonlyMap<number, Texture>;
  /** Releases the textures, or skips cutting them if still loading. */
  dispose: () => void;
};

/**
 * Cuts the cells a clip plays out of its sprite sheet into separate textures,
 * so each can repeat or wrap on its own. `prepare` configures each one.
 */
export function loadClipFrames(
  scene: Scene,
  url: string,
  clip: TextureClip,
  prepare: (texture: Texture) => void,
): ClipFrames {
  const frames = new Map<number, Texture>();
  let disposed = false;
  Tools.LoadImage(
    url,
    (image) => {
      if (disposed || scene.isDisposed) return;
      if (image.width % clip.columns || image.height % clip.rows) {
        console.error(`Sprite sheet ${url} does not divide into whole cells.`);
        return;
      }
      for (const { cell } of clip.frames) {
        if (frames.has(cell)) continue;
        const { x, y, width, height } = clipCellRect(clip, cell, image);
        const texture = new DynamicTexture(
          `${url}#${cell}`,
          { width, height },
          scene,
          true,
        );
        texture
          .getContext()
          .drawImage(image, x, y, width, height, 0, 0, width, height);
        texture.update();
        prepare(texture);
        frames.set(cell, texture);
      }
    },
    (message) => console.error(`Sprite sheet ${url} failed to load.`, message),
    scene.offlineProvider,
  );
  return {
    frames,
    dispose: () => {
      disposed = true;
      for (const texture of frames.values()) texture.dispose();
      frames.clear();
    },
  };
}
