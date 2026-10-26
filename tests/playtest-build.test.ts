import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { build } from "vite";
import { preparePlaytest } from "../scripts/playtest-build";

import type { InlineConfig } from "vite";

vi.mock("vite", () => ({ build: vi.fn() }));
vi.mock("node:fs/promises", async (original) => ({
  ...(await original<typeof import("node:fs/promises")>()),
  rename: vi.fn(),
}));
const realFs =
  await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");

let root: string;
const git = (...args: string[]) =>
  execFileSync(
    "git",
    [
      "-c",
      "user.name=Playtest fixture",
      "-c",
      "user.email=playtest@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "-c",
      `core.hooksPath=${join(root, "no-hooks")}`,
      ...args,
    ],
    { cwd: root, encoding: "utf8" },
  ).trim();

async function compile(config?: InlineConfig) {
  const output = config!.build!.outDir!;
  await mkdir(join(output, "assets"), { recursive: true });
  await writeFile(
    join(output, "index.html"),
    '<script src="/assets/game.js"></script>',
  );
  await writeFile(
    join(output, "assets/game.js"),
    "export const game = true;\n",
  );
  return [];
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cotuw-playtest-test-"));
  await mkdir(join(root, "docs"));
  await writeFile(
    join(root, ".gitignore"),
    "playtest/\ndist/\n.playtest-build-*/\n",
  );
  await writeFile(
    join(root, "docs/playtest-instructions.md"),
    "Instructions\n",
  );
  await writeFile(join(root, "docs/playtest-report.md"), "Report\n");
  await writeFile(join(root, "package-lock.json"), "{}\n");
  await writeFile(join(root, "source.js"), "export const source = true;\n");
  git("init", "-q");
  git("add", ".");
  git("commit", "-qm", "Fixture");
  vi.mocked(build).mockReset().mockImplementation(compile);
  vi.mocked(rename).mockReset().mockImplementation(realFs.rename);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function previousBundle() {
  await mkdir(join(root, "playtest"));
  await writeFile(join(root, "playtest/previous.txt"), "Keep this bundle\n");
}

async function expectPreviousBundle() {
  expect(await readdir(join(root, "playtest"))).toEqual(["previous.txt"]);
  expect(await readFile(join(root, "playtest/previous.txt"), "utf8")).toBe(
    "Keep this bundle\n",
  );
  expect(
    (await readdir(root)).filter((name) => name.startsWith(".playtest-build-")),
  ).toEqual([]);
}

test("publishes a complete clean bundle with reproducible hashes without changing dist", async () => {
  await previousBundle();
  await mkdir(join(root, "dist"));
  await writeFile(join(root, "dist/keep.txt"), "Ordinary build\n");
  const manifest = await preparePlaytest(root);
  expect(manifest.distributionReady).toBe(true);
  expect(manifest.revision).toBe(git("rev-parse", "HEAD"));
  expect(manifest.files.map(({ path }) => path)).toEqual([
    "README.md",
    "playtest-report.md",
    "site/assets/game.js",
    "site/index.html",
  ]);
  for (const file of manifest.files) {
    const bytes = await readFile(join(root, "playtest", file.path));
    expect(bytes.length).toBe(file.bytes);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(file.sha256);
  }
  expect(
    JSON.parse(await readFile(join(root, "playtest/build.json"), "utf8")),
  ).toEqual(manifest);
  expect(await readFile(join(root, "dist/keep.txt"), "utf8")).toBe(
    "Ordinary build\n",
  );
  expect(await readdir(join(root, "playtest"))).not.toContain("previous.txt");
  expect(await preparePlaytest(root)).toEqual(manifest);
});

test("untracked source cannot be hidden by the user's Git configuration", async () => {
  await previousBundle();
  git("config", "status.showUntrackedFiles", "no");
  await writeFile(join(root, "new-source.js"), "New source\n");
  expect(git("status", "--porcelain")).toBe("");
  await expect(preparePlaytest(root)).rejects.toThrow("clean working tree");
  expect(build).not.toHaveBeenCalled();
  await expectPreviousBundle();
});

test("modified tracked files also reject distribution builds", async () => {
  await previousBundle();
  await writeFile(join(root, "source.js"), "Modified source\n");
  await expect(preparePlaytest(root)).rejects.toThrow("clean working tree");
  expect(build).not.toHaveBeenCalled();
  await expectPreviousBundle();
});

test("explicit previews of modified sources cannot be marked distribution-ready", async () => {
  await writeFile(join(root, "source.js"), "Modified source\n");
  expect(
    (await preparePlaytest(root, { allowDirty: true })).distributionReady,
  ).toBe(false);
});

test.each(["source edit", "revision change"])(
  "rejects a %s during compilation and preserves the previous bundle",
  async (change) => {
    await previousBundle();
    vi.mocked(build).mockImplementation(async (config) => {
      await compile(config);
      if (change === "source edit")
        await writeFile(join(root, "source.js"), "Edited during build\n");
      else git("commit", "--allow-empty", "-qm", "Changed revision");
      return [];
    });
    await expect(preparePlaytest(root)).rejects.toThrow(
      "Sources changed during",
    );
    await expectPreviousBundle();
  },
);

test("a source edit during an allowed preview makes the bundle nondistributable", async () => {
  vi.mocked(build).mockImplementation(async (config) => {
    await compile(config);
    await writeFile(join(root, "source.js"), "Edited during build\n");
    return [];
  });
  expect(
    (await preparePlaytest(root, { allowDirty: true })).distributionReady,
  ).toBe(false);
});

test("compiler failure preserves the previous bundle and removes staging files", async () => {
  await previousBundle();
  vi.mocked(build).mockRejectedValue(new Error("Compilation failed"));
  await expect(preparePlaytest(root)).rejects.toThrow("Compilation failed");
  await expectPreviousBundle();
});

test("document-copy failure preserves the previous bundle", async () => {
  await previousBundle();
  vi.mocked(build).mockImplementation(async (config) => {
    await compile(config);
    await rm(join(root, "docs/playtest-report.md"));
    return [];
  });
  await expect(preparePlaytest(root)).rejects.toMatchObject({ code: "ENOENT" });
  await expectPreviousBundle();
});

test("publication failure restores the previous bundle", async () => {
  await previousBundle();
  vi.mocked(rename).mockImplementation(async (from, to) => {
    if (String(from).endsWith("bundle")) throw new Error("Publication failed");
    return realFs.rename(from, to);
  });
  await expect(preparePlaytest(root)).rejects.toThrow("Publication failed");
  await expectPreviousBundle();
});

test("failed restoration retains the previous bundle at the reported recovery path", async () => {
  await previousBundle();
  vi.mocked(rename).mockImplementation(async (from, to) => {
    if (to === join(root, "playtest")) throw new Error("Target unavailable");
    return realFs.rename(from, to);
  });
  await expect(preparePlaytest(root)).rejects.toThrow(
    /previous bundle; it remains at/,
  );
  const stage = (await readdir(root)).find((name) =>
    name.startsWith(".playtest-build-"),
  )!;
  expect(
    await readFile(join(root, stage, "previous/previous.txt"), "utf8"),
  ).toBe("Keep this bundle\n");
});
