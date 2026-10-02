import { expect, test } from "vitest";
import { NavigationChangeLog } from "../src/simulation/navigation-changes";

test("navigation queries cannot mutate retained changes", () => {
  const log = new NavigationChangeLog(2);
  log.record(
    { minX: 1, minZ: 1, maxX: 2, maxZ: 2 },
    { layers: ["surface"], effect: "increase" },
  );
  const expected = log.entriesSince(0);
  const entries = log.entriesSince(0)!;
  entries[0]!.bounds.minX = 99;
  entries[0]!.layers![0] = "air";
  const bounds = log.since(0)!;
  (bounds[0]! as { minZ: number }).minZ = 99;
  expect(log.entriesSince(0, "surface")).toEqual(expected);
  expect(log.entriesSince(0, "air")).toEqual([]);
});
