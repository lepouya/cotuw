import { expect, test } from "@playwright/test";
import { importMission, terrainPoint } from "./prototype-helpers";
import type { Page } from "@playwright/test";
import type { GameSession } from "../src/session";
import type { ActorPlacement } from "../src/simulation/placement";

type EconomyHarness = { view: GameSession; now: number };
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
  startPaused = false,
) {
  await page.addInitScript(() => {
    const errors: string[] = [];
    Reflect.set(window, "startupErrors", errors);
    window.addEventListener("unhandledrejection", (event) =>
      errors.push(String(event.reason)),
    );
  });
  // The harness owns one session and its controls on the production HTML.
  await page.route("**/src/main.ts", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: 'import "/src/styles.css";',
    }),
  );
  await page.goto("/");
  const hiddenUnitsAtLoad = await page.evaluate(
    async ({ materials, playerFaction, extraBuildings, startPaused }) => {
      const prototypePath: string = "/src/session.ts";
      const sidebarPath: string = "/src/ui/sidebar.ts";
      const missionsPath: string = "/e2e/missions.ts";
      const notificationsPath: string = "/src/ui/notifications.ts";
      const topBarPath: string = "/src/ui/top-bar.ts";
      const { createGameSession } = (await import(
        prototypePath
      )) as typeof import("../src/session");
      const { createSidebar } = (await import(
        sidebarPath
      )) as typeof import("../src/ui/sidebar");
      const { level, placeBuildings } = (await import(
        missionsPath
      )) as typeof import("./missions");
      const { createNotifications } = (await import(
        notificationsPath
      )) as typeof import("../src/ui/notifications");
      const notifications = createNotifications(document);
      const { createTopBar, topBarState } = (await import(
        topBarPath
      )) as typeof import("../src/ui/top-bar");
      const mission = level();
      for (const id of ["network-view-control", "economy-overview"])
        document.getElementById(id)!.hidden = false;
      mission.state.economy!.materials = materials;
      mission.state.playerFaction = playerFaction;
      placeBuildings(mission, extraBuildings);
      let view: GameSession;
      const sidebar = createSidebar(
        document.querySelector<HTMLElement>("#game-sidebar")!,
        {
          definitions: mission.definitions,
          presentations: new Map(Object.entries(mission.content.presentation)),
          economy: true,
          playerFaction,
          goals: [{ definitionId: "arc-trooper", label: "Train a Trooper" }],
          selectActor: (id, additive) => view.selectActor(id, additive),
        },
      );
      const topBar = createTopBar(
        document.querySelector<HTMLElement>("#top-bar")!,
        {
          togglePause: () => (view.playing() ? view.pause() : view.resume()),
          setSpeed: (speed) => view.setSpeed(speed),
          showObjectives: sidebar.showGoals,
        },
      );
      view = await createGameSession(
        document.querySelector<HTMLCanvasElement>("#game-canvas")!,
        document.querySelector<HTMLCanvasElement>("#minimap")!,
        {
          ...sidebar.controls,
          startPaused,
          mission,
          onStateChanged: (state) => {
            sidebar.update(state);
            topBar.update(topBarState(view, state));
          },
          showActor: sidebar.showActor,
          onDispose: sidebar.dispose,
          onAlerts: (alerts) => {
            for (const alert of alerts) notifications.alert(alert, "");
          },
        },
      );
      notifications.setFocus(view.focus);
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
    { materials, playerFaction, extraBuildings, startPaused },
  );
  await expect(page.locator("#game-canvas")).toHaveAttribute(
    "data-terrain-ready",
    "true",
  );
  expect(hiddenUnitsAtLoad).toEqual([]);
  expect(
    await page.evaluate(() => Reflect.get(window, "startupErrors")),
  ).toEqual([]);
}

