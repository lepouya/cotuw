import { isTauri } from "@tauri-apps/api/core";

/** Host services the game uses without depending on Tauri directly. */
export type Platform = {
  /** Mission files in the player's save library, by ID. */
  saves: SaveStorage;
  /** Resolves `false` when the player cancels. */
  exportFile: (name: string, source: string) => Promise<boolean>;
  /** Resolves `undefined` when the player cancels. */
  importFile: () => Promise<string | undefined>;
};

/** IDs are safe file names. Failures reject with a message for the player. */
export type SaveStorage = {
  list: () => Promise<string[]>;
  read: (id: string) => Promise<string>;
  write: (id: string, source: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
};

export async function createPlatform(): Promise<Platform> {
  return isTauri()
    ? (await import("./tauri")).createTauriPlatform()
    : (await import("./browser")).createBrowserPlatform();
}
