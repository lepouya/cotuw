import { availableParallelism } from "node:os";
import { configDefaults, defineConfig } from "vitest/config";

const assetTests = ["tests/**/*-assets.test.ts"];

// Kept separate from vite.config.ts so unit tests never pick up the
// Playwright specs in e2e/ and don't depend on the Tauri dev-server settings.
export default defineConfig({
  test: {
    silent: "passed-only",
    // Leave CPU capacity for the game and editor during development.
    maxWorkers: Math.max(1, Math.min(2, availableParallelism() - 1)),
    // Babylon probes localStorage at import; Node's webstorage warns about it
    // and Babylon falls back to memory when the global is absent.
    execArgv: ["--no-experimental-webstorage"],
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["tests/**/*.test.ts"],
          exclude: [...configDefaults.exclude, ...assetTests],
        },
      },
      {
        extends: true,
        test: {
          name: "assets",
          include: assetTests,
        },
      },
    ],
  },
});
