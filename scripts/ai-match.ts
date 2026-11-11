// Runs headless AI-versus-AI skirmish cases and saves their reports.
// Usage: npm run ai:match -- [case-or-set...] [--cutoff <minutes>]
import { execFileSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { runnerImport } from "vite";
import { formatElapsed } from "../src/format-time.ts";
import { isPositive } from "../src/simulation/validation.ts";

import type { MatchReport } from "./ai-match/runner.ts";

const OUTPUT = ".checks/ai-matches";
const USAGE =
  "Usage: npm run ai:match -- [case-or-set...] [--cutoff <minutes>]";

const args = process.argv.slice(2);
const cutoffAt = args.indexOf("--cutoff");
const cutoffMinutes =
  cutoffAt >= 0 ? Number(args.splice(cutoffAt, 2)[1]) : undefined;
if (cutoffMinutes !== undefined && !isPositive(cutoffMinutes))
  throw new Error(USAGE);

const { module } = await runnerImport<typeof import("./ai-match/runner.ts")>(
  fileURLToPath(new URL("ai-match/runner.ts", import.meta.url)),
);
const { CASE_SETS, disruptionSummary, launchSummary, passed, runMatch } =
  module;
const allCases = [...CASE_SETS.values()].flat();
const selected = (name: string) =>
  CASE_SETS.get(name) ?? allCases.filter(({ id }) => id === name);
const unknown = args.filter((name) => !selected(name).length);
if (unknown.length)
  throw new Error(
    `${USAGE}\nUnknown cases: ${unknown.join(", ")}.\nSets: ${[...CASE_SETS.keys()].join(", ")}.\nCases: ${allCases.map(({ id }) => id).join(", ")}.`,
  );
const cases = [...new Set(args.length ? args.flatMap(selected) : allCases)];

const git = (...command: string[]) =>
  execFileSync("git", command, { encoding: "utf8" }).trim();
const revision = `${git("rev-parse", "HEAD")}${git("status", "--porcelain") ? "+dirty" : ""}`;

const describe = (report: MatchReport, statePath: string) => {
  switch (report.status) {
    case "completed":
      return `${report.result.kind}, eliminated ${report.result.eliminatedOwners.join(" and ")}`;
    case "incomplete":
      return `Incomplete / stalled, state in ${statePath}`;
    case "faulted":
      return `Faulted: ${report.fault}, state in ${statePath}`;
  }
};

await mkdir(OUTPUT, { recursive: true });
let failed = 0;
for (const matchCase of cases) {
  const started = performance.now();
  const { report, preservedState } = runMatch({
    ...matchCase,
    ...(cutoffMinutes && { cutoffMinutes }),
  });
  const wallSeconds = (performance.now() - started) / 1000;
  const statePath = `${OUTPUT}/${report.case}.mission.json`;
  await writeFile(
    `${OUTPUT}/${report.case}.json`,
    `${JSON.stringify({ revision, wallSeconds, ...report }, null, 2)}\n`,
  );
  // A completed rerun must not leave an earlier stopped state behind.
  if (preservedState) await writeFile(statePath, preservedState);
  else await rm(statePath, { force: true });
  console.log(
    `${report.case}: ${describe(report, statePath)} at ${formatElapsed(report.seconds)} (${wallSeconds.toFixed(1)} s)`,
  );
  console.log(`  ${launchSummary(report)}`);
  for (const line of disruptionSummary(report)) console.log(`  ${line}`);
  if (report.continuation)
    console.log(`  save/load continuation ${report.continuation}`);
  for (const problem of report.audit) console.log(`  audit: ${problem}`);
  failed += Number(!passed(report));
}
console.log(`Reports in ${OUTPUT}.`);
if (failed) {
  console.error(`${failed} of ${cases.length} cases did not pass.`);
  process.exitCode = 1;
}
