import { defineConfig } from "vitest/config";

// Kept separate from vite.config.ts so unit tests never pick up the
// Playwright specs in e2e/ and don't depend on the Tauri dev-server settings.
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // Babylon probes localStorage at import; Node's webstorage warns about it
    // and Babylon falls back to memory when the global is absent.
    execArgv: ["--no-experimental-webstorage"],
  },
});
