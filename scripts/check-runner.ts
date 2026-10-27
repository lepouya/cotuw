import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { finished } from "node:stream/promises";
import { stripVTControlCharacters } from "node:util";

export type Check = { name: string; command: string; args: string[] };

/** Streams detailed output to disk and stops at the first failed check. */
export async function runChecks(checks: Check[], root: string) {
  const directory = join(root, ".checks");
  await mkdir(directory, { recursive: true });
  const started = performance.now();
  for (const check of checks) {
    const logPath = join(directory, `${check.name}.log`);
    const log = createWriteStream(logPath);
    const stepStarted = performance.now();
    console.log(`Running ${check.name}...`);
    const child = spawn(check.command, check.args, {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, NO_COLOR: undefined, FORCE_COLOR: undefined },
    });
    child.stdout.pipe(log, { end: false });
    child.stderr.pipe(log, { end: false });
    const result = await new Promise<string | number>((resolve) => {
      child.on("error", (error) => resolve(error.message));
      child.on("close", (code, signal) =>
        resolve(signal ?? code ?? "unknown exit status"),
      );
    });
    log.end();
    await finished(log);
    const seconds = ((performance.now() - stepStarted) / 1000).toFixed(1);
    if (result !== 0) {
      console.error(`FAIL ${check.name} (${seconds}s): ${result}`);
      const output = stripVTControlCharacters(await readFile(logPath, "utf8"));
      console.error(output.slice(-12_000).split("\n").slice(-60).join("\n"));
      console.error(`Full output: ${logPath}`);
      return 1;
    }
    console.log(`PASS ${check.name} (${seconds}s)`);
  }
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  console.log(`All checks passed (${seconds}s). Logs: ${directory}`);
  return 0;
}

if (import.meta.main) {
  const tier = process.argv[2];
  if (tier !== "quick" && tier !== "full")
    throw new Error("Expected check tier: quick or full.");
  const npm = process.env.npm_execpath;
  if (!npm) throw new Error("Run checks through npm run check[:full].");
  const scripts = [
    "format:check",
    "lint",
    "typecheck",
    ...(tier === "full"
      ? ["test:ts", "test:rs", "test:visual"]
      : ["test:ts:quick", "test:visual:quick"]),
  ];
  process.exitCode = await runChecks(
    scripts.map((script) => ({
      name: script.replace(/:/g, "-"),
      command: process.execPath,
      args: [npm, "run", "--silent", script],
    })),
    process.cwd(),
  );
}
