import { expect, test } from "./fixtures";
import {
  forEachProfile,
  PHONE_PROFILE,
  PROFILES,
  TOUCH_PROFILES,
} from "./profiles";
import {
  activate,
  attachScreenshot,
  expectTerrainReady,
  placeBuilding,
  terrainPoint,
} from "./page-helpers";
import { QUICK, WEBKIT } from "./tags";

import type { GameSessionControls } from "../src/session";
import type {
  ActorDefinition,
  ActorRenderState,
} from "../src/simulation/actor";
import type { SidebarOptions, SidebarState } from "../src/ui/sidebar";

test("partial sidebar setup releases its tooltip and listeners", async ({
  page,
}) => {
  await page.goto("/?level=sandbox");
  const result = await page.evaluate(async () => {
    const { createSidebar } = await import("/src/ui/sidebar.ts");
    const root = document.createElement("aside");
    root.id = "failed-sidebar";
    document.body.append(root);
    const count = () => document.querySelectorAll(".production-tooltip").length;
    const before = count();
    let failed = false;
    try {
      createSidebar(root, {
        definitions: [
          { id: "broken", behaviorId: "idle", movement: { speed: 1 } },
        ],
        playerOwner: "player",
        presentations: new Map([
          [
            "broken",
            {
              name: "Broken",
              description: "",
              train: { id: "train-broken", label: "Train broken" },
              get portrait(): undefined {
                throw new Error("Card setup failed");
              },
            },
          ],
        ]),
        goals: [],
        selectActor: () => {},
      });
    } catch {
      failed = true;
    }
    const after = count();
    const emptied = root.childElementCount === 0;
    root.remove();
    return { failed, before, after, emptied };
  });
  expect(result.failed).toBe(true);
  expect(result.after).toBe(result.before);
  expect(result.emptied).toBe(true);
});

forEachProfile(PROFILES, (profile) => {
  test(
    "orders stay visible while panels scroll",
    { tag: WEBKIT },
    async ({ page }, info) => {
      await page.goto("/?level=sandbox");
      await placeBuilding(page, "build-barracks", 55, 39, {
        touch: profile.touch,
      });
      await activate(page.locator("#train-trooper"), profile.touch);
      await activate(page.locator("#unit-roster button"), profile.touch);
      await page.evaluate(() => {
        const list = document.createElement("ul");
        for (let index = 0; index < 40; index++) {
          const item = document.createElement("li");
          item.textContent = `Selection detail ${index + 1}`;
          list.append(item);
        }
        document.querySelector("#panel-selection")!.append(list);
      });
      const orders = page.locator(".unit-controls");
      const before = await orders.boundingBox();
      for (const button of await orders.locator("button:visible").all())
        await expect(button).toBeInViewport({ ratio: 1 });
      const scroll = await page.evaluate(() => {
        const panel = document.querySelector<HTMLElement>(".selection-pane")!;
        panel.scrollTop = panel.scrollHeight;
        return panel.scrollTop;
      });
      expect(scroll).toBeGreaterThan(0);
      expect(await orders.boundingBox()).toEqual(before);
      await activate(page.locator("#stop-units"), profile.touch);
      await activate(page.locator("#tab-buildings"), profile.touch);
      await expect(page.locator("#stop-units")).toBeInViewport({ ratio: 1 });
      await info.attach(`pinned-orders-${profile.name}`, {
        body: await page.screenshot({
          path: info.outputPath(`pinned-orders-${profile.name}.png`),
        }),
        contentType: "image/png",
      });
    },
  );
});

test("production pictures explain disabled cards and keep selection visible", async ({
  page,
}) => {
  await page.goto("/?level=sandbox");
  await expect(page.locator("#building-options .actor-portrait")).toHaveCount(
    2,
  );
  await page.locator("#build-barracks").focus();
  await expect(page.getByRole("tooltip")).toContainText(
    "Trains Trooper & Scout",
  );
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tooltip")).toBeHidden();
  await placeBuilding(page, "build-barracks", 55, 39);
  await expect(page.locator("#train-scout")).toBeEnabled();
  await page.locator("#pause-mission").click();
  await expect(page.locator("#train-scout")).toBeDisabled();
  const card = page.locator(".production-card", {
    has: page.locator("#train-scout"),
  });
  await card.focus();
  await expect(page.getByRole("tooltip")).toContainText(
    "Resume the mission to train units",
  );
  await page.locator("#pause-mission").click();
  await expect(page.locator("#panel-units")).toBeVisible();
  await expect(page.locator("#panel-selection")).toBeVisible();
  const goals = page.locator("#tab-goals");
  await goals.click();
  await expect(goals).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#panel-goals")).toBeVisible();
  await goals.click();
  await expect(goals).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#panel-units")).toBeVisible();
  await page.locator("#tab-buildings").click();
  await expect(page.locator("#selection-details")).toContainText(
    "Field Barracks",
  );
  await expect(page.locator("[data-rally-controls]")).toBeVisible();
});

