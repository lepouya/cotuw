import { expect, test } from "@playwright/test";

import type { Page } from "@playwright/test";

/** In-page test helpers, loaded by `openHarness`. */
declare const harness: typeof import("./harness");
declare const testView: ReturnType<typeof harness.createTestView>;

const MINIMAP_SIZE = 200;

async function openMinimapView(page: Page): Promise<void> {
  await page.goto("/");
  await page.evaluate(async (minimapSize) => {
    const harnessPath: string = "/e2e/harness.ts";
    const loaded: typeof harness = await import(harnessPath);
    Object.assign(window, {
      harness: loaded,
      testView: loaded.createTestView({ minimapSize }),
    });
    await loaded.frames(2);
  }, MINIMAP_SIZE);
}

const cameraTarget = (page: Page) =>
  page.evaluate(() => {
    const { x, z } = testView.camera.target;
    return { x, z };
  });

const viewportOutline = (page: Page) =>
  page.evaluate((size) => {
    const projection = harness.minimapProjection(testView.map, size, size);
    return testView.view.camera.viewFootprint().map(projection.toMinimap);
  }, MINIMAP_SIZE);

/** The world point under a minimap pixel, per the minimap's own projection. */
const worldAt = (page: Page, x: number, y: number) =>
  page.evaluate(
    ({ x, y, size }) => {
      const point = harness
        .minimapProjection(testView.map, size, size)
        .toWorld({ x, y });
      return { x: point.x, z: point.z };
    },
    { x, y, size: MINIMAP_SIZE },
  );

async function settle(page: Page): Promise<void> {
  // Outlasts the glide, then lets the minimap redraw.
  await page.waitForTimeout(500);
  await page.evaluate(() => harness.frames(2));
}

test("clicking the minimap glides the camera to that point", async ({
  page,
}) => {
  await openMinimapView(page);
  const destination = await worldAt(page, 150, 60);

  await page.mouse.click(150, 60);
  await settle(page);

  const target = await cameraTarget(page);
  expect(target.x).toBeCloseTo(destination.x, 1);
  expect(target.z).toBeCloseTo(destination.z, 1);
});

test("dragging the outline pans without jumping to the pointer", async ({
  page,
}) => {
  await openMinimapView(page);
  await page.mouse.click(100, 100);
  await settle(page);
  const before = await cameraTarget(page);
  const outline = await viewportOutline(page);
  // Hit the middle of the visible edge, not merely the viewport interior.
  const startPoint = {
    x: (outline[0].x + outline[1].x) / 2,
    y: (outline[0].y + outline[1].y) / 2,
  };
  const endPoint = { x: startPoint.x - 20, y: startPoint.y + 20 };
  const start = await worldAt(page, startPoint.x, startPoint.y);
  const end = await worldAt(page, endPoint.x, endPoint.y);

  // Grabs the outline off-center; the view must keep that grip.
  await page.mouse.move(startPoint.x, startPoint.y);
  await page.mouse.down();
  await page.mouse.move(
    (startPoint.x + endPoint.x) / 2,
    (startPoint.y + endPoint.y) / 2,
    { steps: 4 },
  );
  await page.mouse.move(endPoint.x, endPoint.y, { steps: 4 });
  await page.mouse.up();
  await page.evaluate(() => harness.frames(2));

  const after = await cameraTarget(page);
  expect(after.x - before.x).toBeCloseTo(end.x - start.x, 1);
  expect(after.z - before.z).toBeCloseTo(end.z - start.z, 1);
});

test("scrolling over the minimap never zooms the main view", async ({
  page,
}) => {
  await openMinimapView(page);
  const viewHeight = () =>
    page.evaluate(() => harness.viewHeight(testView.camera));
  const heightBefore = await viewHeight();

  await page.mouse.move(100, 100);
  await page.mouse.wheel(0, 2_000);
  await page.evaluate(() => harness.frames(2));

  expect(await viewHeight()).toBe(heightBefore);
});
