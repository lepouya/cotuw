// Reports simulation tick times, or writes a mission for browser measurement.
// Usage: npm run benchmark -- [normal|stress] [--no-ai] [--write <file>]
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { runnerImport } from "vite";
import { hasOwn } from "../src/simulation/validation.ts";

import type { Workload } from "./benchmark/workload.ts";

const USAGE =
  "Usage: npm run benchmark -- [normal|stress] [--no-ai] [--write <mission.json>]";
const args = process.argv.slice(2);
const written = args.indexOf("--write");
const output = written >= 0 ? args.splice(written, 2)[1] : undefined;
const scripted = args.indexOf("--no-ai");
if (scripted >= 0) args.splice(scripted, 1);
const ai = scripted < 0;
const { module } = await runnerImport<typeof import("./benchmark/workload.ts")>(
  fileURLToPath(new URL("benchmark/workload.ts", import.meta.url)),
);
const {
  WORKLOADS,
  createBenchmarkMission,
  createEngagedAiMission,
  measureWorkload,
} = module;

const isWorkload = (value: string): value is Workload =>
  hasOwn(WORKLOADS, value);
if (!args.every(isWorkload) || (written >= 0 && !output))
  throw new Error(USAGE);
const workloads = args.length > 0 ? args : (["normal", "stress"] as Workload[]);

if (output) {
  if (workloads.length !== 1)
    throw new Error("--write needs exactly one workload.");
  const [workload] = workloads as [Workload];
  await writeFile(
    output,
    ai ? createEngagedAiMission(workload) : createBenchmarkMission(workload),
  );
} else {
  for (const workload of workloads)
    console.log(JSON.stringify(measureWorkload(workload, { ai }), null, 2));
}
