// Measures M1 frame and tick budgets; see docs/verification.md.
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { runnerImport } from "vite";
import { expect, test } from "./fixtures";
import { importMission } from "./prototype-helpers";
import { WEBKIT } from "./tags";
import { BENCHMARK_TIMING, summarizeTimes } from "../scripts/benchmark/metrics";

import type { Workload } from "../scripts/benchmark/workload";
import type { BenchmarkProbe } from "../src/benchmark-probe";

declare global {
  var cotuwProbe: BenchmarkProbe | undefined;
}

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
        const { module } = await runnerImport<
          typeof import("../scripts/benchmark/workload")
        >(
          fileURLToPath(
            new URL("../scripts/benchmark/workload.ts", import.meta.url),
          ),
        );
        await page.goto("/");
        await importMission(page, module.createBenchmarkMission(workload));
        const canvas = page.locator("#game-canvas");
        await expect(canvas).toHaveAttribute("data-terrain-ready", "true");
        await expect(canvas).toHaveAttribute("data-models-ready", "true");
        // Reinforcement must run from the first tick, as it does headless.
        const { now: _, ...options } = module.probeOptions(workload, () => 0);
        await page.evaluate(({ scale, reinforcement, sampleTicks }) => {
          const benchmark = globalThis.cotuwBenchmark;
          if (!benchmark) throw new Error("Expected a benchmark build.");
          globalThis.cotuwProbe = benchmark.attachProbe(
            benchmark.session.simulation,
            { scale, reinforcement, sampleTicks, now: () => performance.now() },
          );
        }, options);
        await page.locator("#resume-mission").click();
        await expect(page.locator("#game-menu")).toBeHidden();
        await page.locator(`[data-speed="${speed}"]`).click();

        // The fight at the center crossing is the costliest view.
        const box = (await page.locator("#minimap").boundingBox())!;
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

        const measured = await page.evaluate(
          async ({ warmupSeconds, measureSeconds }) => {
            const probe = globalThis.cotuwProbe!;
            const { simulation } = globalThis.cotuwBenchmark!.session;
            try {
              await new Promise((resolve) =>
                setTimeout(resolve, warmupSeconds * 1_000),
              );
              const frames: number[] = [];
              let elapsed = 0;
              await new Promise<void>((resolve) => {
                requestAnimationFrame((started) => {
                  let last = started;
                  probe.measure();
                  const wallStarted = performance.now();
                  const frame = (now: number) => {
                    frames.push(now - last);
                    last = now;
                    elapsed = performance.now() - wallStarted;
                    if (elapsed < measureSeconds * 1_000)
                      requestAnimationFrame(frame);
                    else resolve();
                  };
                  requestAnimationFrame(frame);
                });
              });
              const game =
                document.querySelector<HTMLCanvasElement>("#game-canvas")!;
              const gl = game.getContext("webgl2") ?? game.getContext("webgl");
              const debug = gl?.getExtension("WEBGL_debug_renderer_info");
              return {
                frames,
                record: probe.record(),
                simulationSeconds:
                  simulation.completedTicks * simulation.tickSeconds,
                elapsed,
                renderer: debug
                  ? gl!.getParameter(debug.UNMASKED_RENDERER_WEBGL)
                  : "unknown",
                buffer: `${game.width}x${game.height}`,
              };
            } finally {
              probe.detach();
            }
          },
          BENCHMARK_TIMING,
        );

        const seconds = measured.elapsed / 1_000;
        const result = {
          browser: info.project.name,
          speed,
          renderer: measured.renderer,
          buffer: measured.buffer,
          elapsedSeconds: seconds,
          fps: measured.frames.length / seconds,
          frames: summarizeTimes(measured.frames),
          framesWithin20ms:
            measured.frames.filter((time) => time <= 20).length /
            measured.frames.length,
          ...module.summarizeRecord(workload, measured.record),
          scriptExhausted: measured.simulationSeconds > module.SCRIPT_SECONDS,
          ticksPerSecond: measured.record.ticks.length / seconds,
        };
        console.log(JSON.stringify(result));
        await mkdir(".checks", { recursive: true });
        await writeFile(
          `.checks/benchmark-${info.project.name}-${workload}-${speed}x-${info.repeatEachIndex}.json`,
          `${JSON.stringify(result, null, 2)}\n`,
        );
        expect(measured.buffer).toBe("1920x1080");
        expect(result.scriptExhausted).toBe(false);
        expect(result.population.buildingsMin).toBe(
          module.WORKLOADS[workload].buildings,
        );
        expect(result.population.unitsMin).toBeGreaterThan(0);
        expect(result.activity.attacks).toBeGreaterThan(0);
        expect(result.activity.gatheredMaterials).toBeGreaterThan(0);
        expect(result.rejected.filter((kind) => kind !== "move")).toEqual([]);
        await expect(page.locator("#game-canvas")).not.toHaveAttribute(
          "data-simulation-fault",
          "true",
        );
        await info.attach("view", {
          body: await page.screenshot(),
          contentType: "image/png",
        });
      },
    );
