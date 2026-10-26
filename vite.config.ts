import { defineConfig } from "vite";
import process from "node:process";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(() => ({
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
}));
