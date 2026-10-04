import { open, save } from "@tauri-apps/plugin-dialog";
import {
  BaseDirectory,
  mkdir,
  readDir,
  readTextFile,
  remove,
  rename,
  writeTextFile,
} from "@tauri-apps/plugin-fs";

import type { Platform } from ".";

const DIRECTORY = "saves";
const IN_APP_DATA = { baseDir: BaseDirectory.AppData };
const FILTERS = [{ name: "Mission", extensions: ["json"] }];

/** Keeps saves as JSON files in the app data folder. */
export function createTauriPlatform(): Platform {
  const path = (id: string) => {
    if (!/^[a-zA-Z0-9_.-]+$/.test(id)) throw new RangeError("Invalid save ID.");
    return `${DIRECTORY}/${id}.json`;
  };
  const ensureDirectory = () =>
    mkdir(DIRECTORY, { ...IN_APP_DATA, recursive: true });
  return {
    saves: {
      list: async () => {
        await ensureDirectory();
        return (await readDir(DIRECTORY, IN_APP_DATA))
          .filter(({ isFile, name }) => isFile && name.endsWith(".json"))
          .map(({ name }) => name.slice(0, -".json".length));
      },
      read: async (id) => readTextFile(path(id), IN_APP_DATA),
      write: async (id, source) => {
        const target = path(id);
        const temporary = `${target}.${crypto.randomUUID()}.tmp`;
        await ensureDirectory();
        try {
          await writeTextFile(temporary, source, IN_APP_DATA);
          await rename(temporary, target, {
            oldPathBaseDir: BaseDirectory.AppData,
            newPathBaseDir: BaseDirectory.AppData,
          });
        } catch (error) {
          await remove(temporary, IN_APP_DATA).catch(() => {});
          throw error;
        }
      },
      remove: async (id) => remove(path(id), IN_APP_DATA),
    },
    exportFile: async (name, source) => {
      const target = await save({ defaultPath: name, filters: FILTERS });
      if (!target) return false;
      await writeTextFile(target, source);
      return true;
    },
    importFile: async () => {
      const selected = await open({ filters: FILTERS });
      return selected ? readTextFile(selected) : undefined;
    },
  };
}
