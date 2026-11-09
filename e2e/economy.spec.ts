import { expect, test } from "./fixtures";
import { forEachProfile, MOUSE_AND_PHONE_PROFILES } from "./profiles";
import {
  activate,
  advance,
  attachScreenshot,
  collectPageErrors,
  dismissExplanation,
  expectTerrainReady,
  importMission,
  openOpening,
  pressPoint,
  selectInSession,
  startOpening,
  terrainPoint,
  withoutApp,
} from "./page-helpers";

import type { ArcRotateCamera } from "@babylonjs/core";
import type { Page } from "@playwright/test";
import type { Actor } from "../src/simulation/actor";
import type { MissionCommand } from "../src/simulation/command";
import type { EconomyState } from "../src/simulation/economy";
import type { ActorPlacement } from "../src/simulation/placement";

declare global {
  interface Window {
    startupErrors: string[];
  }
}

/** Runs real tick callbacks on a controlled clock, so waits take no wall time. */
async function controlledOpening(
  page: Page,
  {
    materials = 150,
    playerOwner = "player",
    extraBuildings = [],
    startPaused = false,
  }: {
    materials?: number;
    playerOwner?: string;
    extraBuildings?: ActorPlacement[];
    startPaused?: boolean;
  } = {},
) {
  await page.addInitScript(() => {
    window.startupErrors = [];
    window.addEventListener("unhandledrejection", (event) =>
      window.startupErrors.push(String(event.reason)),
    );
  });
  // The harness owns one session and its mounted sidebar.
  await withoutApp(page);
  await page.goto("/");
  const hiddenUnitsAtLoad = await page.evaluate(
    async ({ materials, playerOwner, extraBuildings, startPaused }) => {
      const { startSidebarSession } = await import("/e2e/sidebar-session.ts");
      const { level, placeBuildings } = await import("/e2e/missions.ts");
      const { createNotifications } = await import("/src/ui/notifications.ts");
      const { createTopBar } = await import("/src/ui/top-bar.ts");
      const { controlSessionClock } = await import("/e2e/harness.ts");
      const notifications = createNotifications(
        document.querySelector<HTMLElement>("#mission-alerts")!,
      );
      const mission = level();
      mission.state.playerOwner = playerOwner;
      mission.state.economy!.stockpiles = [
        { resource: "materials", owners: [playerOwner], amount: materials },
      ];
      placeBuildings(mission, extraBuildings);
      const topBar = createTopBar(
        document.querySelector<HTMLElement>("#top-bar")!,
        {
          alertToggle: notifications.toggle,
          openMenu: () => undefined,
          togglePause: () => (view.playing() ? view.pause() : view.resume()),
          setSpeed: (speed) => view.setSpeed(speed),
          showObjectives: () => sidebar.showGoals(),
        },
      );
      const { view, sidebar } = await startSidebarSession(mission, {
        goals: [{ definitionId: "arc-trooper", label: "Train a Trooper" }],
        startPaused,
        onStateChanged: (state) => topBar.update(state),
        onAlerts: (alerts) => {
          for (const alert of alerts) notifications.alert(alert, "");
        },
      });
      notifications.setFocus(view.focus);
      controlSessionClock(view);
      return view.simulation.actors
        .filter(
          (actor) =>
            !actor.tilePlacement &&
            !view.simulation.detects(playerOwner, actor) &&
            !!view.scene.getTransformNodeByName(`actor-${actor.id}-root`),
        )
        .map((actor) => actor.id);
    },
    { materials, playerOwner, extraBuildings, startPaused },
  );
  await expectTerrainReady(page);
  expect(hiddenUnitsAtLoad).toEqual([]);
  expect(await page.evaluate(() => window.startupErrors)).toEqual([]);
}

