import { defineConfig } from "@playwright/test";

// Smoke-tests the prepared `playtest/site` bundle, or a hosted copy of it at
// COTUW_PLAYTEST_URL, through production builds only.
const hosted = process.env.COTUW_PLAYTEST_URL;
const port = Number(process.env.COTUW_TEST_PORT ?? 4174);
if (!hosted && (!Number.isInteger(port) || port < 1 || port > 65535))
  throw new RangeError("COTUW_TEST_PORT must be an integer from 1 to 65535.");
const base = "/playtest/";
const local = `http://127.0.0.1:${port}${base}`;

export default defineConfig({
  testDir: "./e2e/bundle",
  forbidOnly: !!process.env.CI,
  workers: 1,
  timeout: 240_000,
  outputDir: ".checks/playtest-results",
  reporter: [
    ["dot"],
    ["html", { open: "never", outputFolder: ".checks/playtest-report" }],
  ],
  projects: [
    // Manifest and file checks need no browser, so they run once.
    { name: "files", testMatch: "manifest.spec.ts" },
    {
      name: "chromium",
      testIgnore: "manifest.spec.ts",
      use: { browserName: "chromium", channel: "chromium" },
    },
    ...(process.platform === "darwin"
      ? [
          {
            name: "webkit",
            testIgnore: "manifest.spec.ts",
            use: { browserName: "webkit" as const },
          },
        ]
      : []),
  ],
  use: {
    // A trailing slash keeps relative links under a subpath host.
    baseURL: hosted ? hosted.replace(/\/?$/, "/") : local,
    viewport: { width: 1280, height: 720 },
    // Report a stuck step instead of waiting for the test timeout.
    actionTimeout: 30_000,
    screenshot: "only-on-failure",
  },
  webServer: hosted
    ? undefined
    : {
        command: `npm run preview -- --outDir playtest/site --base ${base} --host 127.0.0.1 --port ${port} --strictPort`,
        url: local,
        timeout: 60_000,
        reuseExistingServer: false,
      },
});