test("goal lists reconcile changed content, order, and failure status", async ({
  page,
}) => {
  await page.goto("/?level=sandbox");
  const result = await page.evaluate(async () => {
    const { createGoalList } = await import("/src/ui/goals.ts");
    const list = document.createElement("ul");
    const goals = createGoalList(list, true);
    goals.update([
      {
        id: "protect",
        label: "Protect convoy",
        directive: "Keep it alive.",
        status: "active",
      },
      {
        id: "clear",
        label: "Clear guards",
        status: "active",
        progress: { current: 0, total: 2 },
      },
    ]);
    const protection = list.children[0];
    goals.update([
      {
        id: "clear",
        label: "Clear outpost",
        directive: "Both guards defeated.",
        status: "complete",
        progress: { current: 2, total: 2 },
      },
      { id: "protect", label: "Protect transports", status: "failed" },
    ]);
    const reconciled = {
      ids: [...list.children].map(
        (item) => (item as HTMLElement).dataset.goalId,
      ),
      preserved: list.children[1] === protection,
      texts: [...list.children].map((item) => item.textContent),
      failed: protection.className,
      staleDirective: protection.querySelector("p")!.hidden,
    };
    goals.update([{ id: "clear", label: "Clear outpost", status: "complete" }]);
    return {
      ...reconciled,
      remaining: list.children.length,
      removed: !list.contains(protection),
    };
  });
  expect(result).toEqual({
    ids: ["clear", "protect"],
    preserved: true,
    texts: [
      "✓ Clear outpost (2/2)Both guards defeated.",
      "✗ Protect transports",
    ],
    failed: "goal-failed",
    staleDirective: true,
    remaining: 1,
    removed: true,
  });
});

test(
  "starts empty with a reserved sidebar and builds and trains through its tabs",
  { tag: [QUICK, WEBKIT] },
  async ({ page }, testInfo) => {
    await page.goto("/?level=sandbox");
    const canvas = page.locator("#game-canvas");
    await expect(canvas).toHaveAttribute("data-tile-placed-actor-count", "0");
    await expect(page.locator("#tab-buildings")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const sidebarBounds = (await page.locator("#game-sidebar").boundingBox())!;
    const canvasBounds = (await canvas.boundingBox())!;
    expect(canvasBounds.x).toBe(sidebarBounds.width);
    expect(sidebarBounds.height).toBe(720);
    await page.locator("#tab-units").click();
    await expect(page.locator("#train-trooper")).toBeDisabled();
    await expect(page.locator("#unit-roster")).toContainText("No units yet");

    await placeBuilding(page, "build-command-center", 49, 39);
    await expect(page.locator("#panel-selection")).toBeVisible();
    await expect(page.locator("#selection-details")).toHaveText(
      "Command Center · 2 × 2 · 0°",
    );
    // Selecting a production building opens its training options.
    await placeBuilding(page, "build-barracks", 55, 39);
    await expect(page.locator("#panel-units")).toBeVisible();
    await expect(page.locator("#selection-details")).toHaveText(
      "Field Barracks · 3 × 2 · 0°",
    );
    await page.locator("#open-training").click();
    for (const [index, unit] of ["trooper", "scout", "trooper"].entries()) {
      await page.locator(`#train-${unit}`).click();
      await expect(page.locator("#unit-roster button")).toHaveCount(index + 1);
    }
    await page.locator("#unit-roster button").nth(1).click();
    await expect(page.locator("#selection-details")).toHaveText("Scout");
    await expect(page.locator("#selection-info")).toContainText(
      "Movement speed 7",
    );
    await page.locator("#box-select").click();
    await expect(page.locator("#selection-info")).toContainText(
      "Turn off Box select to move this unit.",
    );
    await page.locator("#box-select").click();
    await expect(page.locator("#selection-info")).toContainText(
      "Tap or click terrain to move this unit.",
    );
    await expect(page.locator("#remove-building")).toBeDisabled();
    await expect(page.locator("#unit-roster button")).toHaveText([
      "Trooper · 1",
      "Scout · 1",
      "Trooper · 2",
    ]);
    await page.locator("#tab-units").click();
    await expect(page.locator("#train-scout")).toBeDisabled();
    const barracks = await terrainPoint(page, 55, 39);
    await page.mouse.click(barracks.x, barracks.y);
    await expect(page.locator("#panel-units")).toBeVisible();
    await expect(page.locator("#train-scout")).toBeEnabled();
    await page.locator("#train-scout").click();
    await expect(page.locator("#unit-roster button")).toHaveCount(4);
    await page.locator("#unit-roster button").nth(1).focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#unit-roster button").nth(1)).toBeFocused();
    await expect(page.locator("#panel-selection")).toBeVisible();
    await page.mouse.click(barracks.x, barracks.y);
    await expect(page.locator("#panel-units")).toBeVisible();
    await attachScreenshot(page, testInfo, "sidebar-desktop");
    await page.locator("#tab-goals").click();
    await expect(page.locator("#scenario-goals .goal-complete")).toHaveCount(4);
    await expect(page.locator("#scenario-goals")).toContainText(
      "Train a Trooper (2)",
    );
    await page.locator("#tab-units").focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.locator("#tab-buildings")).toBeFocused();
    await expect(page.locator("#panel-buildings")).toBeVisible();
  },
);

