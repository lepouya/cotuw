// Measures the packaged macOS app on the AI benchmark scene; see
// docs/verification.md. Usage: npm run benchmark:packaged
import { execFile, execFileSync, spawn } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runnerImport } from "vite";
import { BENCHMARK_TIMING } from "./benchmark/metrics.ts";

import type { BenchmarkCase } from "../src/benchmark-runner.ts";
import type { FrameMeasurement } from "../src/benchmark-frames.ts";
import type { Workload } from "./benchmark/workload.ts";

if (process.platform !== "darwin")
  throw new Error("The packaged benchmark requires macOS.");

const RUNTIME = "macos-app";
const REPEATS = 3;
const SERVER = "http://127.0.0.1:4791";
// A case loads, warms up, and measures well within this.
const CASE_TIMEOUT_MS = 240_000;
// The 320-pixel sidebar, 53-pixel top bar, and 32-pixel title bar leave a
// 16:9 canvas, which the runner scales to a 1920 x 1080 buffer. Windows 600
// or fewer pixels tall use the compact layout.
const WINDOW = { width: 1600, height: 805 };

const root = fileURLToPath(new URL("..", import.meta.url));
const { module } = await runnerImport<typeof import("./benchmark/workload.ts")>(
  fileURLToPath(new URL("benchmark/workload.ts", import.meta.url)),
);
const workloads = ["normal", "stress"] satisfies Workload[];
const missions = new Map(
  workloads.map((workload) => [
    workload,
    module.createEngagedAiMission(workload),
  ]),
);
const cases = Array.from({ length: REPEATS }, (_, repeat) =>
  workloads.flatMap((workload) =>
    [1, 2].map((speed) => ({ workload, speed, repeat })),
  ),
).flat();

const config = JSON.parse(
  await readFile(join(root, "src-tauri/tauri.conf.json"), "utf8"),
);
const [window] = config.app.windows;
const csp: string = config.app.security.csp;
const productName = `${config.productName} Benchmark`;
execFileSync(
  "npx",
  [
    "tauri",
    "build",
    "--bundles",
    "app",
    "--config",
    JSON.stringify({
      productName,
      identifier: `${config.identifier}.benchmark`,
      build: {
        beforeBuildCommand:
          "npm run build -- --outDir .checks/benchmark-app-site",
        frontendDist: "../.checks/benchmark-app-site",
      },
      app: {
        windows: [{ ...window, ...WINDOW, resizable: false }],
        security: {
          csp: csp.replace("connect-src", `connect-src ${SERVER}`),
        },
      },
    }),
  ],
  {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      COTUW_BENCHMARK: "1",
      COTUW_BENCHMARK_SERVER: SERVER,
    },
  },
);
const bundles = join(root, "src-tauri/target/release/bundle/macos");
const app = join(bundles, `${productName}.app`);
const [executable] = await readdir(join(app, "Contents/MacOS"));
const system = {
  macos: execFileSync("sw_vers", ["-productVersion"], {
    encoding: "utf8",
  }).trim(),
  window: WINDOW,
};

let next = 0;
const invalidCases: string[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;
let finish!: () => void;
let fail!: (error: unknown) => void;
const finished = new Promise<void>((resolve, reject) => {
  finish = resolve;
  fail = reject;
});
const watch = () => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    // Capturing the stall is best effort.
    execFile(
      "screencapture",
      ["-x", join(root, ".checks/benchmark-macos-app-stall.png")],
      () => {},
    );
    fail(new Error(`Benchmark case ${next} did not report.`));
  }, CASE_TIMEOUT_MS);
};
const readJson = async (request: AsyncIterable<unknown>) => {
  let text = "";
  for await (const chunk of request) text += chunk;
  return JSON.parse(text);
};
const server = createServer(async (request, response) => {
  response.setHeader("Access-Control-Allow-Origin", "*");
  try {
    if (request.url === "/next") {
      const current = cases[next];
      const body: BenchmarkCase = current
        ? {
            id: String(next),
            mission: missions.get(current.workload)!,
            speed: current.speed,
            probe: module.probeOptions(current.workload),
            timing: BENCHMARK_TIMING,
          }
        : { done: true };
      response.end(JSON.stringify(body));
      if (current) watch();
      else finish();
      return;
    }
    if (request.url === "/stage" && request.method === "POST") {
      const { id, stage }: { id: string; stage: string } =
        await readJson(request);
      console.log(`case ${id}: ${stage}`);
      if (stage.startsWith("failed")) fail(new Error(stage));
      response.end();
      return;
    }
    if (request.url === "/result" && request.method === "POST") {
      const { id, measured }: { id: string; measured: FrameMeasurement } =
        await readJson(request);
      if (id !== String(next) || !cases[next])
        throw new Error(`Unexpected benchmark result for case ${id}.`);
      const { workload, speed, repeat } = cases[next];
      const result = {
        ...module.frameResult(RUNTIME, workload, speed, measured),
        system,
      };
      const name = `benchmark-${RUNTIME}-${workload}-${speed}x-${repeat}.json`;
      await writeFile(
        join(root, ".checks", name),
        `${JSON.stringify(result, null, 2)}\n`,
      );
      console.log(
        `${name}: ${result.fps.toFixed(1)} FPS, ${(result.framesWithin20ms * 100).toFixed(1)}% within 20 ms, buffer ${result.buffer}`,
      );
      const problems = module.frameResultProblems(result);
      if (problems.length) invalidCases.push(`${name} ${problems.join("; ")}.`);
      next += 1;
      response.end();
      return;
    }
    response.statusCode = 404;
    response.end();
  } catch (error) {
    fail(error);
    response.statusCode = 500;
    response.end();
  }
});
await mkdir(join(root, ".checks"), { recursive: true });
await new Promise<void>((resolve, reject) => {
  server.once("error", reject);
  server.listen(Number(new URL(SERVER).port), "127.0.0.1", resolve);
});
const child = spawn(join(app, "Contents/MacOS", executable!), {
  stdio: "inherit",
});
child.once("error", fail);
child.once("exit", (code, signal) =>
  fail(new Error(`Benchmark app exited (${signal ?? code}).`)),
);
// Bring the window forward; covered windows throttle their frames.
const activate = setTimeout(
  () =>
    execFile("open", [app], (error) => {
      if (error) fail(error);
    }),
  2_000,
);
try {
  watch();
  await finished;
  if (invalidCases.length) throw new Error(invalidCases.join("\n"));
} finally {
  clearTimeout(activate);
  clearTimeout(timer);
  child.kill();
  server.close();
}
