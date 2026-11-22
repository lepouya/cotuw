// Reports Circle introduction income and site strain for worker staffing plans.
// Usage: npm run cultivation:probe -- [plan...] [--minutes <n>]
import { fileURLToPath } from "node:url";
import { runnerImport } from "vite";
import { isPositive } from "../src/simulation/validation.ts";

const args = process.argv.slice(2);
const minutesAt = args.indexOf("--minutes");
const minutes = minutesAt >= 0 ? Number(args.splice(minutesAt, 2)[1]) : 10;
const { module } = await runnerImport<
  typeof import("./cultivation-probe/staffing.ts")
>(fileURLToPath(new URL("cultivation-probe/staffing.ts", import.meta.url)));
const { PLANS, runStaffing } = module;
const plans = args.length
  ? args.map((id) => PLANS.find((plan) => plan.id === id))
  : PLANS;
if (!isPositive(minutes) || plans.some((plan) => !plan))
  throw new Error(
    "Usage: npm run cultivation:probe -- [plan...] [--minutes <n>]\n" +
      `Plans: ${PLANS.map(({ id }) => id).join(", ")}.`,
  );
for (const plan of plans)
  console.log(JSON.stringify(runStaffing(plan!, minutes), null, 2));