test("blocked exits disable training until a unit moves away", async ({
  page,
}) => {
  await page.goto("/?level=sandbox");
  await expectTerrainReady(page);
  await placeBuilding(page, "build-barracks", 49, 39);
  for (let i = 0; i < 10; i++) {
    await page.locator("#train-trooper").click();
    await expect(page.locator("#unit-roster button")).toHaveCount(i + 1);
  }
  await expect(page.locator("#train-trooper")).toBeDisabled();
  await expect(page.locator("#production-status")).toContainText(
    "Exit blocked",
  );
  await page.locator("#unit-roster button").first().click();
  const point = await terrainPoint(page, 51, 45);
  await page.mouse.click(point.x, point.y);
  await expect(page.locator("#game-canvas")).toHaveAttribute(
    "data-move-status",
    "accepted",
  );
  await page.locator("#tab-units").click();
  const barracks = await page.evaluate(async () => {
    const { gameScene, projectToCanvas } = await import("/e2e/harness.ts");
    const scene = gameScene();
    const root = scene.getTransformNodeByName(
      "tile-placed-actor-arc-field-barracks-1-root",
    )!;
    const roof = root
      .getChildMeshes()
      .find((mesh) => mesh.name.endsWith("-roof"))!;
    roof.computeWorldMatrix(true);
    const canvas = document.querySelector<HTMLCanvasElement>("#game-canvas")!;
    return projectToCanvas(
      scene,
      canvas,
      roof.getBoundingInfo().boundingBox.centerWorld,
    );
  });
  await page.mouse.click(barracks.x, barracks.y);
  await expect(page.locator("#train-trooper")).toBeEnabled();
  await page.locator("#train-trooper").click();
  await expect(page.locator("#unit-roster button")).toHaveCount(11);
});

forEachProfile(TOUCH_PROFILES, (profile) => {
  test(
    "touch layout can build a barracks and train both unit types",
    { tag: profile === PHONE_PROFILE ? [QUICK, WEBKIT] : WEBKIT },
    async ({ page }, testInfo) => {
      await page.goto("/?level=sandbox");
      await expectTerrainReady(page);
      await page.locator("#build-barracks").tap();
      await expect(page.locator("#placement-panel")).toBeVisible();
      for (const button of await page
        .locator(".unit-controls button:visible")
        .all())
        await expect(button).toBeInViewport({ ratio: 1 });
      await expect(page.locator("#cancel-building")).toBeInViewport({
        ratio: 1,
      });
      const placement = (await page.locator("#placement-panel").boundingBox())!;
      const selection = (await page.locator(".selection-pane").boundingBox())!;
      expect(placement.y).toBeGreaterThanOrEqual(
        selection.y + selection.height,
      );
      const point = await terrainPoint(page, 55, 39);
      await page.touchscreen.tap(point.x, point.y);
      await expect(page.locator("#game-canvas")).toHaveAttribute(
        "data-placement-status",
        "valid",
      );
      await page.locator("#confirm-building").tap();
      await expect(page.locator("#selection-details")).toContainText(
        "Field Barracks",
      );
      await expect(page.locator("#panel-units")).toBeVisible();
      await page.locator("#train-trooper").tap();
      await expect(page.locator("#unit-roster button")).toHaveCount(1);
      await expect(page.getByRole("tooltip")).toBeHidden();
      await page.locator("#train-scout").tap();
      await expect(page.locator("#unit-roster button")).toHaveCount(2);
      // The world fills the space the reserved sidebar leaves.
      const sidebar = (await page.locator("#game-sidebar").boundingBox())!;
      const bounds = (await page.locator("#game-canvas").boundingBox())!;
      expect(bounds.x).toBe(sidebar.x + sidebar.width);
      expect(bounds.x + bounds.width).toBe(profile.viewport.width);
      await attachScreenshot(page, testInfo, `sidebar-${profile.name}`);
    },
  );
});

