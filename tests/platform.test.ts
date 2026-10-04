import { beforeEach, expect, test, vi } from "vitest";

import { createTauriPlatform } from "../src/platform/tauri";
import { createBrowserPlatform } from "../src/platform/browser";

const disk = vi.hoisted(() => ({
  files: new Map<string, string>(),
  failWrite: false,
  failRename: false,
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => ({
  BaseDirectory: { AppData: 14 },
  mkdir: vi.fn(async () => {}),
  readDir: vi.fn(async () =>
    [...disk.files.keys()].map((path) => ({
      name: path.slice("saves/".length),
      isFile: true,
    })),
  ),
  readTextFile: vi.fn(async (path: string) => {
    if (!disk.files.has(path)) throw new Error("Missing file");
    return disk.files.get(path);
  }),
  writeTextFile: vi.fn(async (path: string, source: string) => {
    disk.files.set(path, source);
    if (disk.failWrite) throw new Error("Write failed");
  }),
  rename: vi.fn(async (from: string, to: string) => {
    if (disk.failRename) throw new Error("Rename failed");
    disk.files.set(to, disk.files.get(from)!);
    disk.files.delete(from);
  }),
  remove: vi.fn(async (path: string) => {
    disk.files.delete(path);
  }),
}));

beforeEach(() => {
  disk.files.clear();
  disk.failWrite = false;
  disk.failRename = false;
  vi.unstubAllGlobals();
});

test("desktop saves replace an existing file after writing the new content", async () => {
  const { saves } = createTauriPlatform();
  disk.files.set("saves/quicksave.json", "old");
  await saves.write("quicksave", "new");
  expect(await saves.read("quicksave")).toBe("new");
  expect(await saves.list()).toEqual(["quicksave"]);
  expect(disk.files.size).toBe(1);
});

for (const failure of ["failWrite", "failRename"] as const)
  test(`desktop ${failure} preserves the previous save and removes partial files`, async () => {
    const { saves } = createTauriPlatform();
    disk.files.set("saves/quicksave.json", "old");
    disk[failure] = true;
    await expect(saves.write("quicksave", "partial")).rejects.toThrow("failed");
    expect(await saves.read("quicksave")).toBe("old");
    expect(disk.files.size).toBe(1);
  });

test("desktop save IDs cannot escape the save directory", async () => {
  const { saves } = createTauriPlatform();
  for (const id of ["../outside", "folder/save", "folder\\save", "save:stream"])
    for (const action of [
      () => saves.read(id),
      () => saves.write(id, "data"),
      () => saves.remove(id),
    ])
      await expect(action()).rejects.toThrow("Invalid save ID");
});

test("browser saves distinguish blocked storage from quota exhaustion", async () => {
  const { saves } = createBrowserPlatform();
  vi.stubGlobal("localStorage", {
    setItem: () => {
      throw new DOMException("Full", "QuotaExceededError");
    },
  });
  await expect(saves.write("quick", "data")).rejects.toThrow("storage is full");
  vi.stubGlobal("localStorage", {
    setItem: () => {
      throw new DOMException("Denied", "SecurityError");
    },
  });
  await expect(saves.write("quick", "data")).rejects.toThrow(
    "blocks saved games",
  );
});
