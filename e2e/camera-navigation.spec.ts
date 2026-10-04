import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { terrainPoint, trainTestUnits } from "./prototype-helpers";

async function opening(page: Page) {
  await page.goto("/?level=sandbox");
  await trainTestUnits(page, ["trooper"]);
  await page.locator("#unit-roster button").first().click();
  await expect(page.locator("#game-canvas")).toHaveAttribute(
    "data-selected-actors",
    '["trained-unit-1"]',
  );
}

async function pose(page: Page) {
  return page.evaluate(async () => {
    const path: string = "/e2e/harness.ts";
    const { EngineStore, Vector3, projectToCanvas, viewHeight } = (await import(
      path
    )) as typeof import("./harness");
    const scene = EngineStore.Instances[0].scenes[0];
    const camera =
      scene.activeCamera as import("@babylonjs/core").ArcRotateCamera;
    const canvas = document.querySelector<HTMLCanvasElement>("#game-canvas")!;
    const unit = scene.getTransformNodeByName("actor-trained-unit-1-root")!;
    return {
      target: camera.target.asArray(),
      alpha: camera.alpha,
      beta: camera.beta,
      zoom: viewHeight(camera),
      selected: canvas.dataset.selectedActors,
      move: canvas.dataset.moveStatus,
      unit: unit.getAbsolutePosition().asArray(),
      point: projectToCanvas(
        scene,
        canvas,
        unit.getAbsolutePosition().add(new Vector3(0, 0.85, 0)),
      ),
    };
  });
}

async function mouseDrag(page: Page, point: { x: number; y: number }) {
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 90, point.y - 60, { steps: 8 });
  await page.mouse.up();
}

function preserved(
  before: Awaited<ReturnType<typeof pose>>,
  after: Awaited<ReturnType<typeof pose>>,
) {
  expect(after.target).not.toEqual(before.target);
  expect(after.alpha).toBe(before.alpha);
  expect(after.beta).toBe(before.beta);
  expect(after.zoom).toBe(before.zoom);
  expect(after.selected).toBe(before.selected);
  expect(after.move).toBe(before.move);
  expect(after.unit).toEqual(before.unit);
}

test("Pan mode reserves clicks, drags, and trackpad scrolling without losing troops", async ({
  page,
}) => {
  await opening(page);
  const pan = page.getByRole("button", { name: "Pan mode", exact: true });
  await pan.click();
  await expect(pan).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(pan).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#game-canvas")).toHaveAttribute(
    "data-selected-actors",
    '["trained-unit-1"]',
  );
  await pan.click();
  await expect(page.locator("#game-canvas")).toHaveCSS("cursor", "grab");
  const before = await pose(page);
  await mouseDrag(page, before.point);
  const dragged = await pose(page);
  preserved(before, dragged);
  await page.mouse.click(before.point.x, before.point.y);
  expect((await pose(page)).selected).toBe(before.selected);
  await page.mouse.wheel(140, 80);
  await expect
    .poll(async () => (await pose(page)).target)
    .not.toEqual(dragged.target);
  const scrolled = await pose(page);
  preserved(dragged, scrolled);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -100);
  await page.keyboard.up("Control");
  await expect
    .poll(async () => (await pose(page)).zoom)
    .toBeLessThan(before.zoom);
  await page.keyboard.press("Escape");
  await expect(pan).toHaveAttribute("aria-pressed", "false");
  expect((await pose(page)).selected).toBe(before.selected);
  await page.locator('[data-camera-action="reset"]').click();
  const target = await terrainPoint(page, 54, 49);
  await page.mouse.click(target.x, target.y);
  await expect(page.locator("#game-canvas")).toHaveAttribute(
    "data-move-status",
    "accepted",
  );
});

