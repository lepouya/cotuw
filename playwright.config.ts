import { defineConfig } from "@playwright/test";

const testPort = Number(process.env.COTUW_TEST_PORT ?? 1420);
if (!Number.isInteger(testPort) || testPort < 1 || testPort > 65535)
  throw new RangeError("COTUW_TEST_PORT must be an integer from 1 to 65535.");
const testUrl = `http://127.0.0.1:${testPort}`;

export default defineConfig({
  testDir: "./e2e",
  // Concurrent WebGL scenes compete for rendering time, including software
  // GPUs; CI runners are small enough that two scenes starve each other.
  workers: process.env.CI ? 1 : 2,
  // Windows WebGL canvas captures can take longer than the default budget.
  timeout: 90_000,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report" }],
  ],
  // macOS builds run in WKWebView, so WebKit is checked there too. Windows uses
  // WebView2, which Chromium covers.
  projects: [
    // Full headless Chromium uses the GPU; the headless shell falls back to
    // software WebGL, which slows its checks enough to time out.
    { name: "chromium", use: { browserName: "chromium", channel: "chromium" } },
    ...(process.platform === "darwin"
      ? [{ name: "webkit", use: { browserName: "webkit" as const } }]
      : []),
  ],
  use: {
    baseURL: testUrl,
    viewport: { width: 1280, height: 720 },
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${testPort} --strictPort`,
    url: testUrl,
    reuseExistingServer: !process.env.CI,
  },
});
