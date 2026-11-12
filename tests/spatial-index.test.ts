import { expect, test } from "vitest";

import { createSpatialIndex } from "../src/simulation/spatial-index";

import type { WorldPosition } from "../src/simulation/world";

test("local queries include every point in range across cell boundaries", () => {
  const points = Array.from({ length: 81 }, (_, index) => ({
    x: (index % 9) - 4,
    z: Math.floor(index / 9) - 4,
  }));
  const index = createSpatialIndex<WorldPosition>(2, (point) => point);
  for (const point of points) index.add(point);
  for (const center of points)
    for (const radius of [0, 0.5, 1, 3]) {
      const found = new Set<WorldPosition>();
      index.visitNear(center, radius, (point) => {
        if (Math.hypot(point.x - center.x, point.z - center.z) <= radius)
          found.add(point);
      });
      expect(found).toEqual(
        new Set(
          points.filter(
            (point) =>
              Math.hypot(point.x - center.x, point.z - center.z) <= radius,
          ),
        ),
      );
    }
});

test("wide queries visit sparse occupied cells and can stop early", () => {
  const index = createSpatialIndex<WorldPosition>(1, (point) => point);
  const points = [
    { x: -1e9, z: -1e9 },
    { x: 1e9, z: 1e9 },
  ];
  for (const point of points) index.add(point);
  const found: WorldPosition[] = [];
  index.visitNear({ x: 0, z: 0 }, Infinity, (point) => {
    found.push(point);
  });
  expect(found).toEqual(points);
  let visited = 0;
  expect(
    index.visitNear({ x: 0, z: 0 }, 1e10, () => {
      visited++;
      return false;
    }),
  ).toBe(false);
  expect(visited).toBe(1);
});
