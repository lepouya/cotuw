import type { SaveStorage } from "./platform";
import { isCount, isPositive, isRecord } from "./simulation/validation";

export type SaveKind = "manual" | "quick" | "auto";

export type SaveEntry = {
  id: string;
  kind: SaveKind;
  name: string;
  missionName: string;
  /** An ISO timestamp, or empty when the file cannot be read. */
  savedAt: string;
  elapsedSeconds: number;
};

/** Rolling saves replace themselves and never touch manual saves. */
const ROLLING_IDS = { quick: "quicksave", auto: "autosave" } as const;
/** Bounds file handles and JSON memory when the library grows. */
const METADATA_READERS = 4;

/** Mission files in storage, described by the metadata they carry. */
export function createSaveLibrary(storage: SaveStorage) {
  let pending: Promise<unknown> = Promise.resolve();
  const mutate = <T>(action: () => Promise<T>): Promise<T> => {
    const result = pending.then(action);
    // A failed write must not prevent later saves or deletions.
    pending = result.catch(() => {});
    return result;
  };
  const read = async (id: string) => {
    await pending;
    return storage.read(id);
  };
  return {
    /** Newest first. */
    list: async (): Promise<SaveEntry[]> => {
      await pending;
      const ids = await storage.list();
      const entries: SaveEntry[] = [];
      let next = 0;
      await Promise.all(
        Array.from(
          { length: Math.min(METADATA_READERS, ids.length) },
          async () => {
            while (next < ids.length) {
              const index = next++;
              const id = ids[index];
              entries[index] = describe(
                id,
                await storage.read(id).catch(() => ""),
              );
            }
          },
        ),
      );
      return entries.sort((left, right) =>
        right.savedAt.localeCompare(left.savedAt),
      );
    },
    read,
    readQuicksave: async () => {
      await pending;
      if (!(await storage.list()).includes(ROLLING_IDS.quick))
        throw new Error("There is no quicksave yet.");
      return storage.read(ROLLING_IDS.quick);
    },
    remove: (id: string) => mutate(() => storage.remove(id)),
    /** Resolves the ID the source was stored under. */
    write: (kind: SaveKind, source: string): Promise<string> => {
      const randomId = () =>
        Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
          byte.toString(16).padStart(2, "0"),
        ).join("");
      const id =
        kind === "manual"
          ? `manual-${Date.now()}-${randomId()}`
          : ROLLING_IDS[kind];
      return mutate(async () => {
        await storage.write(id, source);
        return id;
      });
    },
  };
}

export type SaveLibrary = ReturnType<typeof createSaveLibrary>;

function describe(id: string, source: string): SaveEntry {
  const kind: SaveKind =
    id === ROLLING_IDS.quick
      ? "quick"
      : id === ROLLING_IDS.auto
        ? "auto"
        : "manual";
  try {
    const file = JSON.parse(source);
    if (
      !isRecord(file) ||
      !isRecord(file.scenario) ||
      !isRecord(file.state) ||
      !isCount(file.state.tick) ||
      !isPositive(file.ticksPerSecond)
    )
      throw new Error("Invalid save metadata.");
    const save = isRecord(file.save) ? file.save : undefined;
    const savedAt =
      typeof save?.savedAt === "string" &&
      Number.isFinite(Date.parse(save.savedAt))
        ? new Date(save.savedAt).toISOString()
        : "";
    const elapsedSeconds = file.state.tick / file.ticksPerSecond;
    if (!Number.isFinite(elapsedSeconds))
      throw new Error("Invalid elapsed time.");
    return {
      id,
      kind,
      name: typeof save?.name === "string" ? save.name : id,
      missionName:
        typeof file.scenario.name === "string"
          ? file.scenario.name
          : typeof file.scenario.id === "string"
            ? file.scenario.id
            : "",
      savedAt,
      elapsedSeconds,
    };
  } catch {
    return {
      id,
      kind,
      name: id,
      missionName: "Unreadable file",
      savedAt: "",
      elapsedSeconds: 0,
    };
  }
}
