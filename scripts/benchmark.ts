// Reports simulation tick times, or writes a mission for browser measurement.
// Usage: npm run benchmark -- [normal|stress] [--write <mission.json>]
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { runnerImport } from "vite";
import { hasOwn } from "../src/simulation/validation.ts";

const args = process.argv.slice(2);
const written = args.indexOf("--write");
const output = written >= 0 ? args.splice(written, 2)[1] : undefined;
const { module } = await runnerImport<typeof import("./benchmark/workload.ts")>(
  fileURLToPath(new URL("benchmark/workload.ts", import.meta.url)),
);
const { WORKLOADS, createBenchmarkMission, measureWorkload } = module;
type Workload = keyof typeof WORKLOADS;

const isWorkload = (value: string): value is Workload =>
  hasOwn(WORKLOADS, value);
if (!args.every(isWorkload) || (written >= 0 && !output))
  throw new Error(
    "Usage: npm run benchmark -- [normal|stress] [--write <mission.json>]",
  );
const workloads = args.length > 0 ? args : (["normal", "stress"] as Workload[]);

if (output) {
  if (workloads.length !== 1)
    throw new Error("--write needs exactly one workload.");
  await writeFile(output, createBenchmarkMission(workloads[0]!));
} else {
  for (const workload of workloads)
    console.log(
      JSON.stringify(
        measureWorkload(workload, () => performance.now()),
        null,
        2,
      ),
    );
}
