import { defineConfig } from "vite";
import process from "node:process";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  // Relative URLs let any static host serve the site from a subpath.
  base: "./",
  define: {
    "import.meta.env.COTUW_BENCHMARK": !!process.env.COTUW_BENCHMARK,
  },
  // Keep Rust build errors visible during `tauri dev`.
  clearScreen: false,
  server: {
    // Tauri looks for this exact port and cannot fall back to another.
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // Generated output and Rust sources are not dev-server inputs.
      ignored: [
        "**/src-tauri/**",
        "**/playwright-report/**",
        "**/test-results/**",
        "**/playtest",
        "**/playtest/**",
        "**/.playtest-build-*",
        "**/.playtest-build-*/**",
      ],
    },
  },
});
