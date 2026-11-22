import { expect, test } from "vitest";

import { PLANS, runStaffing } from "../scripts/cultivation-probe/staffing";

const plan = (id: string) => PLANS.find((plan) => plan.id === id)!;

test("one Cultivator per introduction site stays Healthy", () => {
  const report = runStaffing(plan("one-per-site"), 5);
  for (const site of Object.values(report.sites))
    expect(site).toMatchObject({ strainedSeconds: 0, dormancies: 0 });
  expect(report.lifebloom.perMinuteAfterStaffed).toBeGreaterThan(100);
}, 30_000);

test("crowding one introduction site forces dormancy and waiting", () => {
  const report = runStaffing(plan("three-near"), 6);
  expect(report.sites["near-lifebloom"]!.dormancies).toBeGreaterThan(0);
  expect(report.phases.waiting).toBeGreaterThan(0);
}, 30_000);

test("staffing plans reject unknown sites", () => {
  expect(() =>
    runStaffing({ id: "missing", sites: ["missing-site"] }, 1),
  ).toThrow("unknown sites missing-site");
});