test(
  "sidebar derives custom content and can be disposed and recreated",
  { tag: WEBKIT },
  async ({ page }) => {
    await page.goto("/?level=sandbox");
    const result = await page.evaluate(async () => {
      const { createSidebar } = await import("/src/ui/sidebar.ts");
      const { createRelations, ownerRelation } =
        await import("/src/simulation/ownership.ts");
      const relationTo =
        (relations: ReturnType<typeof createRelations>) =>
        ({ owner }: { owner: string }) =>
          ownerRelation("player", owner, relations.relationship);
      const root = document.createElement("aside");
      root.className = "game-sidebar";
      root.id = "sidebar-fixture";
      Object.assign(root.style, {
        position: "fixed",
        left: "0",
        top: "0",
        width: "320px",
        height: "720px",
        zIndex: "20",
      });
      document.body.append(root);
      const definitions: ActorDefinition[] = [
        {
          id: "runner",
          faction: "circle",
          behaviorId: "move",
          lifebloomCost: 20,
          movement: { speed: 9, profileId: "ground" },
        },
        {
          id: "factory",
          faction: "arc",
          behaviorId: "idle",
          lifebloomCost: 75,
          production: { unitDefinitionIds: ["runner"] },
          footprint: {
            layer: "surface",
            blocksMovement: true,
            occupiedTiles: [
              { x: 0, z: 0 },
              { x: 1, z: 0 },
            ],
          },
        },
      ];
      definitions.push({
        ...definitions[1],
        id: "circle-hub",
        faction: "circle",
        support: { root: true, radius: 10 },
        infrastructure: { slots: 1 },
      });
      const presentations = new Map([
        [
          "runner",
          {
            name: "Runner",
            description: "Mobile unit",
            train: { id: "train-runner", label: "Train Runner" },
          },
        ],
        [
          "factory",
          {
            name: "Foundry",
            description: "Production",
            build: { id: "build-foundry", label: "Build Foundry" },
          },
        ],
      ]);
      let selected = "";
      const options = {
        definitions,
        presentations,
        playerOwner: "player",
        playerFaction: "arc",
        factionName: "Foundry <crew>",
        economy: true,
        goals: [{ definitionId: "runner", label: "Train a Runner" }],
        selectActor: (id) => {
          selected = id;
        },
      } satisfies SidebarOptions;
      const actors: ActorRenderState[] = [
        {
          id: "building",
          definitionId: "factory",
          owner: "player",
          worldPosition: { x: 0, z: 0 },
          occupancyLayer: "surface",
          facing: Math.PI / 2,
          tilePlacement: { origin: { x: 2, z: 2 }, quarterTurns: 1 },
        },
        {
          id: "unit",
          definitionId: "runner",
          owner: "player",
          worldPosition: { x: 2, z: 0 },
          occupancyLayer: "surface",
          facing: 0,
        },
      ];
      actors.push({ ...actors[0], id: "visitor", owner: "rival" });
      const state = {
        actors: actors.filter(({ id }) => id !== "visitor"),
        actorVersion: 0,
        selectedActorIds: ["building"],
        placementActive: false,
        faulted: false,
        canRemove: true,
        balances: { lifebloom: 10 },
        relationTo: relationTo(createRelations([])),
      } satisfies SidebarState;
      const runnerCard = () =>
        root
          .querySelector<HTMLElement>("#train-runner")!
          .closest<HTMLElement>(".production-card")!;
      let sidebar = createSidebar(root, options);
      try {
        sidebar.update(state);
        const title = root.querySelector("#selection-details")!.textContent;
        const foreignRosterVisible = !runnerCard().hidden;
        const descriptionFor = (id: string) =>
          document.getElementById(
            root.querySelector(`#${id}`)!.getAttribute("aria-describedby")!,
          )!.textContent;
        const buildText = descriptionFor("build-foundry");
        const trainText = descriptionFor("train-runner");
        const buildButton =
          root.querySelector<HTMLButtonElement>("#build-foundry")!;
        const unaffordable = buildButton.disabled;
        const costs = [...root.querySelectorAll(".option-cost")].map(
          (cost) => cost.textContent,
        );
        const faction = root.querySelector("#faction-label")!;
        const factionIsText =
          faction.textContent === "Foundry <crew>" &&
          faction.children.length === 0;
        sidebar.update({ ...state, balances: { lifebloom: 100 } });
        const updatedInPlace =
          root.querySelector("#build-foundry") === buildButton &&
          !buildButton.disabled;
        const network = root.querySelector<HTMLElement>(
          "#network-view-control",
        )!;
        const foreignNetworkHidden = network.hidden;
        sidebar.update({
          ...state,
          actorVersion: 1,
          actors: [
            ...state.actors,
            { ...actors[0], id: "captured-hub", definitionId: "circle-hub" },
          ],
        });
        const ownedForeignNetworkVisible = !network.hidden;
        sidebar.update({ ...state, balances: { materials: 1000 } });
        const missingCurrencyBlocked = buildButton.disabled;
        sidebar.update(state);
        root.querySelector<HTMLButtonElement>("#tab-units")!.click();
        const trainingCard = runnerCard();
        trainingCard.tabIndex = 0;
        trainingCard.focus();
        sidebar.update({ ...state, selectedActorIds: ["unit"] });
        const hiddenCardFocus =
          document.activeElement === root.querySelector("#tab-units");
        const listedUnit = root.querySelector<HTMLButtonElement>(
          "#unit-roster button",
        )!;
        listedUnit.focus();
        sidebar.update({
          ...state,
          selectedActorIds: ["unit"],
          canRemove: false,
        });
        const retainedFocus = document.activeElement === listedUnit;
        const retainedNode =
          root.querySelector("#unit-roster button") === listedUnit;
        listedUnit.click();
        const selectedByClick = selected;
        const inspectVisitor = (
          relationship: "allied" | "neutral" | "hostile",
        ) => {
          sidebar.update({
            ...state,
            actors,
            selectedActorIds: ["visitor"],
            relationTo: relationTo(
              createRelations(
                relationship === "neutral"
                  ? []
                  : [{ owners: ["player", "rival"], relationship }],
              ),
            ),
          });
          return root.querySelector("#selection-info")!.textContent;
        };
        const alliedInfo = inspectVisitor("allied");
        const visitorTrainingHidden = runnerCard().hidden;
        const neutralInfo = inspectVisitor("neutral");
        const hostileInfo = inspectVisitor("hostile");
        sidebar.dispose();
        const emptied = root.childElementCount === 0;
        selected = "";
        listedUnit.click();
        const disposed = selected === "";
        sidebar = createSidebar(root, options);
        sidebar.update(state);
        return {
          title,
          buildText,
          trainText,
          retainedFocus,
          retainedNode,
          selectedByClick,
          disposed,
          emptied,
          unaffordable,
          costs,
          factionIsText,
          updatedInPlace,
          missingCurrencyBlocked,
          hiddenCardFocus,
          foreignNetworkHidden,
          ownedForeignNetworkVisible,
          foreignRosterVisible,
          visitorTrainingHidden,
          alliedInfo,
          neutralInfo,
          hostileInfo,
          buildings: root.querySelectorAll("#building-options button").length,
          units: root.querySelectorAll("#training-options button").length,
          goals: root.querySelectorAll("#scenario-goals li").length,
        };
      } finally {
        sidebar.dispose();
        root.remove();
      }
    });
    expect(result).toMatchObject({
      title: "Foundry · 1 × 2 · 90°",
      retainedFocus: true,
      retainedNode: true,
      selectedByClick: "unit",
      disposed: true,
      emptied: true,
      unaffordable: true,
      costs: ["75 Lifebloom", "20 Lifebloom"],
      factionIsText: true,
      updatedInPlace: true,
      missingCurrencyBlocked: true,
      hiddenCardFocus: true,
      foreignNetworkHidden: true,
      ownedForeignNetworkVisible: true,
      foreignRosterVisible: true,
      visitorTrainingHidden: true,
      buildings: 1,
      units: 1,
      goals: 1,
    });
    expect(result.buildText).toContain("Trains Runner · 2 × 1 tiles");
    expect(result.buildText).toContain("Need 75 Lifebloom; available 10.");
    expect(result.trainText).toContain("Speed 9");
    expect(result.alliedInfo).toContain(
      "Allied · Production · Not under your command.",
    );
    expect(result.neutralInfo).toContain(
      "Neutral · Production · Not under your command.",
    );
    expect(result.hostileInfo).toContain(
      "Hostile · Production · Select your units",
    );
  },
);

