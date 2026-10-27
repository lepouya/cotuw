import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { runChecks } from "../scripts/check-runner";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cotuw-checks-"));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

function check(name: string, code: string) {
  return { name, command: process.execPath, args: ["-e", code] };
}

test("successful checks keep stdout and stderr in logs with compact summaries", async () => {
  expect(
    await runChecks(
      [check("pass", 'console.log("details"); console.error("warning")')],
      root,
    ),
  ).toBe(0);
  const log = await readFile(join(root, ".checks/pass.log"), "utf8");
  expect(log).toContain("details");
  expect(log).toContain("warning");
  expect(console.log).toHaveBeenCalledWith(
    expect.stringContaining("PASS pass"),
  );
  expect(console.log).not.toHaveBeenCalledWith("details");
  expect(console.error).not.toHaveBeenCalled();
});

test("failure prints a bounded tail, retains the full log, and stops the run", async () => {
  expect(
    await runChecks(
      [
        check(
          "fail",
          'console.log("x".repeat(20000)); console.error("failure detail"); process.exitCode = 2',
        ),
        check("later", 'console.log("must not run")'),
      ],
      root,
    ),
  ).toBe(1);
  expect(console.error).toHaveBeenCalledWith(
    expect.stringContaining("FAIL fail"),
  );
  const tail = vi.mocked(console.error).mock.calls[1]![0] as string;
  expect(tail).toContain("failure detail");
  expect(tail.length).toBeLessThanOrEqual(12_000);
  expect(
    (await readFile(join(root, ".checks/fail.log"))).length,
  ).toBeGreaterThan(20_000);
  await expect(readFile(join(root, ".checks/later.log"))).rejects.toMatchObject(
    {
      code: "ENOENT",
    },
  );
});

test("an unavailable executable fails with a log location", async () => {
  expect(
    await runChecks(
      [{ name: "missing", command: join(root, "missing"), args: [] }],
      root,
    ),
  ).toBe(1);
  expect(console.error).toHaveBeenCalledWith(expect.stringContaining("ENOENT"));
  expect(console.error).toHaveBeenCalledWith(
    `Full output: ${join(root, ".checks/missing.log")}`,
  );
});