test("Space-drag and arrow keys preserve Box selection and stop on release or blur", async ({
  page,
}) => {
  await opening(page);
  await page.locator("#box-select").click();
  const canvas = page.locator("#game-canvas");
  await canvas.focus();
  const before = await pose(page);
  await page.keyboard.down("Space");
  await mouseDrag(page, before.point);
  await page.keyboard.up("Space");
  preserved(before, await pose(page));
  await expect(page.locator("#box-select")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const from = await pose(page);
  await page.keyboard.down("ArrowRight");
  await expect
    .poll(async () => (await pose(page)).target)
    .not.toEqual(from.target);
  await page.keyboard.up("ArrowRight");
  const stopped = await pose(page);
  await page.waitForTimeout(150);
  expect((await pose(page)).target).toEqual(stopped.target);
  expect(stopped.selected).toBe(before.selected);
  await page.keyboard.down("Space");
  await page.keyboard.down("ArrowDown");
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await page.keyboard.up("Space");
  await page.keyboard.up("ArrowDown");
  const blurred = await pose(page);
  await page.waitForTimeout(150);
  expect((await pose(page)).target).toEqual(blurred.target);
  await expect(canvas).not.toHaveAttribute("data-camera-pan-active", "true");
  await page.locator('[data-camera-action="reset"]').focus();
  const unfocused = await pose(page);
  await page.keyboard.down("ArrowRight");
  await page.waitForTimeout(150);
  await page.keyboard.up("ArrowRight");
  expect((await pose(page)).target).toEqual(unfocused.target);
});

test("Pan mode preserves an active building preview without placing from world taps", async ({
  page,
}) => {
  await opening(page);
  const canvas = page.locator("#game-canvas");
  const count = await canvas.getAttribute("data-tile-placed-actor-count");
  await page.locator("#tab-buildings").click();
  await page.locator("#build-command-center").click();
  const target = await terrainPoint(page, 48, 47);
  await page.mouse.move(target.x, target.y);
  await expect(canvas).toHaveAttribute("data-placement-origin", "48,47");
  await page.getByRole("button", { name: "Pan mode", exact: true }).click();
  await page.mouse.click(target.x, target.y);
  await mouseDrag(page, target);
  await expect(canvas).toHaveAttribute("data-placement-active", "true");
  await expect(canvas).toHaveAttribute("data-tile-placed-actor-count", count!);
  await expect(canvas).toHaveAttribute("data-placement-origin", "48,47");
  await page.keyboard.press("Escape");
  await expect(canvas).toHaveAttribute("data-placement-active", "true");
  await expect(canvas).toHaveAttribute("data-placement-origin", "48,47");
  await page.locator("#cancel-building").click();
  await expect(canvas).toHaveAttribute("data-placement-active", "false");
});

test("Space navigation cancels an in-progress selection gesture without issuing an order", async ({
  page,
}) => {
  await opening(page);
  const before = await pose(page);
  await page.mouse.move(before.point.x, before.point.y);
  await page.mouse.down();
  await page.mouse.move(before.point.x + 35, before.point.y - 30);
  await expect(page.locator(".selection-box")).toBeVisible();
  await page.keyboard.down("Space");
  await expect(page.locator(".selection-box")).not.toBeVisible();
  await page.mouse.move(before.point.x + 90, before.point.y - 60);
  await page.keyboard.up("Space");
  await page.mouse.up();
  const after = await pose(page);
  expect(after.selected).toBe(before.selected);
  expect(after.move).toBe(before.move);
  expect(after.unit).toEqual(before.unit);
  await page.locator("#game-canvas").focus();
  await page.keyboard.down("Space");
  await mouseDrag(page, after.point);
  await page.keyboard.up("Space");
  preserved(after, await pose(page));
});

for (const mode of ["selection", "placement"] as const) {
  test(`${mode} shortcuts respect text entry and dialogs`, async ({ page }) => {
    await opening(page);
    const canvas = page.locator("#game-canvas");
    const selected = await canvas.getAttribute("data-selected-actors");
    if (mode === "placement") {
      await page.locator("#tab-buildings").click();
      await page.locator("#build-command-center").click();
    }
    const assertUnchanged = async () => {
      if (mode === "placement") {
        await expect(canvas).toHaveAttribute("data-placement-active", "true");
        await expect(canvas).toHaveAttribute("data-placement-rotation", "0");
      } else
        await expect(canvas).toHaveAttribute("data-selected-actors", selected!);
    };
    await page.evaluate(() => {
      const input = document.createElement("input");
      input.id = "navigation-text-entry";
      Object.assign(input.style, {
        position: "fixed",
        top: "0",
        left: "0",
        zIndex: "100",
      });
      document.body.append(input);
      input.focus();
    });
    await page.keyboard.type("r");
    await page.keyboard.press("Escape");
    await expect(page.locator("#navigation-text-entry")).toHaveValue("r");
    await assertUnchanged();
    await page.evaluate(() => {
      document.querySelector("#navigation-text-entry")!.remove();
      document.querySelector<HTMLDialogElement>("#game-menu")!.showModal();
    });
    await page.keyboard.press("r");
    await page.keyboard.press("Escape");
    await assertUnchanged();
    await page.evaluate(() =>
      document.querySelector<HTMLDialogElement>("#game-menu")!.close(),
    );
    await canvas.focus();
    if (mode === "placement") {
      await page.keyboard.press("r");
      await expect(canvas).toHaveAttribute("data-placement-rotation", "1");
    }
    await page.keyboard.press("Escape");
    if (mode === "placement")
      await expect(canvas).toHaveAttribute("data-placement-active", "false");
    else await expect(canvas).toHaveAttribute("data-selected-actors", "[]");
  });
}

test("mouse hover pans all world edges and corners while keeping troops selected", async ({
  page,
}) => {
  await opening(page);
  const canvas = page.locator("#game-canvas");
  const bounds = (await canvas.boundingBox())!;
  for (const [horizontal, vertical] of [
    [1, 0],
    [-1, 0],
    [0, -1],
    [0, 1],
    [1, 1],
  ]) {
    await page.locator('[data-camera-action="reset"]').click();
    const before = await pose(page);
    await page.mouse.move(
      bounds.x + bounds.width / 2 + horizontal * (bounds.width / 2 - 2),
      bounds.y + bounds.height / 2 + vertical * (bounds.height / 2 - 2),
    );
    await expect
      .poll(async () => (await pose(page)).target)
      .not.toEqual(before.target);
    await page.mouse.move(
      bounds.x + bounds.width / 2,
      bounds.y + bounds.height / 2,
    );
    const after = await pose(page);
    preserved(before, after);
    await page.waitForTimeout(250);
    expect((await pose(page)).target).toEqual(after.target);
  }
  await page.getByLabel("Edge panning", { exact: true }).uncheck();
  const disabled = await pose(page);
  await page.mouse.move(
    bounds.x + bounds.width - 2,
    bounds.y + bounds.height / 2,
  );
  await page.waitForTimeout(350);
  expect((await pose(page)).target).toEqual(disabled.target);
});

test("edge panning stops over UI, during box drags, on blur, and in dialogs", async ({
  page,
}) => {
  await opening(page);
  const canvas = page.locator("#game-canvas");
  const bounds = (await canvas.boundingBox())!;
  const edge = {
    x: bounds.x + bounds.width - 2,
    y: bounds.y + bounds.height / 2,
  };
  await page.mouse.move(edge.x, edge.y);
  const before = await pose(page);
  await expect
    .poll(async () => (await pose(page)).target)
    .not.toEqual(before.target);
  await page.locator("#tab-selection").hover();
  const sidebar = await pose(page);
  await page.waitForTimeout(300);
  expect((await pose(page)).target).toEqual(sidebar.target);
  await page.locator('[data-camera-action="left"]').hover();
  const controls = await pose(page);
  await page.waitForTimeout(300);
  expect((await pose(page)).target).toEqual(controls.target);
  await page.mouse.move(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(edge.x, edge.y, { steps: 8 });
  const drag = await pose(page);
  await page.waitForTimeout(350);
  expect((await pose(page)).target).toEqual(drag.target);
  await page.mouse.up();
  await page.mouse.move(edge.x - 1, edge.y);
  await expect
    .poll(async () => (await pose(page)).target)
    .not.toEqual(drag.target);
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  const blurred = await pose(page);
  await page.waitForTimeout(300);
  expect((await pose(page)).target).toEqual(blurred.target);
  await page.mouse.move(edge.x, edge.y);
  await page.evaluate(() =>
    document.querySelector<HTMLDialogElement>("#game-menu")!.showModal(),
  );
  const modal = await pose(page);
  await page.waitForTimeout(300);
  expect((await pose(page)).target).toEqual(modal.target);
});

for (const profile of [
  { name: "phone", viewport: { width: 844, height: 390 } },
  { name: "tablet", viewport: { width: 1024, height: 768 } },
]) {
  test.describe(profile.name, () => {
    test.use({ viewport: profile.viewport, hasTouch: true });
    test("one-finger Pan drags over troops preserve selection and work without keyboard", async ({
      page,
    }) => {
      await opening(page);
      const pan = page.getByRole("button", { name: "Pan mode", exact: true });
      await pan.tap();
      const before = await pose(page);
      // Touchscreen drag events exercise the same contract in both webviews.
      await page.evaluate((point) => {
        const canvas =
          document.querySelector<HTMLCanvasElement>("#game-canvas")!;
        for (const [type, x, y] of [
          ["pointerdown", point.x, point.y],
          ["pointermove", point.x + 70, point.y - 50],
          ["pointerup", point.x + 70, point.y - 50],
        ] as const)
          canvas.dispatchEvent(
            new PointerEvent(type, {
              pointerId: 41,
              pointerType: "touch",
              button: 0,
              buttons: type === "pointerup" ? 0 : 1,
              clientX: x,
              clientY: y,
              bubbles: true,
            }),
          );
      }, before.point);
      preserved(before, await pose(page));
      await pan.tap();
      await expect(pan).toHaveAttribute("aria-pressed", "false");
      expect((await pose(page)).selected).toBe(before.selected);
      const stopped = await pose(page);
      const bounds = (await page.locator("#game-canvas").boundingBox())!;
      await page.dispatchEvent("#game-canvas", "pointermove", {
        pointerId: 41,
        pointerType: "touch",
        buttons: 0,
        clientX: bounds.x + bounds.width - 2,
        clientY: bounds.y + bounds.height / 2,
      });
      await page.waitForTimeout(350);
      expect((await pose(page)).target).toEqual(stopped.target);
    });
  });
}
