import { expect, test } from "@playwright/test";
import { forEachProfile, PHONE_PROFILE } from "./profiles";
import type { Page } from "@playwright/test";
import { activate, trainTestUnits } from "./prototype-helpers";
import { WEBKIT } from "./tags";

/**
 * Legs in tiles to the screen's right and down from the centered trooper. At
 * half speed the route outlasts each check; small offsets keep every point
 * clear of the minimap and camera controls on every screen size.
 */
const ROUTE = [
  [5, 0],
  [5, 3],
  [0, 3],
] as const;
/** Where an unqueued order replaces the route. */
const REPLACEMENT = [-4, -3] as const;

async function opening(page: Page, touch = false) {
  await page.goto("/?level=sandbox");
  await trainTestUnits(page, ["trooper"], touch);
  await activate(page.locator("#unit-roster button").first(), touch);
  await expect(page.locator("#game-canvas")).toHaveAttribute(
    "data-selected-actors",
    '["trained-unit-1"]',
  );
  await activate(page.locator('[data-speed="0.5"]'), touch);
  await activate(page.locator("#focus-selection"), touch);
  // Outlasts the 0.3 second glide.
  await page.waitForTimeout(400);
}

/** Screen points for tile offsets from the trooper, fixed before it moves. */
async function routePoints(
  page: Page,
  offsets: readonly (readonly [number, number])[],
) {
  const points = await page.evaluate(async (offsets) => {
    const path: string = "/e2e/harness.ts";
    const { EngineStore, Vector3, projectToCanvas, prototypeTerrainMap } =
      (await import(path)) as typeof import("./harness");
    const scene = EngineStore.Instances[0].scenes[0];
    const canvas = document.querySelector<HTMLCanvasElement>("#game-canvas")!;
    const map = prototypeTerrainMap();
    const unit = scene
      .getTransformNodeByName("actor-trained-unit-1-root")!
      .getAbsolutePosition();
    // Screen up along the ground; screen right is a quarter turn clockwise.
    const view = scene.activeCamera!.getDirection(Vector3.Forward());
    const length = Math.hypot(view.x, view.z);
    const up = { x: view.x / length, z: view.z / length };
    return offsets.map(([right, down]) => {
      const x = unit.x + up.z * right - up.x * down;
      const z = unit.z - up.x * right - up.z * down;
      const point = projectToCanvas(
        scene,
        canvas,
        new Vector3(x, map.heightAtWorldPosition(x, z), z),
      );
      return {
        ...point,
        clear: document.elementFromPoint(point.x, point.y) === canvas,
      };
    });
  }, offsets);
  // A point under the minimap or controls would never reach the world.
  expect(points.map(({ clear }) => clear)).not.toContain(false);
  return points;
}

/** Whether the queued-order preview is drawn. */
async function preview(page: Page) {
  return page.evaluate(async () => {
    const path: string = "/e2e/harness.ts";
    const { EngineStore } = (await import(path)) as typeof import("./harness");
    return !!EngineStore.Instances[0].scenes[0].getMeshByName("queued-orders");
  });
}

async function minimapTarget(page: Page) {
  return page.evaluate(async () => {
    const path: string = "/e2e/harness.ts";
    const { minimapProjection, prototypeTerrainMap } = (await import(
      path
    )) as typeof import("./harness");
    const map = prototypeTerrainMap();
    const canvas = document.querySelector<HTMLCanvasElement>("#minimap")!;
    const bounds = canvas.getBoundingClientRect();
    const point = minimapProjection(
      map,
      canvas.clientWidth,
      canvas.clientHeight,
    ).toMinimap(map.tileCenter(54, 49));
    return {
      x: bounds.left + canvas.clientLeft + point.x,
      y: bounds.top + canvas.clientTop + point.y,
    };
  });
}

test("Shift queues Attack Move on the minimap and retains target mode", async ({
  page,
}) => {
  await opening(page);
  const target = await minimapTarget(page);
  await page.locator("#attack-move").click();
  await page.keyboard.down("Shift");
  await page.mouse.click(target.x, target.y);
  await page.keyboard.up("Shift");
  // An idle unit starts immediately; the targeting mode still stays queued.
  await expect(page.locator("#movement-status")).toContainText(
    /Attack Move order (accepted|queued)/,
  );
  await expect(page.locator("#cancel-attack-move")).toBeVisible();
  await page.mouse.click(target.x, target.y);
  await expect(page.locator("#cancel-attack-move")).toBeHidden();
});

test("Shift-click queues moves behind the current one with a route preview", async ({
  page,
}) => {
  await opening(page);
  const status = page.locator("#movement-status");
  const [first, ...queued] = await routePoints(page, ROUTE);
  const [replacement] = await routePoints(page, [REPLACEMENT]);
  await page.mouse.click(first!.x, first!.y);
  await expect(status).toContainText("1 move order accepted");
  await page.keyboard.down("Shift");
  for (const point of queued) {
    await page.mouse.click(point.x, point.y);
    await expect(status).toContainText("1 move order queued");
  }
  await page.keyboard.up("Shift");
  await expect.poll(() => preview(page)).toBe(true);
  // An unqueued order replaces the queue and its preview.
  await page.mouse.click(replacement!.x, replacement!.y);
  await expect(status).toContainText("1 move order accepted");
  await expect.poll(() => preview(page)).toBe(false);
});

forEachProfile([PHONE_PROFILE], () => {
  test(
    "Queue Orders mode chains taps until Done",
    { tag: WEBKIT },
    async ({ page }) => {
      await opening(page, true);
      const queue = page.locator("#queue-orders");
      const status = page.locator("#movement-status");
      const [first, ...queued] = await routePoints(page, ROUTE);
      const [replacement] = await routePoints(page, [REPLACEMENT]);
      await page.touchscreen.tap(first!.x, first!.y);
      await expect(status).toContainText("1 move order accepted");
      await queue.tap();
      await expect(queue).toHaveAttribute("aria-pressed", "true");
      for (const point of queued) {
        await page.touchscreen.tap(point.x, point.y);
        await expect(status).toContainText("1 move order queued");
      }
      await expect.poll(() => preview(page)).toBe(true);
      await queue.tap();
      await expect(queue).toHaveAttribute("aria-pressed", "false");
      await page.touchscreen.tap(replacement!.x, replacement!.y);
      await expect(status).toContainText("1 move order accepted");
      await expect.poll(() => preview(page)).toBe(false);
    },
  );

  test("queued minimap Attack Move remains active until an unqueued target", async ({
    page,
  }) => {
    await opening(page, true);
    const target = await minimapTarget(page);
    await page.locator("#queue-orders").tap();
    await page.locator("#attack-move").tap();
    await page.touchscreen.tap(target.x, target.y);
    await expect(page.locator("#movement-status")).toContainText(
      /Attack Move order (accepted|queued)/,
    );
    await expect(page.locator("#cancel-attack-move")).toBeVisible();
    await page.locator("#queue-orders").tap();
    await page.touchscreen.tap(target.x, target.y);
    await expect(page.locator("#cancel-attack-move")).toBeHidden();
  });
});
