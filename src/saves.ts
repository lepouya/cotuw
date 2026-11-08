import { isCount, isPositive, isRecord } from "./simulation/validation";

import type { SaveStorage } from "./platform";

export type SaveKind = "manual" | "quick" | "auto";

export const SAVE_KIND_LABELS: Record<SaveKind, string> = {
  manual: "Manual",
  quick: "Quick",
  auto: "Auto",
};

export const saveCompleteMessage = (kind: SaveKind, name: string) =>
  `${SAVE_KIND_LABELS[kind]} save complete: ${name}`;

export type SaveEntry = {
  id: string;
  kind: SaveKind;
  name: string;
  missionName: string;
  /** An ISO timestamp, or empty when the file cannot be read. */
  savedAt: string;
  elapsedSeconds: number;
  /** Why this build cannot load the file, when it cannot. */
  incompatible?: string;
};

/** Rolling saves replace themselves and never touch manual saves. */
const ROLLING_IDS = { quick: "quicksave", auto: "autosave" } as const;
/** Bounds file handles and JSON memory when the library grows. */
const METADATA_READERS = 4;

const randomId = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");

/**
 * Mission files in storage, described by the metadata they carry.
 * `incompatibility` explains why a parsed file cannot load in this build.
 */
export function createSaveLibrary(
  storage: SaveStorage,
  incompatibility: (file: unknown) => string | undefined = () => undefined,
) {
  let pending: Promise<void> = Promise.resolve();
  const mutate = <T>(action: () => Promise<T>): Promise<T> => {
    const result = pending.then(action);
    // A failed write must not prevent later saves or deletions.
    pending = result.then(
      () => {},
      () => {},
    );
    return result;
  };
  const read = async (id: string) => {
    await pending;
    return storage.read(id);
  };
  return {
    /** Waits for requested writes and deletions; their callers handle errors. */
    flush: () => pending,
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
                incompatibility,
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

function kindOf(id: string): SaveKind {
  if (id === ROLLING_IDS.quick) return "quick";
  if (id === ROLLING_IDS.auto) return "auto";
  return "manual";
}

const text = (value: unknown) =>
  typeof value === "string" ? value : undefined;

function describe(
  id: string,
  source: string,
  incompatibility: (file: unknown) => string | undefined,
): SaveEntry {
  let file: unknown;
  let incompatible: string | undefined;
  try {
    file = JSON.parse(source);
    incompatible = incompatibility(file);
  } catch {
    incompatible = "This file cannot be read as a mission.";
  }
  const unreadable: SaveEntry = {
    id,
    kind: kindOf(id),
    name: id,
    missionName: "Unreadable file",
    savedAt: "",
    elapsedSeconds: 0,
    ...(incompatible === undefined ? {} : { incompatible }),
  };
  if (
    !isRecord(file) ||
    !isRecord(file.scenario) ||
    !isRecord(file.state) ||
    !isCount(file.state.tick) ||
    !isPositive(file.ticksPerSecond)
  )
    return unreadable;
  const elapsedSeconds = file.state.tick / file.ticksPerSecond;
  if (!Number.isFinite(elapsedSeconds)) return unreadable;
  const save = isRecord(file.save) ? file.save : undefined;
  const savedAt = text(save?.savedAt) ?? "";
  return {
    ...unreadable,
    name: text(save?.name) ?? id,
    missionName: text(file.scenario.name) ?? text(file.scenario.id) ?? "",
    savedAt: Number.isFinite(Date.parse(savedAt))
      ? new Date(savedAt).toISOString()
      : "",
    elapsedSeconds,
  };
}
