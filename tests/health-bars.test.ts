import { expect, test } from "vitest";
import { healthBarOpacity } from "../src/render/health-bars";

test("health bars show while selected or fighting, then fade out", () => {
  expect(healthBarOpacity(true, Infinity)).toBe(1);
  expect(healthBarOpacity(false, Infinity)).toBe(0);
  expect(healthBarOpacity(false, 0)).toBe(1);
  expect(healthBarOpacity(false, 3)).toBe(1);
  expect(healthBarOpacity(false, 3.5)).toBe(0.5);
  expect(healthBarOpacity(false, 4)).toBe(0);
});
