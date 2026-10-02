import { expect, test } from "@playwright/test";
import { terrainPoint, trainTestUnits } from "./prototype-helpers";
import type { Page } from "@playwright/test";

async function groupBounds(page: Page) {
  return page.evaluate(async () => {
    const path: string = "/e2e/harness.ts";
    const { EngineStore, Vector3, projectToCanvas } = (await import(
      path
    )) as typeof import("./harness");
    const scene = EngineStore.Instances[0].scenes[0];
    const canvas = document.querySelector<HTMLCanvasElement>("#game-canvas")!;
    const points = scene.transformNodes
      .filter((node) => /^actor-trained-unit-\d+-root$/.test(node.name))
      .map((node) =>
        projectToCanvas(
          scene,
          canvas,
          node.getAbsolutePosition().add(new Vector3(0, 0.85, 0)),
        ),
      );
    return {
      left: Math.min(...points.map(({ x }) => x)) - 20,
      right: Math.max(...points.map(({ x }) => x)) + 20,
      top: Math.min(...points.map(({ y }) => y)) - 20,
      bottom: Math.max(...points.map(({ y }) => y)) + 20,
      points,
    };
  });
}
const selected = (page: Page) =>
  page.evaluate(
    () =>
      JSON.parse(
        document.querySelector<HTMLCanvasElement>("#game-canvas")!.dataset
          .selectedActors ?? "[]",
      ) as string[],
  );
async function cameraPose(page: Page) {
  return page.evaluate(async () => {
    const path: string = "/e2e/harness.ts";
    const { EngineStore } = (await import(path)) as typeof import("./harness");
    const camera = EngineStore.Instances[0].scenes[0].activeCamera!;
    return {
      position: camera.position.asArray(),
      view: camera.getViewMatrix().asArray(),
      projection: camera.getProjectionMatrix().asArray(),
    };
  });
}

// Synthetic touch drags exercise the app's pointer contract on both webviews.
async function touchDrag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  await page.evaluate(
    ({ from, to }) => {
      const canvas = document.querySelector<HTMLCanvasElement>("#game-canvas")!;
      for (const [type, point] of [
        ["pointerdown", from],
        ["pointermove", to],
        ["pointerup", to],
      ] as const)
        canvas.dispatchEvent(
          new PointerEvent(type, {
            pointerId: 31,
            pointerType: "touch",
            button: 0,
            buttons: type === "pointerup" ? 0 : 1,
            clientX: point.x,
            clientY: point.y,
            bubbles: true,
          }),
        );
    },
    { from, to },
  );
}

/** Browser frames keep running while simulation time advances explicitly. */
async function advanceSimulationTime(page: Page, milliseconds: number) {
  await page.evaluate((step) => {
    const now = performance.now() + step;
    Object.defineProperty(performance, "now", {
      configurable: true,
      value: () => now,
    });
  }, milliseconds);
}

test.use({ deviceScaleFactor: 2 });

test("box and additive selection control a mixed group with routes, separate destinations, Stop, and Clear", async ({
  page,
}, testInfo) => {
  await page.goto("/?sandbox");
  await trainTestUnits(page, [
    "trooper",
    "scout",
    "trooper",
    "scout",
    "trooper",
    "scout",
    "trooper",
    "scout",
  ]);
  await page.locator("#unit-roster button").first().click();
  await page.locator("#tab-units").click();
  await page
    .locator("#unit-roster button")
    .nth(1)
    .click({ modifiers: ["Shift"] });
  await expect
    .poll(() => selected(page))
    .toEqual(["trained-unit-1", "trained-unit-2"]);
  await expect(page.locator("#selection-details")).toHaveText(
    "2 units selected",
  );
  await expect(page.locator("#selection-info")).toContainText(
    "Trooper × 1 · Scout × 1",
  );
  const bounds = await groupBounds(page);
  const cameraBefore = await cameraPose(page);
  await page.mouse.move(bounds.left, bounds.top);
  await page.mouse.down();
  await page.mouse.move(bounds.right, bounds.bottom, { steps: 8 });
  await expect(page.locator(".selection-box")).toBeVisible();
  await page.mouse.up();
  await expect.poll(async () => (await selected(page)).length).toBe(8);
  expect(await cameraPose(page)).toEqual(cameraBefore);
  await expect(page.locator("#selection-details")).toHaveText(
    "8 units selected",
  );
  // Routes must be inspected before the independently timed units arrive.
  await advanceSimulationTime(page, 0);
  const point = await terrainPoint(page, 54, 45);
  await page.mouse.click(point.x, point.y);
  await advanceSimulationTime(page, 34);
  await expect(page.locator("#movement-status")).toHaveText(
    "8 move orders accepted.",
  );
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const path: string = "/e2e/harness.ts";
        const { EngineStore } = (await import(
          path
        )) as typeof import("./harness");
        return EngineStore.Instances[0].scenes[0].meshes.filter(
          (mesh) => mesh.name === "movement-path-route",
        ).length;
      }),
    )
    .toBe(8);
  await testInfo.attach("selected-group-routes", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  await page.locator("#stop-units").click();
  await advanceSimulationTime(page, 34);
  await expect(page.locator("#movement-status")).toHaveText(
    "Selected units stopped.",
  );
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const path: string = "/e2e/harness.ts";
        const { EngineStore } = (await import(
          path
        )) as typeof import("./harness");
        return EngineStore.Instances[0].scenes[0].meshes.filter(
          (mesh) => mesh.name === "movement-path-route",
        ).length;
      }),
    )
    .toBe(0);
  await expect.poll(async () => (await selected(page)).length).toBe(8);
  await page.locator("#clear-selection").click();
  await advanceSimulationTime(page, 34);
  await expect.poll(() => selected(page)).toEqual([]);
  await expect(page.locator("#stop-units")).toBeDisabled();
});

