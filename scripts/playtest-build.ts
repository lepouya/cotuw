import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cp,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { build } from "vite";

const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

function sourceIdentity(root: string) {
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  return {
    revision: git("rev-parse", "HEAD"),
    dirty:
      git(
        "status",
        "--porcelain",
        "--untracked-files=all",
        "--ignore-submodules=none",
      ) !== "",
  };
}

async function bundleFiles(directory: string) {
  const entries = await readdir(directory, {
    recursive: true,
    withFileTypes: true,
  });
  const paths = entries
    .filter((entry) => entry.isFile())
    .map((entry) =>
      relative(directory, join(entry.parentPath, entry.name))
        .split(sep)
        .join("/"),
    )
    .sort();
  return Promise.all(
    paths.map(async (path) => {
      const bytes = await readFile(join(directory, path));
      return { path, bytes: bytes.length, sha256: sha256(bytes) };
    }),
  );
}

/** Stages a complete bundle before replacing the previous one. */
export async function preparePlaytest(
  root: string,
  { allowDirty = false }: { allowDirty?: boolean } = {},
) {
  const before = sourceIdentity(root);
  if (before.dirty && !allowDirty)
    throw new Error(
      "Playtest distribution requires a clean working tree. " +
        "Use --allow-dirty for a local preview only.",
    );

  const stage = await mkdtemp(join(root, ".playtest-build-"));
  const bundle = join(stage, "bundle");
  const target = join(root, "playtest");
  const backup = join(stage, "previous");
  let keepBackup = false;
  try {
    // A private output directory prevents interference with ordinary builds.
    await build({
      root,
      build: { outDir: join(bundle, "site"), emptyOutDir: true },
    });
    await cp(
      join(root, "docs/playtest-instructions.md"),
      join(bundle, "README.md"),
    );
    await cp(
      join(root, "docs/playtest-report.md"),
      join(bundle, "playtest-report.md"),
    );
    const files = await bundleFiles(bundle);
    const lockfileSha256 = sha256(
      await readFile(join(root, "package-lock.json")),
    );
    const after = sourceIdentity(root);
    const distributionReady =
      !before.dirty && !after.dirty && before.revision === after.revision;
    if (!distributionReady && !allowDirty)
      throw new Error(
        "Sources changed during the playtest build. Rebuild from a clean working tree.",
      );

    const manifest = {
      formatVersion: 1,
      missionId: "arc-economy-opening",
      revision: before.revision,
      distributionReady,
      node: process.version,
      packageManager: process.env.npm_config_user_agent ?? "unknown",
      lockfileSha256,
      files,
    };
    await writeFile(
      join(bundle, "build.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );

    let hadPrevious = false;
    try {
      await rename(target, backup);
      hadPrevious = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    try {
      await rename(bundle, target);
    } catch (error) {
      if (hadPrevious) {
        try {
          await rename(backup, target);
        } catch (restoreError) {
          keepBackup = true;
          throw Object.assign(
            new Error(
              `Could not restore the previous bundle; it remains at ${backup}.`,
            ),
            { errors: [error, restoreError] },
          );
        }
      }
      throw error;
    }
    return manifest;
  } finally {
    if (!keepBackup) await rm(stage, { recursive: true, force: true });
  }
}
