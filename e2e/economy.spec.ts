import { expect, test } from "@playwright/test";
import { terrainPoint } from "./prototype-helpers";
import type { Page } from "@playwright/test";
import type { TerrainPrototype } from "../src/prototype";

type EconomyHarness = { view: TerrainPrototype; now: number };
declare global {
  interface Window {
    economyHarness: EconomyHarness;
  }
}

/** Uses real tick callbacks with a controlled clock, so 60 seconds need no wall-time wait. */
async function controlledOpening(page: Page) {
  await page.goto("/");
  await expect(page.locator("#game-canvas")).toHaveAttribute(
    "data-terrain-ready",
    "true",
  );
  await page.evaluate(async () => {
    const harnessPath: string = "/e2e/harness.ts";
    const prototypePath: string = "/src/prototype.ts";
    const sidebarPath: string = "/src/ui/sidebar.ts";
    const contentPath: string = "/src/prototype-content.ts";
    const scenarioPath: string = "/src/content/economy-scenario.ts";
    const { EngineStore } = await import(harnessPath);
    const engines = [...EngineStore.Instances];
    for (const engine of engines) engine.dispose();
    const { createTerrainPrototype } = (await import(
      prototypePath
    )) as typeof import("../src/prototype");
    const { createSidebar } = (await import(
      sidebarPath
    )) as typeof import("../src/ui/sidebar");
    const { ARC_ACTOR_DEFINITIONS, PROTOTYPE_ACTOR_PRESENTATIONS } =
      (await import(contentPath)) as typeof import("../src/prototype-content");
    const { ECONOMY_SCENARIO } = (await import(
      scenarioPath
    )) as typeof import("../src/content/economy-scenario");
    let view: TerrainPrototype;
    const sidebar = createSidebar(
      document.querySelector<HTMLElement>("#game-sidebar")!,
      {
        definitions: ARC_ACTOR_DEFINITIONS,
        presentations: PROTOTYPE_ACTOR_PRESENTATIONS,
        economy: true,
        goals: [{ definitionId: "arc-trooper", label: "Train a Trooper" }],
        selectActor: (id, additive) => view.selectActor(id, additive),
      },
    );
    view = await createTerrainPrototype(
      document.querySelector<HTMLCanvasElement>("#game-canvas")!,
      document.querySelector<HTMLCanvasElement>("#minimap")!,
      {
        ...sidebar.controls,
        scenario: ECONOMY_SCENARIO,
        onStateChanged: sidebar.update,
        showActor: sidebar.showActor,
        onDispose: sidebar.dispose,
      },
    );
    window.economyHarness = { view, now: performance.now() };
    Object.defineProperty(performance, "now", {
      configurable: true,
      value: () => window.economyHarness.now,
    });
  });
}
async function advance(page: Page, seconds: number) {
  await page.evaluate((seconds) => {
    const harness = window.economyHarness;
    const steps = Math.ceil(seconds);
    for (let i = 0; i < steps; i++) {
      harness.now += 1000 * Math.min(1, seconds - i);
      harness.view.scene.onBeforeRenderObservable.notifyObservers(
        harness.view.scene,
      );
    }
    harness.view.scene.render();
  }, seconds);
}
async function action(page: Page, selector: string, touch = false) {
  const locator = page.locator(selector);
  if (touch) await locator.tap();
  else await locator.click();
}
async function place(
  page: Page,
  button: string,
  x: number,
  z: number,
  touch = false,
  complete = true,
) {
  await action(page, "#tab-buildings", touch);
  await action(page, button, touch);
  const point = await terrainPoint(page, x, z);
  if (touch) {
    await page.touchscreen.tap(point.x, point.y);
    await expect(page.locator("#confirm-building")).toBeEnabled();
    await page.locator("#confirm-building").tap();
  } else {
    await page.mouse.move(point.x, point.y);
    await expect(page.locator("#game-canvas")).toHaveAttribute(
      "data-placement-status",
      "valid",
    );
    await page.mouse.click(point.x, point.y);
  }
  await advance(page, 0.1);
  await expect(page.locator("#game-canvas")).toHaveAttribute(
    "data-placement-active",
    "false",
  );
  await expect(page.locator("#construction-queue button")).toContainText(
    "8s remaining",
  );
  if (complete) {
    await advance(page, 8);
    await expect(page.locator("#construction-queue button")).toHaveCount(0);
  }
}

