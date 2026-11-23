// Plays scripted Circle openings against the ARC skirmish AI from each slot.
// Usage: npm run player:probe -- [plan...]
import { fileURLToPath } from "node:url";
import { runnerImport } from "vite";
import { formatElapsed } from "../src/format-time.ts";
import { selectPlans } from "./select-plans.ts";

const { module } = await runnerImport<
  typeof import("./player-probe/circle-player.ts")
>(fileURLToPath(new URL("player-probe/circle-player.ts", import.meta.url)));
const { PLANS, STARTS, runPlayer } = module;
const plans = selectPlans(
  process.argv.slice(2),
  PLANS,
  "Usage: npm run player:probe -- [plan...]",
);
for (const plan of plans)
  for (const start of STARTS) {
    const report = runPlayer(plan, start);
    const outcome = report.result
      ? `${report.result.kind} at ${formatElapsed(report.seconds)}`
      : "no result at cutoff";
    console.log(`${plan.id} ${start.id}: ${outcome}`);
    console.log(`  ${JSON.stringify(report)}`);
    if (!report.result) process.exitCode = 1;
  }
