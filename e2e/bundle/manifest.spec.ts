import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

import type { preparePlaytest } from "../../scripts/playtest-build";

// Checks the prepared manifest and the served files without a browser.

type Manifest = Awaited<ReturnType<typeof preparePlaytest>>;

const manifest = async (): Promise<Manifest> =>
  JSON.parse(
    await readFile(
      new URL("../../playtest/build.json", import.meta.url),
      "utf8",
    ),
  );

test("the bundle is ready for distribution", async () => {
  const { distributionReady, revision } = await manifest();
  test.info().annotations.push({ type: "revision", description: revision });
  expect(distributionReady, "Rebuild from a clean checkout").toBe(true);
});

test("the served site matches the prepared bundle", async ({ request }) => {
  const { files, formatVersion, revision } = await manifest();
  test.info().annotations.push({ type: "revision", description: revision });
  expect(formatVersion).toBe(2);
  const site = files.filter(
    ({ path }) => path.startsWith("site/") && path !== "site/.nojekyll",
  );
  expect(site.map(({ path }) => path)).toContain("site/index.html");
  const mismatched: string[] = [];
  for (const { path, bytes, sha256 } of site) {
    const url = path.split("/").slice(1).map(encodeURIComponent).join("/");
    const response = await request.get(url);
    try {
      const body = await response.body();
      if (
        !response.ok() ||
        body.length !== bytes ||
        createHash("sha256").update(body).digest("hex") !== sha256
      )
        mismatched.push(`${response.status()} ${path}`);
    } finally {
      await response.dispose();
    }
  }
  expect(mismatched).toEqual([]);
});
