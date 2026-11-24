// Shared setup for the specs that measure the AI benchmark scene.
import { fileURLToPath } from "node:url";
import { expect } from "@playwright/test";
import { runnerImport } from "vite";
import { importMission } from "./page-helpers";

import type { Page } from "@playwright/test";
import type { Workload } from "../scripts/benchmark/workload";

/**
 * Loads the workload's AI scene and waits for its assets. Returns the
 * workload module, which the spec's Node side uses for options and reports.
 */
export async function openBenchmarkScene(page: Page, workload: Workload) {
  const { module } = await runnerImport<
    typeof import("../scripts/benchmark/workload")
  >(
    fileURLToPath(new URL("../scripts/benchmark/workload.ts", import.meta.url)),
  );
  await page.goto("/");
  // The AI scene resumes a minute past the opening grace.
  await importMission(page, module.createEngagedAiMission(workload));
  const canvas = page.locator("#game-canvas");
  await expect(canvas).toHaveAttribute("data-terrain-ready", "true");
  await expect(canvas).toHaveAttribute("data-models-ready", "true");
  return module;
}