test("cancelled drags never select or move units", async ({ page }) => {
  await page.goto("/?sandbox");
  await trainTestUnits(page);
  await page.locator("#unit-roster button").first().click();
  const bounds = await groupBounds(page);
  await page.mouse.move(bounds.left, bounds.top);
  await page.mouse.down();
  await page.mouse.move(bounds.right, bounds.bottom);
  await expect(page.locator(".selection-box")).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect(page.locator(".selection-box")).toBeHidden();
  await page.mouse.up();
  await expect.poll(() => selected(page)).toEqual(["trained-unit-1"]);
  await expect(page.locator("#game-canvas")).not.toHaveAttribute(
    "data-actor-target",
  );
});

test("compact touch controls support additive and box selection, movement, and camera actions", async ({
  browser,
}, testInfo) => {
  const context = await browser.newContext({
    viewport: { width: 844, height: 390 },
    hasTouch: true,
  });
  const page = await context.newPage();
  try {
    await page.goto("/?sandbox");
    // Use the same on-screen production controls without secondary clicks.
    await page.locator("#build-barracks").tap();
    const building = await terrainPoint(page, 49, 39);
    await page.touchscreen.tap(building.x, building.y);
    await page.locator("#confirm-building").tap();
    for (const unit of ["trooper", "scout", "trooper"])
      await page.locator(`#train-${unit}`).tap();
    await expect(page.locator("#unit-roster button")).toHaveCount(3);
    await page.locator("#unit-roster button").first().tap();
    await page.locator("#add-selection").tap();
    await page.locator("#tab-units").tap();
    await page.locator("#unit-roster button").nth(1).tap();
    await expect.poll(async () => (await selected(page)).length).toBe(2);
    await page.locator("#add-selection").tap();
    await page.locator("#box-select").tap();
    const bounds = await groupBounds(page);
    const before = await cameraPose(page);
    await touchDrag(
      page,
      { x: bounds.left, y: bounds.top },
      { x: bounds.right, y: bounds.bottom },
    );
    await expect.poll(async () => (await selected(page)).length).toBe(3);
    expect(await cameraPose(page)).toEqual(before);
    await page.locator("#box-select").tap();
    // Keep the destination clear of the units' projected silhouettes.
    const destination = await terrainPoint(page, 54, 49);
    await page.touchscreen.tap(destination.x, destination.y);
    await expect(page.locator("#movement-status")).toHaveText(
      "3 move orders accepted.",
    );
    await page.locator("#stop-units").tap();
    await expect(page.locator("#movement-status")).toHaveText(
      "Selected units stopped.",
    );
    for (const label of [
      "Pan camera left",
      "Rotate camera right",
      "Zoom camera in",
      "Tilt camera up",
    ]) {
      const pose = await cameraPose(page);
      await page.getByRole("button", { name: label, exact: true }).tap();
      await expect.poll(() => cameraPose(page)).not.toEqual(pose);
    }
    await page.getByRole("button", { name: "Reset camera view" }).tap();
    await expect.poll(() => cameraPose(page)).toEqual(before);
    const empty = await terrainPoint(page, 54, 45);
    await touchDrag(page, empty, { x: empty.x + 50, y: empty.y + 15 });
    await expect.poll(() => cameraPose(page)).not.toEqual(before);
    await expect.poll(async () => (await selected(page)).length).toBe(3);
    await testInfo.attach("group-touch", {
      body: await page.screenshot(),
      contentType: "image/png",
    });
  } finally {
    await context.close();
  }
});