async function action(page: Page, selector: string, touch = false) {
  await activate(page.locator(selector), touch);
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

/** Imports a save through the menu, which stays open for the next step. */
async function upload(page: Page, source: string) {
  await importMission(page, source);
  await expect(page.locator("#game-menu")).toBeVisible();
}

test("saved missions keep dismissed tutorials", async ({ page }) => {
  await controlledOpening(page);
  const dismissed = await page.evaluate(async () => {
    const { loadMission } = await import("/src/mission-loading.ts");
    const { view } = window.sessionHarness;
    view.dismissPopup("support-network");
    const restored = loadMission(
      view.save({ name: "Tutorial review", savedAt: "2026-10-15T12:00:00Z" }),
    );
    return restored.uiState?.dismissedPopups;
  });
  expect(dismissed).toEqual(["support-network"]);
});

test("paused inspection allows selection but blocks orders and placement", async ({
  page,
}) => {
  await controlledOpening(page, { startPaused: true });
  const hiddenSelection = await page.evaluate(async () => {
    const { createActor } = await import("/src/simulation/actor.ts");
    const { view } = window.sessionHarness;
    view.selectActors(["lone-wolf", "den-alpha-wolf"]);
    const hiddenSelection =
      document.querySelector<HTMLCanvasElement>("#game-canvas")!.dataset
        .selectedActors;
    view.simulation.spawnActor(
      createActor({
        id: "inspection-trooper",
        definitionId: "arc-trooper",
        owner: "player",
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
  await expect(page.locator("#build-barracks")).toBeDisabled();
  await expect(page.locator("#build-barracks")).toHaveAccessibleDescription(
    /Resume the mission to build\./,
  );
  await expect(page.locator("#production-status")).toHaveText(
    "Resume the mission to train units.",
  );
  await expect(page.locator("#selection-details")).toHaveText("Trooper");
  await expect(page.locator("#stop-units")).toBeDisabled();
  await page.keyboard.press("s");
  const point = await terrainPoint(page, 18, 52);
  await page.mouse.click(point.x, point.y);
  await page.locator("#build-barracks").dispatchEvent("click");
  expect(
    await page.evaluate(
      () => window.sessionHarness.view.simulation.snapshot().commands,
    ),
  ).toEqual([]);
  await expect(page.locator("#game-canvas")).toHaveAttribute(
    "data-placement-active",
    "false",
  );
  await page.evaluate(() => window.sessionHarness.view.resume());
  await page.locator("#tab-buildings").click();
  await expect(page.locator("#build-barracks")).toBeEnabled();
  await page.locator("#build-barracks").click();
  await expect(page.locator("#game-canvas")).toHaveAttribute(
    "data-placement-active",
    "true",
  );
  await expect(page.locator("#build-refinery")).toHaveAccessibleDescription(
    /Finish or cancel the current building placement\./,
  );
  await expect(page.locator("#production-status")).toHaveText(
    "Finish or cancel the current building placement.",
  );
});

test("command feedback follows the player issuer and ignores AI and scripts", async ({
  page,
}) => {
  await controlledOpening(page);
  await page.evaluate(() => {
    const { simulation } = window.sessionHarness.view;
    simulation.spawnActor({
      id: "receipt-scout",
      definitionId: "arc-scout",
      owner: "player",
      worldPosition: { x: -36.5, z: 2.5 },
      facing: 0,
      occupancyLayer: "surface",
    });
    simulation.submitCommand(
      {
        kind: "move",
        actorId: "receipt-scout",
        target: { x: -30.5, z: 2.5 },
      },
      { owner: "player", script: undefined },
    );
  });
  await advance(page, 0.1);
  const canvas = page.locator("#game-canvas");
  await expect(canvas).toHaveAttribute("data-move-status", "accepted");
  await expect(canvas).toHaveAttribute("data-actor-target", "-30.5,2.5");
  const status = await page.locator("#movement-status").textContent();
  await page.evaluate(() => {
    const { simulation } = window.sessionHarness.view;
    simulation.submitCommand(
      {
        kind: "move",
        actorId: "lone-wolf",
        target: { x: -20.5, z: 2.5 },
      },
      { owner: "wildlife" },
    );
    simulation.submitCommand(
      {
        kind: "move",
        actorId: "receipt-scout",
        target: { x: -28.5, z: 2.5 },
      },
      { script: true, owner: "player" },
    );
  });
  await advance(page, 0.1);
  await expect(canvas).toHaveAttribute("data-move-status", "accepted");
  await expect(canvas).toHaveAttribute("data-actor-target", "-30.5,2.5");
  await expect(page.locator("#movement-status")).toHaveText(status!);
});

test("scouting reveals the mountain den and its larger alpha", async ({
  page,
}, testInfo) => {
  await controlledOpening(page);
  await page.evaluate(() => {
    const { view } = window.sessionHarness;
    view.simulation.spawnActor({
      id: "den-scout",
      definitionId: "arc-scout",
      owner: "player",
      worldPosition: { x: 28.5, z: -27.5 },
      facing: 0,
      occupancyLayer: "surface",
    });
  });
  await advance(page, 0.1);
  const revealed = await page.evaluate(() => {
    const { view } = window.sessionHarness;
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
  await expect(page.locator("#selection-details")).toContainText("Alpha wolf");
  await attachScreenshot(page, testInfo, "wolf-den");
});

test("default opening shows the Command Center, starting Materials, and paid content", async ({
  page,
}) => {
  await openOpening(page);
  await expect(page.locator("#game-canvas")).toHaveAttribute(
    "data-tile-placed-actor-count",
    "1",
  );
  await expect(page.locator("#materials-counter")).toHaveText("150");
  await expect(page.locator("#build-command-center")).toBeDisabled();
  await expect(
    page.locator("#build-command-center"),
  ).toHaveAccessibleDescription(/Need 300 Materials; available 150\.$/);
  await expect(page.locator("#build-refinery")).toContainText("100 Materials");
  await expect(page.locator("#train-harvester")).toContainText("50 Materials");
  await page.locator("#tab-units").click();
  await expect(page.locator("#economy-alert")).toContainText(
    "Build a Materials Refinery",
  );
});

test("construction order and training cards follow the selected building", async ({
  page,
}) => {
  await controlledOpening(page, {
    materials: 500,
    extraBuildings: [
      {
        actorId: "test-refinery",
        definitionId: "arc-materials-refinery",
        origin: { x: 12, z: 49 },
      },
      {
        actorId: "test-barracks",
        definitionId: "arc-field-barracks",
        origin: { x: 16, z: 54 },
      },
    ],
  });
  expect(
    await page
      .locator("#building-options button")
      .evaluateAll((buttons) => buttons.map(({ id }) => id)),
  ).toEqual(["build-command-center", "build-refinery", "build-barracks"]);
  await page.locator("#tab-units").click();
  const cards = page.locator("#training-options button:visible");
  await expect(cards).toHaveCount(0);
  await expect(page.locator("#production-status")).toContainText("on the map");
  await selectInSession(page, "test-refinery");
  await expect(cards).toHaveAttribute("id", "train-harvester");
  await expect(cards).toBeInViewport({ ratio: 1 });
  await page.locator("#train-harvester").click();
  await advance(page, 0.1);
  await expect(cards).toHaveCount(1);
  await expect(cards).toBeDisabled();
  await selectInSession(page, "test-barracks");
  await expect(cards).toHaveCount(2);
  expect(
    await cards.evaluateAll((buttons) => buttons.map(({ id }) => id)),
  ).toEqual(["train-trooper", "train-scout"]);
  await selectInSession(page, "starting-command-center");
  await expect(cards).toHaveCount(0);
  await expect(page.locator("#production-status")).toContainText("on the map");
  await selectInSession(page, "test-refinery");
  await expect(cards).toHaveAttribute("id", "train-harvester");
  await page.locator("#clear-selection").click();
  await advance(page, 0.1);
  await expect(cards).toHaveCount(0);
});

test("economy controls list only discovered resources once", async ({
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
    const view = window.sessionHarness.view;
    view.camera.focusOnTile(90, 90);
    const camera = view.scene.activeCamera as ArcRotateCamera;
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
        const { simulation } = window.sessionHarness.view;
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
        const { projectToCanvas, prototypeTerrainMap } =
          await import("/e2e/harness.ts");
        const { isTerrainPickMesh } =
          await import("/src/render/terrain-mesh.ts");
        const map = prototypeTerrainMap();
        const view = window.sessionHarness.view;
        view.engine.stopRenderLoop();
        view.camera.focusOnTile(25, 52);
        const camera = view.scene.activeCamera as ArcRotateCamera;
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
      await pressPoint(page, point, touch);
      await advance(page, 0.1);
      const target = await page.evaluate(() => {
        const simulation = window.sessionHarness.view.simulation;
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
            window.sessionHarness.view.simulation.economy!.loot[0].collected,
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
    const { createSidebar } = await import("/src/ui/sidebar.ts");
    const { createEconomyControls } =
      await import("/src/ui/economy-controls.ts");
    const { currentContentPack } = await import("/src/content/packs.ts");
    const actors = currentContentPack("base").actors;
    const snapshot = window.sessionHarness.view.simulation.snapshot();
    window.sessionHarness.view.engine.stopRenderLoop();
    const refinery = snapshot.actors.find(
      (actor) => actor.definitionId === "arc-materials-refinery",
    )!;
    const worker = snapshot.economy!.harvesters[0];
    worker.phase = "gathering";
    worker.targetSiteId = worker.activeSiteId = snapshot.economy!.sites[0].id;
    const otherWorker = {
      ...actors.find((definition) => definition.harvesting)!,
      id: "other-worker",
      materialsCost: 10,
      harvesting: { capacity: 50, loadSeconds: 30, patchRadius: 2 },
    };
    const otherRefinery = {
      ...actors.find((definition) => definition.refinery)!,
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
    const definitions = [otherWorker, otherRefinery, ...actors];
    const root = document.createElement("aside");
    root.className = "game-sidebar";
    root.id = "review-economy-root";
    const sidebar = createSidebar(root, {
      definitions,
      presentations: new Map(),
      playerOwner: "player",
      playerFaction: "arc",
      economy: true,
      goals: [],
      selectActor: () => {},
    });
    for (const panel of root.querySelectorAll<HTMLElement>("[role=tabpanel]"))
      panel.hidden = false;
    const submitted: MissionCommand[] = [];
    const controls = createEconomyControls(
      sidebar.controls.economy!,
      {
        tickSeconds: 1 / 60,
        submitCommand: (command) => {
          submitted.push(command);
          return 0;
        },
      },
      {
        definitions,
        names: new Map(),
        owner: "player",
        faction: "arc",
        ownActors: () =>
          snapshot.actors.filter((actor) => actor.owner === "player"),
        selectedActorId: () => worker.actorId,
        enabled: () => true,
        focus: () => {},
        economy: () => snapshot.economy,
        offlineIds: () => new Set(),
        positionForTile: () => ({ x: 0, z: 0 }),
        queueMode: () => true,
      },
    );
    controls.refresh();
    document.body.append(root);
    root.querySelector<HTMLButtonElement>("#gather-sites button")!.click();
    root
      .querySelector<HTMLButtonElement>("[data-economy-action^=loot]")!
      .click();
    if (
      submitted.length !== 2 ||
      submitted.some((command) => !("queued" in command) || !command.queued)
    )
      throw new Error(
        "On-screen Gather and Collect must respect Queue Orders.",
      );
    controls.onOutcome({
      tick: 0,
      issuer: { owner: "player" },
      command: {
        kind: "gather",
        actorId: worker.actorId,
        siteId: worker.targetSiteId!,
      },
      accepted: true,
      queued: true,
    });
    controls.refresh();
  });
  const root = page.locator("#review-economy-root");
  await expect(root.locator("#refinery-assignments button")).toHaveCount(1);
  await expect(root.locator("#refinery-assignments button")).toHaveText(
    "Assigned to Refinery 1",
  );
  await expect(root.locator("#economy-alert")).toContainText("60 seconds");
  await expect(root.locator("#harvester-status")).toHaveText("Order queued.");
});

test("worker controls share delivery actions and tolerate missions without cultivation roles", async ({
  page,
}) => {
  await withoutApp(page);
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { createSidebar } = await import("/src/ui/sidebar.ts");
    const { createEconomyControls } =
      await import("/src/ui/economy-controls.ts");
    const { currentContentPack } = await import("/src/content/packs.ts");
    const { createHarvesterState, economyForOwner } =
      await import("/src/simulation/economy.ts");
    const { createCultivatorState } =
      await import("/src/simulation/cultivation.ts");
    const { createActor } = await import("/src/simulation/actor.ts");
    const content = currentContentPack("base");
    const root = document.querySelector<HTMLElement>("#game-sidebar")!;
    const sidebar = createSidebar(root, {
      definitions: content.actors,
      presentations: new Map(Object.entries(content.presentation)),
      playerOwner: "player",
      economy: true,
      goals: [],
      selectActor: () => {},
    });
    const names = new Map<string, string>(
      Object.entries(content.presentation).map(([id, presentation]) => [
        id,
        presentation.name ?? id,
      ]),
    );
    const submitted: MissionCommand[] = [];
    let selection: string | undefined;
    const setup = (
      economy: EconomyState,
      actors: Actor[],
      definitions = content.actors,
      playerFaction = "arc",
    ) =>
      createEconomyControls(
        sidebar.controls.economy!,
        {
          tickSeconds: 1 / 60,
          submitCommand: (command) => {
            submitted.push(command);
            return 0;
          },
        },
        {
          definitions,
          names,
          owner: "player",
          faction: playerFaction,
          ownActors: () => actors.filter((actor) => actor.owner === "player"),
          selectedActorId: () => selection,
          enabled: () => true,
          focus: () => {},
          economy: () =>
            economyForOwner(economy, "player", (id) =>
              actors.some(
                (actor) => actor.id === id && actor.owner === "player",
              ),
            ),
          offlineIds: () => new Set(),
          positionForTile: () => ({ x: 0, z: 0 }),
        },
      );
    const empty = (): EconomyState => ({
      stockpiles: [],
      deposited: [],
      sites: [],
      loot: [],
      harvesters: [],
      production: [],
      cultivation: {
        sites: [],
        workers: [],
      },
    });
    const cleared: number[] = [];
    for (const definitionId of ["arc-harvester", "circle-cultivator"]) {
      selection = definitionId;
      const economy = empty();
      if (definitionId === "arc-harvester")
        economy.harvesters.push({
          ...createHarvesterState(definitionId, "refinery"),
          cargo: 5,
        });
      else
        economy.cultivation!.workers.push({
          ...createCultivatorState(definitionId),
          cargo: 5,
        });
      const controls = setup(economy, [
        createActor({
          id: definitionId,
          owner: "player",
          definitionId,
          worldPosition: { x: 0, z: 0 },
        }),
      ]);
      controls.refresh();
      const returnCargo = root.querySelector<HTMLButtonElement>(
        "#return-cargo-actions button",
      )!;
      returnCargo.click();
      selection = undefined;
      controls.refresh();
      returnCargo.click();
      cleared.push(
        root.querySelectorAll("#return-cargo-actions button").length,
      );
      controls.dispose();
    }
    const ownerHints: string[] = [];
    for (const faction of ["arc", "circle"]) {
      const economy = empty();
      economy.stockpiles.push({
        resource: "materials",
        owners: ["player"],
        amount: 150,
      });
      economy.cultivation!.workers.push({
        ...createCultivatorState("rival-cultivator"),
        phase: "no-dropoff",
      });
      economy.harvesters.push(createHarvesterState("rival-harvester"));
      const rivalActors = ["circle-cultivator", "arc-harvester"].map(
        (definitionId) =>
          createActor({
            id:
              definitionId === "circle-cultivator"
                ? "rival-cultivator"
                : "rival-harvester",
            owner: "rival",
            definitionId,
            worldPosition: { x: 0, z: 0 },
          }),
      );
      const controls = setup(economy, rivalActors, content.actors, faction);
      controls.refresh();
      ownerHints.push(root.querySelector("#economy-alert")!.textContent!);
      controls.dispose();
    }
    const controls = setup(
      empty(),
      [],
      content.actors.filter(({ faction }) => faction !== "circle"),
    );
    controls.refresh();
    const hint = root.querySelector("#economy-alert")!.textContent;
    controls.dispose();
    sidebar.dispose();
    return { submitted, cleared, hint, ownerHints };
  });
  expect(result).toEqual({
    submitted: [
      { kind: "return-cargo", actorId: "arc-harvester" },
      { kind: "return-cargo", actorId: "circle-cultivator" },
    ],
    cleared: [0, 0],
    hint: "Economy stalled: find Materials salvage or sell a building to recover.",
    ownerHints: [
      "Build a Materials Refinery, then produce its Harvester.",
      "Select the Heartgrove and train a Cultivator for 50 Lifebloom.",
    ],
  });
});

test("Harvester training cancellation refunds and frees its slot", async ({
  page,
}, testInfo) => {
  const errors = collectPageErrors(page);
  await controlledOpening(page);
  await place(page, "#build-refinery", 12, 49);
  await expect(page.locator("#materials-counter")).toHaveText("50");
  await expect(page.locator("#train-harvester")).toBeEnabled();
  await action(page, "#train-harvester");
  await advance(page, 0.1);
  await expect(page.locator("#materials-counter")).toHaveText("0");
  await expect(page.locator("#production-queue button")).toHaveCount(1);
  await expect(page.locator("#train-harvester")).toBeDisabled();
  // Cancelling unfinished production refunds it, including its paid ID.
  await action(page, "#production-queue button");
  await advance(page, 0.1);
  await expect(page.locator("#materials-counter")).toHaveText("50");
  await action(page, "#train-harvester");
  await advance(page, 7);
  await expect(page.locator("#unit-roster button")).toHaveCount(1);
  await action(page, "#unit-roster button");
  await expect(page.locator("#harvester-actions")).toBeVisible();
  await expect(page.locator("#game-canvas")).not.toHaveAttribute(
    "data-simulation-fault",
    "true",
  );
  expect(errors).toEqual([]);
  await attachScreenshot(page, testInfo, `training-cancellation`);
});

forEachProfile(MOUSE_AND_PHONE_PROFILES, ({ name, touch }) => {
  test("rally points support placement, cancellation, and production", async ({
    page,
  }, testInfo) => {
    await controlledOpening(page);
    await place(page, "#build-refinery", 12, 49, touch);
    const panel = page.locator("#panel-selection");
    await action(page, '#panel-selection [data-rally-action="set"]', touch);
    const occupied = await terrainPoint(page, 8, 50);
    await pressPoint(page, occupied, touch);
    await expect(panel.locator("[data-rally-status]")).toContainText(
      "passable ground",
    );
    await action(page, '#panel-selection [data-rally-action="cancel"]', touch);
    await expect(panel.locator('[data-rally-action="cancel"]')).toBeHidden();
    await action(page, '#panel-selection [data-rally-action="set"]', touch);
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
          window.sessionHarness.view.simulation.actors.some(
            (actor) => actor.rallyPoint,
          ),
        ),
      ).toBe(false);
      await expect(panel.locator('[data-rally-action="cancel"]')).toBeHidden();
      await action(page, '#panel-selection [data-rally-action="set"]');
    }

    await pressPoint(page, destination, touch);
    await advance(page, 0.1);
    await expect(panel.locator("[data-rally-status]")).toContainText(
      "marked rally point",
    );
    expect(
      await page.evaluate(
        () => !!window.sessionHarness.view.scene.getMeshByName("rally-point"),
      ),
    ).toBe(true);
    await attachScreenshot(page, testInfo, `rally-${name}`);
    await action(page, "#train-harvester", touch);
    await advance(page, 15);
    const result = await page.evaluate(() => {
      const simulation = window.sessionHarness.view.simulation;
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
    await action(page, '#panel-selection [data-rally-action="clear"]', touch);
    await advance(page, 0.1);
    expect(
      await page.evaluate(
        () => !!window.sessionHarness.view.scene.getMeshByName("rally-point"),
      ),
    ).toBe(false);
  });
});

test("selling a support bridge pauses production and rebuilding restores it", async ({
  page,
}, testInfo) => {
  await controlledOpening(page, { materials: 500 });
  await place(page, "#build-barracks", 16, 50);
  await place(page, "#build-barracks", 22, 50);
  const [bridgeId, remoteId] = await page.evaluate(() =>
    window.sessionHarness.view.simulation.actors
      .filter((actor) => actor.definitionId === "arc-field-barracks")
      .map((actor) => actor.id),
  );
  await selectInSession(page, remoteId);
  await page.locator("#tab-units").click();
  await page.locator("#train-trooper").click();
  await advance(page, 1);
  await selectInSession(page, bridgeId);
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
  await selectInSession(page, remoteId);
  await page.locator("#tab-units").click();
  await expect(page.locator("#train-trooper")).toBeDisabled();
  await expect(
    page.locator("#panel-selection [data-network-status]"),
  ).toContainText("Disconnected");
  await expect(page.locator("#production-queue button")).toContainText(
    "Paused",
  );
  const progress = await page.evaluate(
    () =>
      window.sessionHarness.view.simulation.economy!.production[0]
        .completedTicks,
  );
  await advance(page, 10);
  expect(
    await page.evaluate(
      () =>
        window.sessionHarness.view.simulation.economy!.production[0]
          .completedTicks,
    ),
  ).toBe(progress);
  expect(
    await page.evaluate(() =>
      window.sessionHarness.view.scene.meshes.some((mesh) =>
        mesh.name.endsWith("-offline"),
      ),
    ),
  ).toBe(true);
  await attachScreenshot(page, testInfo, "disconnected-network");
  await place(page, "#build-barracks", 16, 50);
  await advance(page, 5);
  await expect(page.locator("#unit-roster button")).toHaveCount(1);
  await expect(networkAlerts.first()).toHaveText("• 1 building reconnected");
  await page.evaluate(async () => {
    const { currentContentPack } = await import("/src/content/packs.ts");
    const { prototypeTerrainMap } = await import("/e2e/harness.ts");
    const { createTilePlacedActor } =
      await import("/src/simulation/placement.ts");
    const simulation = window.sessionHarness.view.simulation;
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
      "player",
    );
    const totalTicks = Math.round(8 / simulation.tickSeconds);
    backup.construction = {
      paidCost: 100,
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
    const { view } = window.sessionHarness;
    const wolf = view.simulation.actorById("lone-wolf")!;
    const hidden = !view.simulation.detects("player", wolf);
    view.simulation.spawnActor({
      id: "duelist",
      definitionId: "arc-trooper",
      owner: "player",
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
    const { simulation } = window.sessionHarness.view;
    return {
      trooper: simulation.actorById("duelist")!.combat?.attack?.targetId,
      wolf: simulation.actorById("lone-wolf")!.combat?.attack?.targetId,
    };
  });
  expect(engaged).toEqual({ trooper: "lone-wolf", wolf: "duelist" });
  // A shot within the rifle's one-second cooldown flashes at the Trooper.
  const flashed = await page.evaluate(() => {
    const harness = window.sessionHarness;
    const { scene } = harness.view;
    for (let step = 0; step < 40; step++) {
      harness.now += 50;
      scene.onBeforeAnimationsObservable.notifyObservers(scene);
      scene.onBeforeRenderObservable.notifyObservers(scene);
      const flash = scene.meshes.find(({ name }) => name === "frame-effect");
      if (flash)
        return flash.isDescendantOf(
          scene.getTransformNodeByName("actor-duelist-root")!,
        );
    }
  });
  expect(flashed).toBe(true);
  await advance(page, 12);
  const result = await page.evaluate(() => {
    const { simulation } = window.sessionHarness.view;
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
  await page.evaluate(() => window.sessionHarness.view.selectActor("duelist"));
  await expect(page.locator("#selection-health")).toHaveText(
    `Health ${result.health} / 100`,
  );
  await page.evaluate(() =>
    window.sessionHarness.view.simulation.removeActor("duelist"),
  );
  await advance(page, 0.1);
  expect(
    await page.evaluate(() => {
      const { view } = window.sessionHarness;
      return view.scene.getTransformNodeByName("wreck-lone-wolf")!.isEnabled();
    }),
  ).toBe(false);
});

test("hostile buildings require detection and expose inspection without player controls", async ({
  page,
}) => {
  await controlledOpening(page, {
    playerOwner: "wildlife",
    extraBuildings: [
      {
        actorId: "enemy-barracks",
        definitionId: "arc-field-barracks",
        origin: { x: 12, z: 49 },
      },
    ],
  });
  await advance(page, 0.1);
  const initiallyHidden = await page.evaluate(() => {
    const { view } = window.sessionHarness;
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
  await expect(page.locator("#building-options button")).toHaveCount(0);
  await expect(page.locator("#training-options button:visible")).toHaveCount(0);
  await expect(page.locator("#training-options button:enabled")).toHaveCount(0);
  await page.evaluate(() => {
    const { view } = window.sessionHarness;
    const position = { x: 10.5 - 50, z: 50.5 - 50 };
    view.simulation.spawnActor({
      id: "observer",
      definitionId: "wolf",
      owner: "wildlife",
      worldPosition: position,
      facing: 0,
      occupancyLayer: "surface",
      territory: { home: position },
    });
    view.selectActor("enemy-barracks");
  });
  await advance(page, 0.1);
  await expect(page.locator("#selection-details")).toContainText(
    "Field Barracks",
  );
  await expect(page.locator("#selection-health")).toBeVisible();
  await expect(page.locator("#remove-building")).toBeHidden();
  await expect(page.locator("#remove-building")).toBeDisabled();
  await expect(page.locator("#open-training")).toBeHidden();
  await expect(page.locator("#training-options button:visible")).toHaveCount(0);
  await expect(page.locator("#training-options button:enabled")).toHaveCount(0);
  await expect(page.locator("[data-rally-controls]").first()).toBeHidden();
  await expect(page.locator("#construction-queue button")).toHaveCount(0);
  await expect(page.locator("#production-queue button")).toHaveCount(0);
  const rendered = await page.evaluate(() => {
    const { view } = window.sessionHarness;
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
      () => !!window.sessionHarness.view.simulation.actorById("enemy-barracks"),
    ),
  ).toBe(true);
  await page.evaluate(() =>
    window.sessionHarness.view.simulation.removeActor("observer"),
  );
  await advance(page, 0.1);
  await expect(page.locator("#game-canvas")).toHaveAttribute(
    "data-selected-actors",
    "[]",
  );
  expect(
    await page.evaluate(
      () =>
        !!window.sessionHarness.view.scene.getTransformNodeByName(
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
    const { simulation } = window.sessionHarness.view;
    const cc = simulation.actorById("starting-command-center")!;
    simulation.removeActor(cc.id);
    simulation.spawnActor({
      ...cc,
      id: "damaged-command-center",
      health: 1640,
    });
    window.sessionHarness.view.selectActor("damaged-command-center");
  });
  await advance(page, 0.1);
  await expect(page.locator("#remove-building")).toHaveText(
    "Sell building (+123 Materials)",
  );
  await page.locator("#remove-building").click();
  await advance(page, 0.1);
  await expect(page.locator("#materials-counter")).toHaveText("273");
});

forEachProfile(MOUSE_AND_PHONE_PROFILES, (profile) => {
  test("Attack Move supports cancellation, combat, and resumption", async ({
    page,
  }, testInfo) => {
    await controlledOpening(page);
    await page.evaluate(() => {
      const { view } = window.sessionHarness;
      view.simulation.spawnActor({
        id: "advance-trooper",
        definitionId: "arc-trooper",
        owner: "player",
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
          window.sessionHarness.view.simulation.actorById("advance-trooper")!
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
    await pressPoint(page, point, profile.touch);
    const destination = await page.evaluate(async () => {
      const { prototypeTerrainMap } = await import("/e2e/harness.ts");
      const order = window.sessionHarness.view.simulation
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
          window.sessionHarness.view.scene.getMeshByName(
            "attack-move-destination",
          ) !== null,
      ),
    ).toBe(true);
    await advance(page, 20);
    const result = await page.evaluate(() => {
      const { simulation } = window.sessionHarness.view;
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
    await attachScreenshot(page, testInfo, `attack-move-${profile.name}`);
  });
});

test("Goals tracks victory and restores free play", async ({
  page,
}, testInfo) => {
  await openOpening(page);
  await expectTerrainReady(page);
  await action(page, "#tab-goals");
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
  await attachScreenshot(page, testInfo, `goals`);
  const saves = await page.evaluate(async () => {
    const { level, missionSource, simulateMission } =
      await import("/e2e/missions.ts");
    const { createActor } = await import("/src/simulation/actor.ts");
    const mission = level();
    const { state } = mission;
    for (const wolf of state.actors.filter((actor) => actor.territory)) {
      if (wolf.id === "den-alpha-wolf") continue;
      wolf.health = 1;
      state.actors.push(
        createActor({
          id: `trooper-${wolf.id}`,
          definitionId: "arc-trooper",
          owner: "player",
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
  await upload(page, saves.partial);
  await action(page, "#inspect-loaded-mission");
  await action(page, "#tab-buildings");
  await expect(page.locator("#build-barracks")).toBeDisabled();
  await action(page, "#tab-units");
  await action(page, "#unit-roster button:nth-of-type(1)");
  await expect(page.locator("#stop-units")).toBeDisabled();
  await action(page, "#tab-goals");
  await expect(page.locator('[data-goal-id="lone-wolf"]')).toHaveClass(
    "goal-complete",
  );
  await expect(page.locator('[data-goal-id="wolf-den"]')).toContainText(
    "(4/5)",
  );
  await expect(page.locator('[data-goal-id="wolf-den"]')).not.toHaveClass(
    "goal-complete",
  );
  await upload(page, saves.pending);
  await action(page, "#resume-mission");
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
  await attachScreenshot(page, testInfo, `victory`);
  await action(page, "#resume-mission");
  await action(page, "#tab-goals");
  await expect(page.locator("#mission-objectives .goal-complete")).toHaveCount(
    2,
  );
  await expect(page.locator("#mission-directive")).toContainText(
    "Victory secured",
  );
  await upload(page, saves.victory);
  await expect(page.locator("#game-menu-title")).toHaveText("Victory");
  await action(page, "#restart-mission");
  await dismissExplanation(page, "Welcome, Commander");
  await action(page, "#tab-goals");
  await expect(page.locator("#mission-objectives .goal-complete")).toHaveCount(
    0,
  );
  await expect(page.locator('[data-goal-id="wolf-den"]')).toContainText(
    "(0/5)",
  );
});

test("Command Center defeat pauses, rejects bad loads, restores, restarts, and exits", async ({
  page,
}, testInfo) => {
  const errors = collectPageErrors(page);
  await openOpening(page);
  await expectTerrainReady(page);
  const saves = await page.evaluate(async () => {
    const { level, missionSource, simulateMission } =
      await import("/e2e/missions.ts");
    const mission = level();
    const { state } = mission;
    state.actors.find(
      (actor) => actor.id === "starting-command-center",
    )!.health = 1;
    const wolf = state.actors.find((actor) => actor.id === "lone-wolf")!;
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
  await upload(page, saves.pending);
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
  await expect(page.locator("#build-barracks")).toHaveAccessibleDescription(
    /Mission ended in defeat\./,
  );
  await expect(page.locator("#train-trooper")).toHaveAccessibleDescription(
    /Mission ended in defeat\./,
  );
  await expect(page.locator("#restart-mission")).toBeVisible();
  await expect(page.locator("#load-mission")).toBeVisible();
  await attachScreenshot(page, testInfo, "defeat");
  await upload(page, '{"version":0}');
  await expect(page.locator("#game-menu-status")).toContainText(
    "not a mission file",
  );
  await expect(page.locator("#game-menu-title")).toHaveText("Defeat");
  await upload(page, saves.defeated);
  await expect(page.locator("#game-menu-status")).toHaveText("");
  await expect(page.locator("#game-menu-title")).toHaveText("Defeat");
  await expect(page.locator("#resume-mission")).toBeHidden();
  await page.locator("#restart-mission").click();
  await dismissExplanation(page, "Welcome, Commander");
  await expect(page.locator("#game-menu")).not.toBeVisible();
  await expect(page.locator("#materials-counter")).toHaveText("150");
  await expect(page.locator("#game-canvas")).not.toHaveAttribute(
    "data-mission-result",
    "defeat",
  );
  await upload(page, saves.defeated);
  await expect(page.locator("#game-menu-title")).toHaveText("Defeat");
  await page.locator("#exit-mission").click();
  await expect(page.locator("#game-menu-title")).toHaveText(
    "Citadels of the Unquiet World",
  );
  await startOpening(page);
  await expect(page.locator("#materials-counter")).toHaveText("150");
  expect(errors).toEqual([]);
});