test("default opening shows the Command Center, starting Materials, and paid content", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("#game-canvas")).toHaveAttribute(
    "data-tile-placed-actor-count",
    "1",
  );
  await expect(page.locator("#materials-counter")).toHaveText("150");
  await expect(page.locator("#build-command-center")).toBeDisabled();
  await expect(page.locator("#build-command-center")).toHaveAttribute(
    "title",
    "Need 300 Materials; available 150.",
  );
  await expect(page.locator("#build-refinery")).toContainText("100 Materials");
  await expect(page.locator("#train-harvester")).toContainText("50 Materials");
  await page.locator("#tab-units").click();
  await expect(page.locator("#economy-alert")).toContainText(
    "Build a Refinery",
  );
});

test("building timers disable production, and cancelling a blueprint fully refunds its cost", async ({
  page,
}) => {
  await controlledOpening(page);
  await place(page, "#build-refinery", 12, 49, false, false);
  await expect(page.locator("#train-harvester")).toBeDisabled();
  await expect(page.locator("#production-status")).toContainText(
    "finish construction",
  );
  await advance(page, 3);
  await expect(page.locator("#construction-queue button")).toContainText(
    "5s remaining",
  );
  await page.locator("#tab-selection").click();
  await expect(page.locator("#construction-details")).toContainText(
    "5s remaining",
  );
  await expect(page.locator("#remove-building")).toContainText(
    "Cancel construction (+100 Materials)",
  );
  await page.locator("#remove-building").click();
  await advance(page, 0.1);
  await expect(page.locator("#materials-counter")).toHaveText("150");
  await expect(page.locator("#construction-details")).toBeHidden();
  await expect(page.locator("#game-canvas")).toHaveAttribute(
    "data-tile-placed-actor-count",
    "1",
  );
});

test("spending the bootstrap funds shows a stalled-economy recovery hint", async ({
  page,
}) => {
  await controlledOpening(page);
  await place(page, "#build-barracks", 16, 54);
  await expect(page.locator("#materials-counter")).toHaveText("50");
  await expect(page.locator("#economy-alert")).toContainText("Economy stalled");
  await page.locator("#tab-selection").click();
  await page.locator("#remove-building").click();
  await advance(page, 0.1);
  await expect(page.locator("#materials-counter")).toHaveText("100");
  await page.locator("#tab-units").click();
  await expect(page.locator("#economy-alert")).toContainText("Economy stalled");
});

for (const touch of [false, true]) {
  test(`economy opening funds a Barracks and Trooper with ${touch ? "compact touch" : "mouse"} controls`, async ({
    browser,
  }, testInfo) => {
    const context = await browser.newContext({
      viewport: touch
        ? { width: 844, height: 390 }
        : { width: 1280, height: 720 },
      hasTouch: touch,
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await controlledOpening(page);
      await place(page, "#build-refinery", 12, 49, touch);
      await expect(page.locator("#materials-counter")).toHaveText("50");
      await expect(page.locator("#train-harvester")).toBeEnabled();
      await action(page, "#train-harvester", touch);
      await advance(page, 0.1);
      await expect(page.locator("#materials-counter")).toHaveText("0");
      await expect(page.locator("#production-queue button")).toHaveCount(1);
      await expect(page.locator("#train-harvester")).toBeDisabled();
      // Cancelling unfinished production refunds it, including its paid ID.
      await action(page, "#production-queue button", touch);
      await advance(page, 0.1);
      await expect(page.locator("#materials-counter")).toHaveText("50");
      await action(page, "#train-harvester", touch);
      await advance(page, 7);
      await expect(page.locator("#unit-roster button")).toHaveCount(1);
      await action(page, "#unit-roster button", touch);
      await expect(page.locator("#harvester-actions")).toBeVisible();
      await action(
        page,
        '[data-economy-action="gather:near-materials-1"]',
        touch,
      );
      await advance(page, 75);
      await expect(page.locator("#materials-counter")).toHaveText("100");
      await place(page, "#build-barracks", 16, 54, touch);
      await expect(page.locator("#materials-counter")).toHaveText("0");
      await advance(page, 75);
      await expect(page.locator("#materials-counter")).toHaveText("100");
      await action(page, "#train-trooper", touch);
      await advance(page, 5);
      await expect(page.locator("#unit-roster button")).toHaveCount(2);
      await expect(page.locator("#materials-counter")).toHaveText("75");
      await expect(page.locator("#game-canvas")).not.toHaveAttribute(
        "data-simulation-fault",
        "true",
      );
      expect(errors).toEqual([]);
      await testInfo.attach(touch ? "economy-touch" : "economy-desktop", {
        body: await page.screenshot(),
        contentType: "image/png",
      });
    } finally {
      await context.close();
    }
  });
}
