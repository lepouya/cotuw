// Measures M1 frame and tick budgets; see docs/verification.md.
import { mkdir, writeFile } from "node:fs/promises";
import { openBenchmarkScene } from "./benchmark-scene";
import { expect, test } from "./fixtures";
import { attachScreenshot } from "./page-helpers";
import { WEBKIT } from "./tags";
import { BENCHMARK_TIMING } from "../scripts/benchmark/metrics";

import type { Workload } from "../scripts/benchmark/workload";

test.skip(!process.env.COTUW_BENCHMARK, "Set COTUW_BENCHMARK=1 to measure.");
// The sidebar and top bar surround the canvas, which must render 1920 x 1080.
test.use({ viewport: { width: 2240, height: 1133 }, deviceScaleFactor: 1 });

for (const workload of ["normal", "stress"] satisfies Workload[])
  for (const speed of [1, 2])
    test(
      `${workload} workload at ${speed}x`,
      { tag: WEBKIT },
      async ({ page }, info) => {
        test.setTimeout(240_000);
        const module = await openBenchmarkScene(page, workload);
        const measured = await page.evaluate(
          ({ speed, options, timing }) => {
            const benchmark = globalThis.cotuwBenchmark;
            if (!benchmark) throw new Error("Expected a benchmark build.");
            const probe = benchmark.prepare(speed, options);
            document
              .querySelector<HTMLButtonElement>("#resume-mission")!
              .click();
            return benchmark.measure(probe, timing);
          },
          {
            speed,
            options: module.probeOptions(workload),
            timing: BENCHMARK_TIMING,
          },
        );
        const result = module.frameResult(
          info.project.name,
          workload,
          speed,
          measured,
        );
        console.log(JSON.stringify(result));
        await mkdir(".checks", { recursive: true });
        await writeFile(
          `.checks/benchmark-${info.project.name}-${workload}-${speed}x-${info.repeatEachIndex}.json`,
          `${JSON.stringify(result, null, 2)}\n`,
        );
        expect(module.frameResultProblems(result)).toEqual([]);
        await expect(page.locator("#game-canvas")).not.toHaveAttribute(
          "data-simulation-fault",
          "true",
        );
        await attachScreenshot(page, info, "view");
      },
    );
