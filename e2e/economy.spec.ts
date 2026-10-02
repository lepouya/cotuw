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

test("recreating economy controls does not duplicate resource actions", async ({
  page,
}) => {
  await controlledOpening(page);
  await expect(page.locator("#resource-overview button")).toHaveCount(5);
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

test.describe("hovering salvage", () => {
  test.use({ hasTouch: true });
  for (const touch of [false, true]) {
    test(`${touch ? "tapping" : "clicking"} at an oblique angle collects the box's tile`, async ({
      page,
    }) => {
      await controlledOpening(page);
      await place(page, "#build-barracks", 16, 54);
      await page.locator("#train-trooper").click();
      await advance(page, 5);
      await page.locator("#unit-roster button").click();
      const point = await page.evaluate(async () => {
        const harnessPath: string = "/e2e/harness.ts";
        const terrainPath: string = "/src/render/terrain-mesh.ts";
        const prototypePath: string = "/src/prototype.ts";
        const { projectToCanvas } = await import(harnessPath);
        const { isTerrainPickMesh } = await import(terrainPath);
        const { createPrototypeMap } = await import(prototypePath);
        const map = createPrototypeMap();
        const view = window.economyHarness.view;
        view.engine.stopRenderLoop();
        view.camera.focusOnTile(25, 52);
        const camera = view.scene
          .activeCamera as import("@babylonjs/core").ArcRotateCamera;
        camera.beta = 1.2;
        camera.alpha = -Math.PI / 2;
        view.scene.render();
        const gift = view.scene.getTransformNodeByName(
          "materials-salvage-1-gift",
        )!;
        gift.computeWorldMatrix(true);
        const canvas =
          document.querySelector<HTMLCanvasElement>("#game-canvas")!;
        const point = projectToCanvas(
          view.scene,
          canvas,
          gift.getAbsolutePosition(),
        );
        const bounds = canvas.getBoundingClientRect();
        const ground = view.scene.pick(
          point.x - bounds.left,
          point.y - bounds.top,
          isTerrainPickMesh,
        )!.pickedPoint!;
        return {
          ...point,
          target: map.tileCenter(25, 52),
          terrainBehind: map.tileAtWorldPosition(ground.x, ground.z),
        };
      });
      expect(point.terrainBehind).not.toEqual({ x: 25, z: 52 });
      if (touch) await page.touchscreen.tap(point.x, point.y);
      else await page.mouse.click(point.x, point.y);
      await advance(page, 0.1);
      const target = await page.evaluate(() => {
        const simulation = window.economyHarness.view.simulation;
        return simulation.actors.find(
          (actor) => actor.definitionId === "arc-trooper",
        )!.movement!.target;
      });
      expect(target).toEqual(point.target);
      await advance(page, 15);
      await expect(page.locator("#materials-counter")).toHaveText("50");
      expect(
        await page.evaluate(
          () =>
            window.economyHarness.view.simulation.economy!.loot[0].collected,
        ),
      ).toBe(true);
    });
  }
});

test("Harvester controls use matching Refineries and type-specific load timing", async ({
  page,
}) => {
  await controlledOpening(page);
  await place(page, "#build-refinery", 12, 49);
  await page.locator("#train-harvester").click();
  await advance(page, 7);
  await page.evaluate(async () => {
    const controlsPath: string = "/src/ui/economy-controls.ts";
    const contentPath: string = "/src/content/arc.ts";
    const { createEconomyControls } = (await import(
      controlsPath
    )) as typeof import("../src/ui/economy-controls");
    const { ARC_ACTOR_DEFINITIONS } = (await import(
      contentPath
    )) as typeof import("../src/content/arc");
    const snapshot = window.economyHarness.view.simulation.snapshot();
    window.economyHarness.view.engine.stopRenderLoop();
    const refinery = snapshot.actors.find(
      (actor) => actor.definitionId === "arc-materials-refinery",
    )!;
    const worker = snapshot.economy!.harvesters[0];
    worker.phase = "gathering";
    worker.targetSiteId = worker.activeSiteId = snapshot.economy!.sites[0].id;
    const otherWorker = {
      ...ARC_ACTOR_DEFINITIONS.find((definition) => definition.harvesting)!,
      id: "other-worker",
      materialsCost: 10,
      harvesting: { capacity: 50, loadSeconds: 30, patchRadius: 2 },
    };
    const otherRefinery = {
      ...ARC_ACTOR_DEFINITIONS.find((definition) => definition.refinery)!,
      id: "other-refinery",
      materialsCost: 200,
      refinery: { harvesterDefinitionId: otherWorker.id },
      production: { unitDefinitionIds: [otherWorker.id] },
    };
    snapshot.actors.push({
      ...structuredClone(refinery),
      id: "other-refinery",
      definitionId: otherRefinery.id,
    });
    const root = document
      .querySelector<HTMLElement>("#game-sidebar")!
      .cloneNode(true) as HTMLElement;
    root.id = "review-economy-root";
    for (const button of root.querySelectorAll("[data-economy-action]"))
      button.remove();
    for (const panel of root.querySelectorAll<HTMLElement>("[role=tabpanel]"))
      panel.hidden = false;
    const controls = createEconomyControls(
      root,
      {
        actors: snapshot.actors,
        economy: snapshot.economy,
        tickSeconds: 1 / 60,
        submitCommand: () => 0,
      },
      {
        definitions: [otherWorker, otherRefinery, ...ARC_ACTOR_DEFINITIONS],
        names: new Map(),
        selectedActorId: () => worker.actorId,
        enabled: () => true,
        focus: () => {},
        positionForTile: () => ({ x: 0, z: 0 }),
      },
    );
    controls.refresh();
    document.body.append(root);
  });
  const root = page.locator("#review-economy-root");
  await expect(root.locator("#refinery-assignments button")).toHaveCount(1);
  await expect(root.locator("#refinery-assignments button")).toContainText(
    "Assigned to",
  );
  await expect(root.locator("#economy-alert")).toContainText("60 seconds");
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