test("paused inspection allows selection but blocks orders and placement", async ({
  page,
}) => {
  await controlledOpening(page, 150, "arc", [], true);
  const hiddenSelection = await page.evaluate(async () => {
    const path: string = "/src/simulation/actor.ts";
    const { createActor } = await import(path);
    const { view } = window.economyHarness;
    view.selectActors(["lone-wolf", "den-alpha-wolf"]);
    const hiddenSelection =
      document.querySelector<HTMLCanvasElement>("#game-canvas")!.dataset
        .selectedActors;
    view.simulation.spawnActor(
      createActor({
        id: "inspection-trooper",
        definitionId: "arc-trooper",
        worldPosition: { x: -36.5, z: 2.5 },
      }),
    );
    view.selectActors(["inspection-trooper"]);
    if (
      document.querySelector<HTMLCanvasElement>("#game-canvas")!.dataset
        .selectedActors !== '["inspection-trooper"]'
    )
      throw new Error("Paused inspection could not select mobile actors.");
    view.selectActor("inspection-trooper");
    return hiddenSelection;
  });
  expect(hiddenSelection).toBe("[]");
  await expect(page.locator("#selection-details")).toHaveText("Trooper");
  await expect(page.locator("#stop-units")).toBeDisabled();
  await page.keyboard.press("s");
  const point = await terrainPoint(page, 18, 52);
  await page.mouse.click(point.x, point.y);
  await page.locator("#build-barracks").dispatchEvent("click");
  expect(
    await page.evaluate(
      () => window.economyHarness.view.simulation.snapshot().commands,
    ),
  ).toEqual([]);
  await expect(page.locator("#game-canvas")).toHaveAttribute(
    "data-placement-active",
    "false",
  );
  await page.evaluate(() => window.economyHarness.view.resume());
  await page.locator("#tab-buildings").click();
  await expect(page.locator("#build-barracks")).toBeEnabled();
  await page.locator("#build-barracks").click();
  await expect(page.locator("#game-canvas")).toHaveAttribute(
    "data-placement-active",
    "true",
  );
});

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