test("session controls skip unchanged frames and removal works without a sidebar", async ({
  page,
}) => {
  await page.goto("/?level=sandbox");
  const result = await page.evaluate(async () => {
    const { createGameSession } = await import("/src/session.ts");
    const { createTilePlacedActor } =
      await import("/src/simulation/placement.ts");
    const { level, missionMap } = await import("/e2e/missions.ts");
    const mission = level("sandbox");
    const canvas = document.createElement("canvas");
    const minimap = document.createElement("canvas");
    Object.assign(canvas.style, { width: "640px", height: "480px" });
    document.body.append(canvas, minimap);
    const remove = document.createElement("button");
    const build = document.createElement("button");
    const cancel = document.createElement("button");
    const train = document.createElement("button");
    const definitionId = "arc-field-barracks";
    let updates = 0;
    const controls: GameSessionControls = {
      mission,
      remove,
      cancel,
      buildings: [{ definitionId, button: build }],
      train: [{ definitionId: "arc-scout", button: train }],
      onStateChanged: () => {
        updates += 1;
      },
    };
    const view = await createGameSession(canvas, minimap, controls);
    view.engine.stopRenderLoop();
    let now = performance.now();
    const nowDescriptor = Object.getOwnPropertyDescriptor(performance, "now");
    Object.defineProperty(performance, "now", {
      configurable: true,
      value: () => now,
    });
    try {
      let evaluations = 0;
      const evaluateTraining = view.simulation.evaluateTraining;
      view.simulation.evaluateTraining = (command) => {
        evaluations += 1;
        return evaluateTraining(command);
      };
      const refresh = () => {
        view.scene.onBeforeAnimationsObservable.notifyObservers(view.scene);
        view.scene.onBeforeRenderObservable.notifyObservers(view.scene);
      };
      refresh();
      const baseline = updates;
      const baselineEvaluations = evaluations;
      for (let i = 0; i < 20; i++) refresh();
      const unchangedFrames =
        updates === baseline && evaluations === baselineEvaluations;
      const map = missionMap(mission);
      const definition = mission.definitions.find(
        (definition) => definition.id === definitionId,
      )!;
      view.simulation.spawnActor(
        createTilePlacedActor(
          map,
          definition,
          {
            actorId: "standalone-building",
            origin: { x: 49, z: 39 },
          },
          "player",
        ),
      );
      view.selectActor("standalone-building");
      refresh();
      const selectionRefresh = updates === baseline + 1 && !remove.disabled;
      view.simulation.tick();
      refresh();
      const tickRefresh =
        updates === baseline + 2 && evaluations === baselineEvaluations + 2;
      build.click();
      refresh();
      const placementRefresh = updates === baseline + 3 && remove.disabled;
      cancel.click();
      refresh();
      const cancelRefresh = updates === baseline + 4;
      controls.onStateChanged = undefined;
      view.selectActor("standalone-building");
      refresh();
      const standaloneEnabled = !remove.disabled;
      view.selectActor(undefined);
      refresh();
      const standaloneDisabled = remove.disabled;
      view.selectActor("standalone-building");
      refresh();
      remove.click();
      const pendingDisabled = remove.disabled;
      now += 20;
      refresh();
      const removed =
        !view.simulation.actorById("standalone-building") && remove.disabled;
      return {
        unchangedFrames,
        selectionRefresh,
        tickRefresh,
        placementRefresh,
        cancelRefresh,
        standaloneEnabled,
        standaloneDisabled,
        pendingDisabled,
        removed,
      };
    } finally {
      if (nowDescriptor)
        Object.defineProperty(performance, "now", nowDescriptor);
      else Reflect.deleteProperty(performance, "now");
      await view.disposeAsync();
      canvas.remove();
      minimap.remove();
    }
  });
  expect(result).toEqual({
    unchangedFrames: true,
    selectionRefresh: true,
    tickRefresh: true,
    placementRefresh: true,
    cancelRefresh: true,
    standaloneEnabled: true,
    standaloneDisabled: true,
    pendingDisabled: true,
    removed: true,
  });
});
