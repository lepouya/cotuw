import { expect, test } from "@playwright/test";
import { terrainPoint } from "./prototype-helpers";
import type { Page } from "@playwright/test";
import type { TerrainPrototype } from "../src/prototype";
import type { ActorPlacement } from "../src/simulation/placement";

type EconomyHarness = { view: TerrainPrototype; now: number };
declare global {
  interface Window {
    economyHarness: EconomyHarness;
  }
}

/** Uses real tick callbacks with a controlled clock, so 60 seconds need no wall-time wait. */
async function controlledOpening(
  page: Page,
  materials = 150,
  playerFaction = "arc",
  extraBuildings: ActorPlacement[] = [],
) {
  await page.goto("/");
  await expect(page.locator("#game-canvas")).toHaveAttribute(
    "data-terrain-ready",
    "true",
  );
  const hiddenUnitsAtLoad = await page.evaluate(
    async ({ materials, playerFaction, extraBuildings }) => {
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
      const { PROTOTYPE_ACTOR_PRESENTATIONS } = (await import(
        contentPath
      )) as typeof import("../src/prototype-content");
      const { ECONOMY_ACTOR_DEFINITIONS, ECONOMY_SCENARIO } = (await import(
        scenarioPath
      )) as typeof import("../src/content/economy-scenario");
      let view: TerrainPrototype;
      const sidebar = createSidebar(
        document.querySelector<HTMLElement>("#game-sidebar")!,
        {
          definitions: ECONOMY_ACTOR_DEFINITIONS,
          presentations: PROTOTYPE_ACTOR_PRESENTATIONS,
          economy: true,
          playerFaction,
          goals: [{ definitionId: "arc-trooper", label: "Train a Trooper" }],
          selectActor: (id, additive) => view.selectActor(id, additive),
        },
      );
      view = await createTerrainPrototype(
        document.querySelector<HTMLCanvasElement>("#game-canvas")!,
        document.querySelector<HTMLCanvasElement>("#minimap")!,
        {
          ...sidebar.controls,
          scenario: {
            ...ECONOMY_SCENARIO,
            materials,
            playerFaction,
            buildings: [...ECONOMY_SCENARIO.buildings, ...extraBuildings],
          },
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
      return view.simulation.actors
        .filter(
          (actor) =>
            !actor.tilePlacement &&
            !view.simulation.detects(playerFaction, actor) &&
            !!view.scene.getTransformNodeByName(`actor-${actor.id}-root`),
        )
        .map((actor) => actor.id);
    },
    { materials, playerFaction, extraBuildings },
  );
  expect(hiddenUnitsAtLoad).toEqual([]);
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

test("recreating economy controls lists only discovered resources once", async ({
  page,
}) => {
  await controlledOpening(page);
  await expect(page.locator("#resource-overview button")).toHaveCount(1);
  await expect(page.locator("#resource-overview button")).toContainText(
    "Near Materials",
  );
});

test("fog keeps the camera near explored terrain", async ({ page }) => {
  await controlledOpening(page);
  const target = await page.evaluate(() => {
    const view = window.economyHarness.view;
    view.camera.focusOnTile(90, 90);
    const camera = view.scene
      .activeCamera as import("@babylonjs/core").ArcRotateCamera;
    return { x: camera.target.x, z: camera.target.z };
  });
  // The Command Center sees about 14 tiles east of the west map edge.
  expect(target.x).toBeLessThan(-20);
  expect(target.z).toBeLessThan(25);
  await expect(page.locator("#game-canvas")).toHaveAttribute(
    "data-explored-tiles",
    /^[1-9]\d*$/,
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
      await expect(
        page.locator('[data-economy-action="loot:salvage-1"]'),
      ).toHaveCount(0);
      // The salvage starts in unexplored terrain, so scout it first.
      await page.evaluate(() => {
        const { simulation } = window.economyHarness.view;
        const trooper = simulation.actors.find(
          (actor) => actor.definitionId === "arc-trooper",
        )!;
        simulation.submitCommand({
          kind: "move",
          actorId: trooper.id,
          target: { x: -28.5, z: 2.5 },
        });
      });
      await advance(page, 4);
      await expect(
        page.locator('[data-economy-action="loot:salvage-1"]'),
      ).toContainText("Collect salvage");
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
        support: undefined,
        tickSeconds: 1 / 60,
        submitCommand: () => 0,
      },
      {
        definitions: [otherWorker, otherRefinery, ...ARC_ACTOR_DEFINITIONS],
        names: new Map(),
        selectedActorId: () => worker.actorId,
        enabled: () => true,
        focus: () => {},
        explored: () => true,
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

for (const touch of [false, true]) {
  test(`rally points support ${touch ? "compact touch" : "mouse"} placement, cancellation, and production`, async ({
    browser,
  }, testInfo) => {
    const context = await browser.newContext({
      viewport: touch
        ? { width: 844, height: 390 }
        : { width: 1280, height: 720 },
      hasTouch: touch,
    });
    const page = await context.newPage();
    try {
      await controlledOpening(page);
      await place(page, "#build-refinery", 12, 49, touch);
      const panel = page.locator("#panel-units");
      await action(page, '#panel-units [data-rally-action="set"]', touch);
      const occupied = await terrainPoint(page, 8, 50);
      if (touch) await page.touchscreen.tap(occupied.x, occupied.y);
      else await page.mouse.click(occupied.x, occupied.y);
      await expect(panel.locator("[data-rally-status]")).toContainText(
        "passable ground",
      );
      await action(page, '#panel-units [data-rally-action="cancel"]', touch);
      await expect(panel.locator('[data-rally-action="cancel"]')).toBeHidden();
      await action(page, '#panel-units [data-rally-action="set"]', touch);
      const destination = await terrainPoint(page, 17, 52);
      if (!touch) {
        const selected = await page
          .locator("#game-canvas")
          .getAttribute("data-selected-actor");
        await page.mouse.move(destination.x, destination.y);
        await page.mouse.down();
        await page.keyboard.press("Escape");
        await page.mouse.up();
        await advance(page, 0.1);
        await expect(page.locator("#game-canvas")).toHaveAttribute(
          "data-selected-actor",
          selected!,
        );
        expect(
          await page.evaluate(() =>
            window.economyHarness.view.simulation.actors.some(
              (actor) => actor.rallyPoint,
            ),
          ),
        ).toBe(false);
        await expect(
          panel.locator('[data-rally-action="cancel"]'),
        ).toBeHidden();
        await action(page, '#panel-units [data-rally-action="set"]');
      }

      if (touch) await page.touchscreen.tap(destination.x, destination.y);
      else await page.mouse.click(destination.x, destination.y);
      await advance(page, 0.1);
      await expect(panel.locator("[data-rally-status]")).toContainText(
        "marked rally point",
      );
      expect(
        await page.evaluate(
          () => !!window.economyHarness.view.scene.getMeshByName("rally-point"),
        ),
      ).toBe(true);
      await testInfo.attach("rally-point", {
        body: await page.screenshot(),
        contentType: "image/png",
      });
      await action(page, "#train-harvester", touch);
      await advance(page, 15);
      const result = await page.evaluate(() => {
        const simulation = window.economyHarness.view.simulation;
        return {
          position: simulation.actors.find(
            (actor) => actor.definitionId === "arc-harvester",
          )!.worldPosition,
          target: simulation.actors.find(
            (actor) => actor.definitionId === "arc-materials-refinery",
          )!.rallyPoint,
        };
      });
      expect(result.position).toEqual(result.target);
      await action(page, '#panel-units [data-rally-action="clear"]', touch);
      await advance(page, 0.1);
      expect(
        await page.evaluate(
          () => !!window.economyHarness.view.scene.getMeshByName("rally-point"),
        ),
      ).toBe(false);
    } finally {
      await context.close();
    }
  });
}

test("selling a support bridge pauses production and rebuilding restores it", async ({
  page,
}, testInfo) => {
  await controlledOpening(page, 500);
  await place(page, "#build-barracks", 16, 50);
  await place(page, "#build-barracks", 22, 50);
  const [bridgeId, remoteId] = await page.evaluate(() =>
    window.economyHarness.view.simulation.actors
      .filter((actor) => actor.definitionId === "arc-field-barracks")
      .map((actor) => actor.id),
  );
  await page.evaluate(
    (id) => window.economyHarness.view.selectActor(id),
    remoteId,
  );
  await advance(page, 0.1);
  await page.locator("#tab-units").click();
  await page.locator("#train-trooper").click();
  await advance(page, 1);
  await page.evaluate(
    (id) => window.economyHarness.view.selectActor(id),
    bridgeId,
  );
  await advance(page, 0.1);
  await page.locator("#tab-selection").click();
  await page.locator("#remove-building").click();
  await advance(page, 0.1);
  await expect(page.locator("#network-alerts button")).toContainText(
    "1 building disconnected",
  );
  await page.locator("#network-alerts button").click();
  await page.evaluate(
    (id) => window.economyHarness.view.selectActor(id),
    remoteId,
  );
  await advance(page, 0.1);
  await page.locator("#tab-units").click();
  await expect(page.locator("#train-trooper")).toBeDisabled();
  await expect(
    page.locator("#panel-units [data-network-status]"),
  ).toContainText("Disconnected");
  await expect(page.locator("#production-queue button")).toContainText(
    "Paused",
  );
  const progress = await page.evaluate(
    () =>
      window.economyHarness.view.simulation.economy!.production[0]
        .completedTicks,
  );
  await advance(page, 10);
  expect(
    await page.evaluate(
      () =>
        window.economyHarness.view.simulation.economy!.production[0]
          .completedTicks,
    ),
  ).toBe(progress);
  expect(
    await page.evaluate(() =>
      window.economyHarness.view.scene.meshes.some((mesh) =>
        mesh.name.endsWith("-offline"),
      ),
    ),
  ).toBe(true);
  await testInfo.attach("disconnected-network", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  await place(page, "#build-barracks", 16, 50);
  await advance(page, 5);
  await expect(page.locator("#unit-roster button")).toHaveCount(1);
  await expect(page.locator("#network-alerts button").first()).toContainText(
    "1 building reconnected",
  );
  await page.evaluate(async () => {
    const contentPath: string = "/src/content/arc.ts";
    const prototypePath: string = "/src/prototype.ts";
    const placementPath: string = "/src/simulation/placement.ts";
    const { ARC_ACTOR_DEFINITIONS } = await import(contentPath);
    const { createPrototypeMap } = await import(prototypePath);
    const { createTilePlacedActor } = await import(placementPath);
    const simulation = window.economyHarness.view.simulation;
    const replacement = simulation.actors.find(
      (actor) =>
        actor.tilePlacement?.origin.x === 16 &&
        actor.tilePlacement.origin.z === 50,
    )!;
    const backup = createTilePlacedActor(
      createPrototypeMap(),
      ARC_ACTOR_DEFINITIONS.find(
        (definition: { id: string }) => definition.id === "arc-field-barracks",
      ),
      { actorId: "test-backup", origin: { x: 17, z: 52 } },
    );
    const totalTicks = Math.round(8 / simulation.tickSeconds);
    backup.construction = {
      paidMaterials: 100,
      totalTicks,
      completedTicks: totalTicks - 2,
    };
    simulation.spawnActor(backup);
    document.querySelector("#network-alerts")!.replaceChildren();
    simulation.submitCommand({ kind: "sell-actor", actorId: replacement.id });
  });
  // One render frame commits both the outage and the backup's completion.
  await advance(page, 0.1);
  await expect(page.locator("#network-alerts button")).toHaveText([
    "1 building reconnected",
    "1 building disconnected",
  ]);
  await expect(page.locator("#game-canvas")).not.toHaveAttribute(
    "data-simulation-fault",
    "true",
  );
});

test("a Trooper defeats the lone wolf with health and combat feedback", async ({
  page,
}) => {
  await controlledOpening(page);
  const wolfHidden = await page.evaluate(() => {
    const { view } = window.economyHarness;
    const wolf = view.simulation.actorById("lone-wolf")!;
    const hidden = !view.simulation.detects("arc", wolf);
    view.simulation.spawnActor({
      id: "duelist",
      definitionId: "arc-trooper",
      worldPosition: { x: 40.5 - 50, z: 32.5 - 50 },
      facing: Math.PI / 2,
      occupancyLayer: "surface",
    });
    view.camera.focusOnTile(43, 32);
    return hidden;
  });
  expect(wolfHidden).toBe(true);
  await advance(page, 2);
  const engaged = await page.evaluate(() => {
    const { simulation } = window.economyHarness.view;
    return {
      trooper: simulation.actorById("duelist")!.combat?.attack?.targetId,
      wolf: simulation.actorById("lone-wolf")!.combat?.attack?.targetId,
    };
  });
  expect(engaged).toEqual({ trooper: "lone-wolf", wolf: "duelist" });
  await advance(page, 12);
  const result = await page.evaluate(() => {
    const { simulation } = window.economyHarness.view;
    return {
      wolf: simulation.actorById("lone-wolf"),
      health: simulation.actorById("duelist")!.health,
      wrecks: simulation.wrecks.map(({ actorId }) => actorId),
    };
  });
  expect(result.wolf).toBeUndefined();
  expect(result.wrecks).toEqual(["lone-wolf"]);
  expect(result.health).toBeGreaterThan(0);
  expect(result.health).toBeLessThan(100);
  await page.evaluate(() => window.economyHarness.view.selectActor("duelist"));
  await page.locator("#tab-selection").click();
  await expect(page.locator("#selection-health")).toHaveText(
    `Health ${result.health} / 100`,
  );
});

test("hostile buildings require detection and expose inspection without player controls", async ({
  page,
}) => {
  await controlledOpening(page, 150, "wildlife", [
    {
      actorId: "enemy-barracks",
      definitionId: "arc-field-barracks",
      origin: { x: 12, z: 49 },
    },
  ]);
  await advance(page, 0.1);
  const initiallyHidden = await page.evaluate(() => {
    const { view } = window.economyHarness;
    view.selectActor("starting-command-center");
    return {
      rendered: !!view.scene.getTransformNodeByName(
        "tile-placed-actor-starting-command-center-root",
      ),
      selected:
        document.querySelector<HTMLCanvasElement>("#game-canvas")!.dataset
          .selectedActors,
    };
  });
  expect(initiallyHidden).toEqual({ rendered: false, selected: "[]" });
  await advance(page, 0.1);
  await expect(page.locator("#producer-roster button")).toHaveCount(0);
  await expect(page.locator("#building-options button")).toHaveCount(0);
  await expect(page.locator("#training-options button")).toHaveCount(0);
  await page.evaluate(() => {
    const { view } = window.economyHarness;
    const position = { x: 10.5 - 50, z: 50.5 - 50 };
    view.simulation.spawnActor({
      id: "observer",
      definitionId: "wolf",
      worldPosition: position,
      facing: 0,
      occupancyLayer: "surface",
      territory: { home: position },
    });
    view.selectActor("enemy-barracks");
  });
  await advance(page, 0.1);
  await page.locator("#tab-selection").click();
  await expect(page.locator("#selection-details")).toContainText(
    "Field Barracks",
  );
  await expect(page.locator("#selection-health")).toBeVisible();
  await expect(page.locator("#remove-building")).toBeHidden();
  await expect(page.locator("#remove-building")).toBeDisabled();
  await expect(page.locator("#open-training")).toBeHidden();
  await expect(page.locator("[data-rally-controls]").first()).toBeHidden();
  await expect(page.locator("#producer-roster button")).toHaveCount(0);
  await expect(page.locator("#construction-queue button")).toHaveCount(0);
  await expect(page.locator("#production-queue button")).toHaveCount(0);
  const rendered = await page.evaluate(() => {
    const { view } = window.economyHarness;
    document
      .querySelector<HTMLButtonElement>("#remove-building")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    return !!view.scene.getTransformNodeByName(
      "tile-placed-actor-starting-command-center-root",
    );
  });
  expect(rendered).toBe(true);
  await advance(page, 0.1);
  expect(
    await page.evaluate(
      () => !!window.economyHarness.view.simulation.actorById("enemy-barracks"),
    ),
  ).toBe(true);
  await page.evaluate(() =>
    window.economyHarness.view.simulation.removeActor("observer"),
  );
  await advance(page, 0.1);
  await expect(page.locator("#game-canvas")).toHaveAttribute(
    "data-selected-actors",
    "[]",
  );
  expect(
    await page.evaluate(
      () =>
        !!window.economyHarness.view.scene.getTransformNodeByName(
          "tile-placed-actor-starting-command-center-root",
        ),
    ),
  ).toBe(false);
});

test("damaged building sale feedback matches the credited refund", async ({
  page,
}) => {
  await controlledOpening(page);
  await page.evaluate(() => {
    const { simulation } = window.economyHarness.view;
    const cc = simulation.actorById("starting-command-center")!;
    simulation.removeActor(cc.id);
    simulation.spawnActor({
      ...cc,
      id: "damaged-command-center",
      health: 1640,
    });
    window.economyHarness.view.selectActor("damaged-command-center");
  });
  await advance(page, 0.1);
  await page.locator("#tab-selection").click();
  await expect(page.locator("#remove-building")).toHaveText(
    "Sell building (+123 Materials)",
  );
  await page.locator("#remove-building").click();
  await advance(page, 0.1);
  await expect(page.locator("#materials-counter")).toHaveText("273");
});