test("scouting reveals the mountain den and its larger alpha", async ({
  page,
}, testInfo) => {
  await controlledOpening(page);
  await page.evaluate(() => {
    const { view } = window.economyHarness;
    view.simulation.spawnActor({
      id: "den-scout",
      definitionId: "arc-scout",
      worldPosition: { x: 28.5, z: -27.5 },
      facing: 0,
      occupancyLayer: "surface",
    });
  });
  await advance(page, 0.1);
  const revealed = await page.evaluate(() => {
    const { view } = window.economyHarness;
    view.camera.focusOnTile(78, 23);
    view.selectActor("den-alpha-wolf");
    view.scene.render();
    return view.simulation
      .snapshot()
      .actors.filter((actor) => actor.territory?.encounterId === "wolf-den")
      .map((actor) => {
        const root = view.scene.getTransformNodeByName(
          `actor-${actor.id}-root`,
        );
        const pick = view.scene.getMeshByName(`actor-${actor.id}-pick`)!;
        return {
          id: actor.id,
          shown: !!root?.isEnabled(),
          height: pick.getBoundingInfo().boundingBox.extendSizeWorld.y * 2,
        };
      });
  });
  expect(revealed).toHaveLength(5);
  expect(revealed.every((actor) => actor.shown)).toBe(true);
  const alpha = revealed.find((actor) => actor.id === "den-alpha-wolf")!;
  const normal = revealed.find((actor) => actor.id === "den-wolf-1")!;
  expect(alpha.height / normal.height).toBeCloseTo(1.25);
  await page.locator("#tab-selection").click();
  await expect(page.locator("#selection-details")).toContainText("Alpha wolf");
  await testInfo.attach("wolf-den", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
});

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
        const { projectToCanvas, prototypeTerrainMap } = await import(
          harnessPath
        );
        const { isTerrainPickMesh } = await import(terrainPath);
        const map = prototypeTerrainMap();
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
    const contentPath: string = "/src/content/packs.ts";
    const { createEconomyControls } = (await import(
      controlsPath
    )) as typeof import("../src/ui/economy-controls");
    const { currentContentPack } = (await import(
      contentPath
    )) as typeof import("../src/content/packs");
    const ARC_ACTOR_DEFINITIONS = currentContentPack("base").actors;
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
  const networkAlerts = page
    .locator("#alert-history li")
    .filter({ hasText: /building (dis|re)connected/ });
  await expect(networkAlerts).toHaveText(["⚠ 1 building disconnected"]);
  await page.locator("#alert-toggle").click();
  await page
    .locator("#alert-history button")
    .filter({ hasText: "1 building disconnected" })
    .click();
  await page.locator("#alert-toggle").click();
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
  await expect(networkAlerts.first()).toHaveText("• 1 building reconnected");
  await page.evaluate(async () => {
    const contentPath: string = "/src/content/packs.ts";
    const harnessPath: string = "/e2e/harness.ts";
    const placementPath: string = "/src/simulation/placement.ts";
    const { currentContentPack } = (await import(
      contentPath
    )) as typeof import("../src/content/packs");
    const { prototypeTerrainMap } = (await import(
      harnessPath
    )) as typeof import("./harness");
    const { createTilePlacedActor } = (await import(
      placementPath
    )) as typeof import("../src/simulation/placement");
    const simulation = window.economyHarness.view.simulation;
    const replacement = simulation.actors.find(
      (actor) =>
        actor.tilePlacement?.origin.x === 16 &&
        actor.tilePlacement.origin.z === 50,
    )!;
    const backup = createTilePlacedActor(
      prototypeTerrainMap(),
      currentContentPack("base").actors.find(
        (definition) => definition.id === "arc-field-barracks",
      )!,
      { actorId: "test-backup", origin: { x: 17, z: 52 } },
    );
    const totalTicks = Math.round(8 / simulation.tickSeconds);
    backup.construction = {
      paidMaterials: 100,
      totalTicks,
      completedTicks: totalTicks - 2,
    };
    simulation.spawnActor(backup);
    document.querySelector("#alert-history")!.replaceChildren();
    simulation.submitCommand({ kind: "sell-actor", actorId: replacement.id });
  });
  // One render frame commits both the outage and the backup's completion.
  await advance(page, 0.1);
  await expect(networkAlerts).toHaveText([
    "• 1 building reconnected",
    "⚠ 1 building disconnected",
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
  await page.evaluate(() =>
    window.economyHarness.view.simulation.removeActor("duelist"),
  );
  await advance(page, 0.1);
  expect(
    await page.evaluate(() => {
      const { view } = window.economyHarness;
      return view.scene.getTransformNodeByName("wreck-lone-wolf")!.isEnabled();
    }),
  ).toBe(false);
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

for (const profile of [
  { name: "mouse", viewport: { width: 1280, height: 720 }, touch: false },
  { name: "phone touch", viewport: { width: 844, height: 390 }, touch: true },
  { name: "tablet touch", viewport: { width: 1024, height: 768 }, touch: true },
]) {
  test(`Attack Move supports ${profile.name} cancellation, combat, and resumption`, async ({
    browser,
  }, testInfo) => {
    const context = await browser.newContext({
      viewport: profile.viewport,
      hasTouch: profile.touch,
    });
    const page = await context.newPage();
    try {
      await controlledOpening(page);
      await page.evaluate(() => {
        const { view } = window.economyHarness;
        view.simulation.spawnActor({
          id: "advance-trooper",
          definitionId: "arc-trooper",
          worldPosition: { x: -11.5, z: -17.5 },
          facing: 0,
          occupancyLayer: "surface",
        });
        view.camera.focusOnTile(43, 32);
        view.selectActor("advance-trooper");
      });
      await advance(page, 0.1);
      await action(page, "#attack-move", profile.touch);
      await expect(page.locator("#cancel-attack-move")).toBeVisible();
      await action(page, "#cancel-attack-move", profile.touch);
      expect(
        await page.evaluate(
          () =>
            window.economyHarness.view.simulation.actorById("advance-trooper")!
              .attackMove,
        ),
      ).toBeUndefined();
      await action(page, "#attack-move", profile.touch);
      if (!profile.touch) {
        await page.keyboard.press("Escape");
        await expect(page.locator("#cancel-attack-move")).toBeHidden();
        await action(page, "#attack-move");
      }
      const point = await terrainPoint(page, 52, 32);
      if (profile.touch) await page.touchscreen.tap(point.x, point.y);
      else await page.mouse.click(point.x, point.y);
      const destination = await page.evaluate(async () => {
        const path: string = "/e2e/harness.ts";
        const { prototypeTerrainMap } = await import(path);
        const order = window.economyHarness.view.simulation
          .snapshot()
          .commands.find(({ command }) => command.kind === "attack-move");
        if (order?.command.kind !== "attack-move")
          throw new Error("The terrain press issued no Attack Move order.");
        const { target } = order.command;
        return {
          target,
          tile: prototypeTerrainMap().tileAtWorldPosition(target.x, target.z),
        };
      });
      expect(destination.tile).toEqual({ x: 52, z: 32 });
      await advance(page, 1);
      await expect(page.locator("#movement-status")).toContainText(
        "Attack Move order",
      );
      await expect(page.locator("#cancel-attack-move")).toBeHidden();
      expect(
        await page.evaluate(
          () =>
            window.economyHarness.view.scene.getMeshByName(
              "attack-move-destination",
            ) !== null,
        ),
      ).toBe(true);
      await advance(page, 20);
      const result = await page.evaluate(() => {
        const { simulation } = window.economyHarness.view;
        const trooper = simulation.actorById("advance-trooper")!;
        return {
          wolf: simulation.actorById("lone-wolf"),
          point: trooper.worldPosition,
          aggressive: trooper.attackMove,
          health: trooper.health,
        };
      });
      expect(result.wolf).toBeUndefined();
      expect(result.aggressive).toBeUndefined();
      // Pointer coordinates round to pixels; arrival matches the issued order.
      expect(result.point.x).toBeCloseTo(destination.target.x, 6);
      expect(result.point.z).toBeCloseTo(destination.target.z, 6);
      expect(result.health).toBeGreaterThan(0);
      await testInfo.attach(`attack-move-${profile.name}`, {
        body: await page.screenshot(),
        contentType: "image/png",
      });
    } finally {
      await context.close();
    }
  });
}

for (const profile of [
  { name: "mouse", viewport: { width: 1280, height: 720 }, touch: false },
  { name: "phone touch", viewport: { width: 844, height: 390 }, touch: true },
]) {
  test(`Goals tracks victory and restores free play with ${profile.name}`, async ({
    browser,
  }, testInfo) => {
    const context = await browser.newContext({
      viewport: profile.viewport,
      hasTouch: profile.touch,
    });
    const page = await context.newPage();
    try {
      await page.goto("/");
      await expect(page.locator("#game-canvas")).toHaveAttribute(
        "data-terrain-ready",
        "true",
      );
      await action(page, "#tab-goals", profile.touch);
      await expect(page.locator("#mission-objectives")).toContainText(
        "Defeat the lone wolf (0/1)",
      );
      await expect(page.locator("#mission-objectives")).toContainText(
        "Clear the mountain den (0/5)",
      );
      await expect(
        page.locator('[data-goal-id="protect-command-center"]'),
      ).toContainText("Protect the Command Center");
      await expect(page.locator("#mission-directive")).toBeHidden();
      await expect(page.locator("#preparation-heading")).toHaveText(
        "Recommended preparation",
      );
      await expect(page.locator("#scenario-description")).toContainText(
        "Defeat all six wolves",
      );
      await testInfo.attach(`goals-${profile.name}`, {
        body: await page.screenshot(),
        contentType: "image/png",
      });
      const saves = await page.evaluate(async () => {
        const missionsPath: string = "/e2e/missions.ts";
        const actorPath: string = "/src/simulation/actor.ts";
        const { level, missionSource, simulateMission } = (await import(
          missionsPath
        )) as typeof import("./missions");
        const { createActor } = (await import(
          actorPath
        )) as typeof import("../src/simulation/actor");
        const mission = level();
        const { state } = mission;
        for (const wolf of state.actors.filter((actor) => actor.territory)) {
          if (wolf.id === "den-alpha-wolf") continue;
          wolf.health = 1;
          state.actors.push(
            createActor({
              id: `trooper-${wolf.id}`,
              definitionId: "arc-trooper",
              worldPosition: {
                x: wolf.worldPosition.x - 1.5,
                z: wolf.worldPosition.z,
              },
            }),
          );
        }
        const simulation = simulateMission(mission);
        simulation.tick();
        const partial = simulation.snapshot();
        simulation.dispose();
        const beforeLast = structuredClone(partial);
        beforeLast.actors.find(({ id }) => id === "den-alpha-wolf")!.health = 1;
        const pending = missionSource(mission, beforeLast);
        const final = simulateMission(mission, beforeLast);
        for (let tick = 0; tick < 600 && !final.result; tick++) final.tick();
        const victory = missionSource(mission, final.snapshot());
        const result = final.result?.kind;
        final.dispose();
        return {
          partial: missionSource(mission, partial),
          pending,
          victory,
          result,
        };
      });
      expect(saves.result).toBe("victory");
      const upload = async (source: string) => {
        await importMission(page, source);
        await expect(page.locator("#game-menu")).toBeVisible();
      };
      await upload(saves.partial);
      await action(page, "#inspect-loaded-mission", profile.touch);
      await action(page, "#tab-buildings", profile.touch);
      await expect(page.locator("#build-barracks")).toBeDisabled();
      await action(page, "#tab-units", profile.touch);
      await action(page, "#unit-roster button:nth-of-type(1)", profile.touch);
      await expect(page.locator("#stop-units")).toBeDisabled();
      await action(page, "#tab-goals", profile.touch);
      await expect(page.locator('[data-goal-id="lone-wolf"]')).toHaveClass(
        "goal-complete",
      );
      await expect(page.locator('[data-goal-id="wolf-den"]')).toContainText(
        "(4/5)",
      );
      await expect(page.locator('[data-goal-id="wolf-den"]')).not.toHaveClass(
        "goal-complete",
      );
      await upload(saves.pending);
      await action(page, "#resume-mission", profile.touch);
      await expect(page.locator("#game-menu-title")).toHaveText("Victory", {
        timeout: 15_000,
      });
      await expect(page.locator("#game-canvas")).toHaveAttribute(
        "data-mission-result",
        "victory",
      );
      await expect(page.locator("#resume-mission")).toHaveText(
        "Continue free play",
      );
      await testInfo.attach(`victory-${profile.name}`, {
        body: await page.screenshot(),
        contentType: "image/png",
      });
      await action(page, "#resume-mission", profile.touch);
      await action(page, "#tab-goals", profile.touch);
      await expect(
        page.locator("#mission-objectives .goal-complete"),
      ).toHaveCount(2);
      await expect(page.locator("#mission-directive")).toContainText(
        "Victory secured",
      );
      await action(page, "#tab-buildings", profile.touch);
      await action(page, "#build-barracks", profile.touch);
      const point = await terrainPoint(page, 15, 48);
      if (profile.touch) {
        await page.touchscreen.tap(point.x, point.y);
        await action(page, "#confirm-building", true);
      } else await page.mouse.click(point.x, point.y);
      await expect(page.locator("#game-canvas")).toHaveAttribute(
        "data-tile-placed-actor-count",
        "2",
      );
      await action(page, "#tab-units", profile.touch);
      await expect(page.locator("#train-trooper")).toBeEnabled({
        timeout: 15_000,
      });
      await action(page, "#train-trooper", profile.touch);
      await expect(page.locator("#unit-roster button")).toHaveCount(6, {
        timeout: 10_000,
      });
      await expect(page.locator("#game-menu")).not.toBeVisible();
      await upload(saves.victory);
      await expect(page.locator("#game-menu-title")).toHaveText("Victory");
      await action(page, "#restart-mission", profile.touch);
      await action(page, "#tab-goals", profile.touch);
      await expect(
        page.locator("#mission-objectives .goal-complete"),
      ).toHaveCount(0);
      await expect(page.locator('[data-goal-id="wolf-den"]')).toContainText(
        "(0/5)",
      );
    } finally {
      await context.close();
    }
  });
}

test("Command Center defeat pauses, rejects bad loads, restores, restarts, and exits", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.locator("#game-canvas")).toHaveAttribute(
    "data-terrain-ready",
    "true",
  );
  const saves = await page.evaluate(async () => {
    const missionsPath: string = "/e2e/missions.ts";
    const { level, missionSource, simulateMission } = (await import(
      missionsPath
    )) as typeof import("./missions");
    const mission = level();
    const { state } = mission;
    state.actors.find(
      (actor: { id: string }) => actor.id === "starting-command-center",
    )!.health = 1;
    const wolf = state.actors.find(
      (actor: { id: string }) => actor.id === "lone-wolf",
    )!;
    wolf.worldPosition = { x: -39.5, z: 0.5 };
    wolf.territory = { home: { ...wolf.worldPosition } };
    const info = { name: "Before defeat", savedAt: new Date().toISOString() };
    const pending = missionSource(mission, state, info);
    const simulation = simulateMission(mission);
    simulation.tick();
    const defeated = missionSource(mission, simulation.snapshot(), info);
    simulation.dispose();
    return { pending, defeated };
  });
  const upload = async (source: string) => {
    await importMission(page, source);
    await expect(page.locator("#game-menu")).toBeVisible();
  };
  await upload(saves.pending);
  await expect(page.locator("#game-menu-title")).toHaveText("Mission loaded");
  await page.locator("#inspect-loaded-mission").click();
  await expect(page.locator("#pause-mission")).toHaveText("▶ Paused");
  await expect(page.locator("#game-canvas")).not.toHaveAttribute(
    "data-mission-result",
    "defeat",
  );
  await page.locator("#pause-mission").click();
  await expect(page.locator("#game-menu-title")).toHaveText("Defeat");
  await expect(page.locator("#game-canvas")).toHaveAttribute(
    "data-mission-result",
    "defeat",
  );
  await expect(page.locator("#placement-status")).toContainText(
    "Mission ended in defeat",
  );
  await expect(page.locator("#production-status")).toContainText(
    "Mission ended in defeat",
  );
  await expect(page.locator("#restart-mission")).toBeVisible();
  await expect(page.locator("#load-mission")).toBeVisible();
  await testInfo.attach("defeat", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  await upload('{"version":0}');
  await expect(page.locator("#game-menu-status")).toContainText(
    "not a mission file",
  );
  await expect(page.locator("#game-menu-title")).toHaveText("Defeat");
  await upload(saves.defeated);
  await expect(page.locator("#game-menu-status")).toHaveText("");
  await expect(page.locator("#game-menu-title")).toHaveText("Defeat");
  await expect(page.locator("#resume-mission")).toBeHidden();
  await page.locator("#restart-mission").click();
  await expect(page.locator("#game-menu")).not.toBeVisible();
  await expect(page.locator("#materials-counter")).toHaveText("150");
  await expect(page.locator("#game-canvas")).not.toHaveAttribute(
    "data-mission-result",
    "defeat",
  );
  await upload(saves.defeated);
  await expect(page.locator("#game-menu-title")).toHaveText("Defeat");
  await page.locator("#exit-mission").click();
  await expect(page.locator("#game-menu-title")).toHaveText("Mission ended");
  await page.locator("#restart-mission").click();
  await expect(page.locator("#materials-counter")).toHaveText("150");
  expect(errors).toEqual([]);
});
