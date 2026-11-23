// Reports Circle introduction income and site strain for worker staffing plans.
// Usage: npm run cultivation:probe -- [plan...] [--minutes <n>]
import { fileURLToPath } from "node:url";
import { runnerImport } from "vite";
import { isPositive } from "../src/simulation/validation.ts";
import { selectPlans } from "./select-plans.ts";

const args = process.argv.slice(2);
const minutesAt = args.indexOf("--minutes");
const minutes = minutesAt >= 0 ? Number(args.splice(minutesAt, 2)[1]) : 10;
const { module } = await runnerImport<
  typeof import("./cultivation-probe/staffing.ts")
>(fileURLToPath(new URL("cultivation-probe/staffing.ts", import.meta.url)));
const { PLANS, runStaffing } = module;
const usage = "Usage: npm run cultivation:probe -- [plan...] [--minutes <n>]";
if (!isPositive(minutes)) throw new Error(usage);
for (const plan of selectPlans(args, PLANS, usage))
  console.log(JSON.stringify(runStaffing(plan, minutes), null, 2));
