// Runs the host script's benchmark cases inside a packaged benchmark build;
// see docs/verification.md.
import type { BenchmarkProbeOptions } from "./benchmark-probe";
import type { BenchmarkTiming } from "./benchmark-frames";

/** One case the host serves, or the end of the run. */
export type BenchmarkCase =
  | {
      id: string;
      mission: string;
      speed: number;
      probe: Omit<BenchmarkProbeOptions, "now">;
      timing: BenchmarkTiming;
    }
  | { done: true };

const RENDER_WIDTH = 1920;

const until = async (ready: () => boolean) => {
  while (!ready()) await new Promise((resolve) => setTimeout(resolve, 100));
};

/**
 * Plays one case per page load, posting its measurement, then reloads for the
 * next so each case starts fresh, as a new browser page does.
 */
export async function runBenchmarkCase(
  server: string,
  app: { ready: () => boolean; loadSource: (source: string) => Promise<void> },
  canvas: HTMLCanvasElement,
) {
  // The host logs each stage, so a stalled case shows where it stopped.
  const request = async (path: string, body?: unknown) => {
    const response = await fetch(
      `${server}/${path}`,
      body === undefined
        ? undefined
        : { method: "POST", body: JSON.stringify(body) },
    );
    if (!response.ok)
      throw new Error(`Benchmark host rejected ${path} (${response.status}).`);
    return response;
  };
  const next: BenchmarkCase = await (await request("next")).json();
  if ("done" in next) return;
  try {
    await until(app.ready);
    await request("stage", { id: next.id, stage: "ready" });
    await app.loadSource(next.mission);
    const benchmark = globalThis.cotuwBenchmark;
    if (!benchmark) throw new Error("The benchmark mission did not start.");
    await request("stage", { id: next.id, stage: "started" });
    await until(
      () =>
        canvas.dataset.terrainReady === "true" &&
        canvas.dataset.modelsReady === "true",
    );
    await request("stage", { id: next.id, stage: "loaded" });
    // Render the same 1920 x 1080 buffer as the browser runs at any pixel ratio.
    benchmark.scene
      .getEngine()
      .setHardwareScalingLevel(canvas.clientWidth / RENDER_WIDTH);
    const probe = benchmark.prepare(next.speed, next.probe);
    document.querySelector<HTMLButtonElement>("#resume-mission")!.click();
    const measured = await benchmark.measure(probe, next.timing);
    await request("result", { id: next.id, measured });
    location.reload();
  } catch (error) {
    await request("stage", { id: next.id, stage: `failed: ${String(error)}` });
  }
}
