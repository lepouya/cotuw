// Playwright imports this directly, so it stays free of Vite-only modules.
import type { PopulationSample } from "../../src/benchmark-probe.ts";

export const BENCHMARK_TIMING = {
  warmupSeconds: 10,
  measureSeconds: 60,
  sampleSeconds: 5,
} as const;

export function summarizeTimes(values: readonly number[]) {
  if (!values.length) throw new RangeError("No timing samples collected.");
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (share: number) =>
    sorted[Math.max(0, Math.ceil(sorted.length * share) - 1)]!;
  return {
    count: sorted.length,
    p50: percentile(0.5),
    p95: percentile(0.95),
    p99: percentile(0.99),
    max: sorted[sorted.length - 1]!,
  };
}

export function summarizePopulation(samples: readonly PopulationSample[]) {
  if (!samples.length) throw new RangeError("No population samples collected.");
  const units = samples.map((sample) => sample.units);
  const buildings = samples.map((sample) => sample.buildings);
  return {
    unitsMin: Math.min(...units),
    unitsMax: Math.max(...units),
    unitsMean: units.reduce((total, count) => total + count, 0) / units.length,
    buildingsMin: Math.min(...buildings),
    buildingsMax: Math.max(...buildings),
    samples,
  };
}
