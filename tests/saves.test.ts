import { expect, test, vi } from "vitest";

import { createSaveLibrary } from "../src/saves";

function memoryStorage() {
  const files = new Map<string, string>();
  return {
    files,
    list: async () => [...files.keys()],
    read: async (id: string) => files.get(id)!,
    write: async (id: string, source: string) => {
      files.set(id, source);
    },
    remove: async (id: string) => {
      files.delete(id);
    },
  };
}

const saveFile = (name: string, savedAt: string, tick = 120) =>
  JSON.stringify({
    ticksPerSecond: 60,
    save: { name, savedAt },
    scenario: { id: "opening", name: "Clear the wolf threat" },
    state: { tick },
  });

test("rolling saves replace themselves without touching manual saves", async () => {
  const storage = memoryStorage();
  const library = createSaveLibrary(storage);
  const first = await library.write(
    "manual",
    saveFile("Base", "2026-10-04T10:00:00Z"),
  );
  const second = await library.write(
    "manual",
    saveFile("Base again", "2026-10-04T10:01:00Z"),
  );
  await library.write("quick", saveFile("Quicksave", "2026-10-04T10:02:00Z"));
  await library.write("quick", saveFile("Quicksave", "2026-10-04T10:03:00Z"));
  await library.write("auto", saveFile("Autosave", "2026-10-04T10:04:00Z"));
  expect(first).not.toBe(second);
  expect(storage.files.size).toBe(4);
  const entries = await library.list();
  expect(entries.map(({ kind, name }) => [kind, name])).toEqual([
    ["auto", "Autosave"],
    ["quick", "Quicksave"],
    ["manual", "Base again"],
    ["manual", "Base"],
  ]);
  expect(entries[0]).toMatchObject({
    missionName: "Clear the wolf threat",
    elapsedSeconds: 2,
  });
});

test("quickload explains a missing quicksave", async () => {
  const library = createSaveLibrary(memoryStorage());
  await expect(library.readQuicksave()).rejects.toThrow("no quicksave yet");
  await library.write("quick", saveFile("Quicksave", "2026-10-04T10:00:00Z"));
  expect(JSON.parse(await library.readQuicksave()).save.name).toBe("Quicksave");
});

test("unreadable files stay listed so they can be removed", async () => {
  const storage = memoryStorage();
  storage.files.set("manual-1", "{");
  const library = createSaveLibrary(storage);
  expect(await library.list()).toEqual([
    {
      id: "manual-1",
      kind: "manual",
      name: "manual-1",
      missionName: "Unreadable file",
      savedAt: "",
      elapsedSeconds: 0,
    },
  ]);
  await library.remove("manual-1");
  expect(await library.list()).toEqual([]);
});

test("manual IDs survive reloads and a clock that moves backward", async () => {
  const storage = memoryStorage();
  vi.spyOn(Date, "now").mockReturnValue(1000);
  try {
    await createSaveLibrary(storage).write("manual", "first");
    await createSaveLibrary(storage).write("manual", "second");
    vi.mocked(Date.now).mockReturnValue(1);
    await createSaveLibrary(storage).write("manual", "third");
    expect([...storage.files.values()]).toEqual(["first", "second", "third"]);
  } finally {
    vi.restoreAllMocks();
  }
});

test("writes and deletion finish in request order; reads wait for them", async () => {
  const storage = memoryStorage();
  let finish!: () => void;
  const held = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const write = storage.write;
  const writes: string[] = [];
  storage.write = async (id, source) => {
    writes.push(source);
    if (source === "old") await held;
    await write(id, source);
  };
  const library = createSaveLibrary(storage);
  const old = library.write("quick", "old");
  const latest = library.write("quick", "latest");
  const read = library.readQuicksave();
  await Promise.resolve();
  expect(writes).toEqual(["old"]);
  finish();
  await Promise.all([old, latest]);
  expect(await read).toBe("latest");
  const pendingSave = library.write("quick", "to-delete");
  const deletion = library.remove("quicksave");
  await Promise.all([pendingSave, deletion]);
  await expect(library.readQuicksave()).rejects.toThrow("no quicksave yet");
});

test("a failed write does not poison later writes", async () => {
  const storage = memoryStorage();
  const write = storage.write;
  storage.write = async (id, source) => {
    if (source === "fail") throw new Error("Disk full");
    await write(id, source);
  };
  const library = createSaveLibrary(storage);
  const failure = library.write("quick", "fail");
  const success = library.write("quick", "success");
  await expect(failure).rejects.toThrow("Disk full");
  await success;
  expect(await library.readQuicksave()).toBe("success");
});

test("flush waits for queued mutations even after a failed request", async () => {
  const storage = memoryStorage();
  let finish!: () => void;
  const held = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const write = storage.write;
  storage.write = async (id, source) => {
    if (source === "fail") throw new Error("Disk full");
    await held;
    await write(id, source);
  };
  const library = createSaveLibrary(storage);
  const failure = library.write("quick", "fail");
  const success = library.write("quick", "saved");
  const flushed = vi.fn();
  const flush = library.flush().then(flushed);
  await expect(failure).rejects.toThrow("Disk full");
  expect(flushed).not.toHaveBeenCalled();
  finish();
  await Promise.all([success, flush]);
  expect(flushed).toHaveBeenCalledOnce();
  expect(await library.readQuicksave()).toBe("saved");
});

test("sorts timestamps chronologically across offsets and sanitizes metadata", async () => {
  const storage = memoryStorage();
  storage.files.set(
    "earlier",
    saveFile("Earlier", "2026-10-04T15:00:00+05:00"),
  );
  storage.files.set("later", saveFile("Later", "2026-10-04T11:00:00Z"));
  storage.files.set("invalid-time", saveFile("Invalid", "yesterday"));
  storage.files.set("invalid-tick", saveFile("Invalid", "", -1));
  const library = createSaveLibrary(storage);
  const entries = await library.list();
  expect(entries.map(({ id }) => id)).toEqual([
    "later",
    "earlier",
    "invalid-time",
    "invalid-tick",
  ]);
  expect(entries[1].savedAt).toBe("2026-10-04T10:00:00.000Z");
  expect(entries[2].savedAt).toBe("");
  expect(entries[3].elapsedSeconds).toBe(0);
});

test("a large library bounds concurrent reads and still lists every file", async () => {
  const storage = memoryStorage();
  for (let id = 0; id < 100; id++)
    storage.files.set(
      `manual-${id}`,
      saveFile(`Save ${id}`, "2026-10-04T10:00:00Z"),
    );
  const read = storage.read;
  let active = 0;
  let peak = 0;
  storage.read = async (id) => {
    active++;
    peak = Math.max(peak, active);
    await Promise.resolve();
    active--;
    return read(id);
  };
  const entries = await createSaveLibrary(storage).list();
  expect(entries).toHaveLength(100);
  expect(peak).toBeLessThanOrEqual(4);
  expect(
    entries.every(({ missionName }) => missionName === "Clear the wolf threat"),
  ).toBe(true);
});
