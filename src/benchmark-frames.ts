// Times frames and ticks in the page for the browser benchmark spec and the
// packaged-app runner. Only COTUW_BENCHMARK builds include it.
import type { BenchmarkProbe, BenchmarkRecord } from "./benchmark-probe";
import type { MissionSimulation } from "./simulation/mission";

export type BenchmarkTiming = { warmupSeconds: number; measureSeconds: number };

export type FrameMeasurement = {
  /** Milliseconds between consecutive animation frames. */
  frames: number[];
  record: BenchmarkRecord;
  simulationSeconds: number;
  /** Wall-clock milliseconds the measurement spanned. */
  elapsed: number;
  renderer: string;
  /** The canvas render buffer, as `<width>x<height>`. */
  buffer: string;
};

/** Warms up, then measures until the window ends; detaches the probe. */
export async function measureFrames(
  probe: BenchmarkProbe,
  simulation: MissionSimulation,
  canvas: HTMLCanvasElement,
  { warmupSeconds, measureSeconds }: BenchmarkTiming,
): Promise<FrameMeasurement> {
  try {
    await new Promise((resolve) => setTimeout(resolve, warmupSeconds * 1_000));
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
          if (elapsed < measureSeconds * 1_000) requestAnimationFrame(frame);
          else resolve();
        };
        requestAnimationFrame(frame);
      });
    });
    if (canvas.dataset.simulationFault === "true")
      throw new Error("The benchmark simulation faulted.");
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    const debug = gl?.getExtension("WEBGL_debug_renderer_info");
    return {
      frames,
      record: probe.record(),
      simulationSeconds: simulation.completedTicks * simulation.tickSeconds,
      elapsed,
      renderer: debug
        ? String(gl!.getParameter(debug.UNMASKED_RENDERER_WEBGL))
        : "unknown",
      buffer: `${canvas.width}x${canvas.height}`,
    };
  } finally {
    probe.detach();
  }
}
