import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  // Windows WebGL canvas captures can take longer than the default budget.
  timeout: 90_000,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report" }],
  ],
  // macOS builds run in WKWebView, so WebKit is checked there too. Windows uses
  // WebView2, which Chromium covers.
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    ...(process.platform === "darwin"
      ? [{ name: "webkit", use: { browserName: "webkit" as const } }]
      : []),
  ],
  use: {
    baseURL: "http://127.0.0.1:1420",
    viewport: { width: 1280, height: 720 },
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1",
    url: "http://127.0.0.1:1420",
    reuseExistingServer: !process.env.CI,
  },
});
