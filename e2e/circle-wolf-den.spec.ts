import { expect, test } from "./fixtures";
import {
  activate,
  advance,
  attachScreenshot,
  collectPageErrors,
  dismissExplanation,
  placeBuilding,
  pressPoint,
  terrainPoint,
  withoutApp,
} from "./page-helpers";
import { forEachProfile, MOUSE_AND_PHONE_PROFILES } from "./profiles";
import { WEBKIT } from "./tags";
import { MissionDriver } from "./mission-driver";

import type { AttackEvent } from "../src/simulation/combat";

declare global {
  interface Window {
    expireCircleShowcase: () => boolean;
  }
}

forEachProfile(MOUSE_AND_PHONE_PROFILES, ({ touch, name }) => {
  test(
    "Circle opens a paid living base, cultivates Lifebloom, and restarts",
    { tag: WEBKIT },
    async ({ page }, testInfo) => {
      const errors = collectPageErrors(page, { console: true });
      const requestedAudio: string[] = [];
      page.on("request", (request) => {
        if (request.url().endsWith(".wav")) requestedAudio.push(request.url());
      });
      const mission = new MissionDriver(page, { touch, realTime: true });
      await mission.opening({ dismissGuide: false, faction: "circle" });
      const canvas = page.locator("#game-canvas");
      await expect(canvas).toHaveAttribute("data-models-ready", "true");
      await dismissExplanation(page, "Welcome, Guide", touch);
      await expect(page.locator("#faction-label")).toHaveText(
        "Circle of Repose",
      );
      await expect(page.locator("#resource-bar")).toHaveAttribute(
        "aria-label",
        "150 Lifebloom",
      );
      await expect(page.locator("#build-circle-conservatory")).toBeDisabled();
      const heart = await terrainPoint(page, 9, 51);
      await pressPoint(page, heart, touch);
      await expect(page.locator("#selection-details")).toContainText(
        "Heartgrove",
      );
      await activate(page.locator('[data-speed="4"]'), touch);
      await expect(
        page.locator("#train-circle-cultivator svg"),
      ).toHaveAttribute("data-portrait", "circle-cultivator");
      await expect(
        page.locator("#build-circle-conservatory svg"),
      ).toHaveAttribute("data-portrait", "circle-conservatory");
      await activate(page.locator("#train-circle-cultivator"), touch);
      await expect(page.locator("#materials-counter")).toHaveText("100");
      const roster = page.locator("#unit-roster button");
      await expect(roster.filter({ hasText: "Cultivator" })).toHaveCount(1);
      await activate(roster.filter({ hasText: "Cultivator" }), touch);
      await expect(page.locator("#harvester-details")).toContainText("Idle");
      await placeBuilding(page, "build-circle-conservatory", 16, 50, {
        explanation: "Tending growth",
        touch,
      });
      await expect(page.locator("#materials-counter")).toHaveText("0");
      await dismissExplanation(page, "Cultivating Lifebloom", touch);
      await expect(page.locator("#construction-queue button")).toHaveCount(0);
      await activate(page.locator("#tab-units"), touch);
      await activate(roster.filter({ hasText: "Cultivator" }), touch);
      await activate(
        page.locator('[data-economy-action="cultivate:near-lifebloom"]'),
        touch,
      );
      await expect(page.locator("#harvester-details")).toContainText(
        "Cultivating",
        { timeout: 15000 },
      );
      await expect(page.locator("#materials-counter")).toHaveText("30", {
        timeout: 30000,
      });
      await expect(page.locator("#harvester-details")).toContainText(
        "Lifebloom",
      );
      expect(
        requestedAudio.some((url) => url.endsWith("/circle-cultivation.wav")),
      ).toBe(true);
      expect(
        requestedAudio.some((url) =>
          /harvester|refinery|rifle|unquiet-frontier|beneath-the-ridge/.test(
            url,
          ),
        ),
      ).toBe(false);
      await expect(
        page.locator('[data-economy-action="cultivate:south-lifebloom"]'),
      ).toBeVisible();
      await expect(page.locator("#worker-activity-heading")).toHaveText(
        "Cultivation and tending",
      );
      await attachScreenshot(page, testInfo, `circle-cultivation-${name}`);
      await activate(page.locator("#open-menu"), touch);
      await activate(page.locator("#quicksave-mission"), touch);
      await expect(page.locator("#game-menu-status")).toHaveText(
        "Quick save complete: Quicksave",
      );
      await activate(page.locator("#load-mission"), touch);
      const quick = page.locator("#save-entries li", { hasText: "Quicksave" });
      await activate(
        quick.getByRole("button", { name: "Load", exact: true }),
        touch,
      );
      await expect(page.locator("#game-menu-title")).toHaveText(
        "Mission loaded",
      );
      await expect(page.locator("#materials-counter")).toHaveText("30");
      await activate(page.locator("#resume-mission"), touch);
      await activate(page.locator("#tab-units"), touch);
      await activate(roster.filter({ hasText: "Cultivator" }), touch);
      await expect(page.locator("#harvester-details")).toContainText(
        "Lifebloom",
      );
      await activate(page.locator("#open-menu"), touch);
      await activate(page.locator("#restart-mission"), touch);
      await dismissExplanation(page, "Welcome, Guide", touch);
      await expect(canvas).toHaveAttribute("data-models-ready", "true");
      await expect(page.locator("#materials-counter")).toHaveText("150");
      await activate(page.locator("#tab-units"), touch);
      await expect(roster).toHaveCount(0);
      expect(errors).toEqual([]);
    },
  );
});

forEachProfile(MOUSE_AND_PHONE_PROFILES, ({ touch, name }) => {
  test(
    "complete the Circle introduction through strain and site rotation",
    { tag: WEBKIT },
    async ({ page }, testInfo) => {
      const errors = collectPageErrors(page, { console: true });
      const mission = new MissionDriver(page, { touch });
      const cultivate = async (index: number, site: string) => {
        await mission.select("Cultivator", index);
        await mission.press(`[data-economy-action="cultivate:${site}"]`);
      };
      await mission.opening({ faction: "circle" });
      for (let i = 0; i < 3; i++)
        await mission.press('[data-camera-action="tilt-up"]');
      await mission.ground(9, 51);
      await mission.press("#train-circle-cultivator");
      await mission.advance(5);
      await mission.select("Cultivator");
      await mission.place("circle-conservatory", 16, 50, {
        placement: "Tending growth",
        completion: "Cultivating Lifebloom",
      });
      await cultivate(0, "near-lifebloom");
      await mission.waitForStockpile(50);
      await mission.ground(9, 51);
      await mission.press("#train-circle-cultivator");
      await mission.advance(5);
      await cultivate(1, "near-lifebloom");
      await mission.awaitExplanation("Resting the land", 120);
      await cultivate(1, "south-lifebloom");

      await mission.waitForStockpile(100);
      await mission.select("Cultivator");
      await mission.place("circle-musterhall", 12, 54, {
        completion: "Gather your expedition",
      });
      await cultivate(0, "near-lifebloom");
      // Use the side of the footprint clear of the Heartgrove canopy.
      await mission.ground(13, 55);
      for (let i = 0; i < 6; i++) {
        await mission.waitForStockpile(35);
        await mission.press("#train-circle-sentinel");
      }
      await mission.advance(20);
      await expect(mission.rosterUnits("Sentinel")).toHaveCount(6);

      await mission.selectAll("Sentinel");
      await mission.focus(24, 42);
      await mission.ground(24, 42);
      await mission.advance(10);
      await mission.focus(34, 36);
      await mission.ground(34, 36);
      await mission.advance(10);
      await mission.focus(46, 32);
      await mission.press("#attack-move");
      await mission.ground(52, 32);
      await mission.advance(25);
      await mission.press("#tab-goals");
      await expect(page.locator('[data-goal-id="lone-wolf"]')).toContainText(
        "(1/1)",
      );
      await mission.selectAll("Sentinel");
      for (const [x, z, seconds] of [
        [57, 35, 8],
        [70, 34, 10],
        [77, 36, 13],
      ] as const) {
        await mission.focus(x, z);
        await mission.ground(x, z);
        await mission.advance(seconds);
      }
      await mission.focus(78, 29);
      await mission.press("#attack-move");
      await mission.ground(78, 21);
      await mission.advance(40);
      await expect(page.locator("#game-menu-title")).toHaveText("Victory");
      const elapsedSeconds = await mission.elapsedSeconds();
      expect(elapsedSeconds).toBeLessThan(10 * 60);
      await testInfo.attach("playthrough", {
        body: JSON.stringify({
          elapsedSeconds,
          strategy: "Two Cultivators rotated after strain, six Sentinels",
        }),
        contentType: "application/json",
      });
      await attachScreenshot(page, testInfo, `circle-victory-${name}`);
      expect(errors).toEqual([]);
    },
  );
});

test(
  "Circle normal play grows a Musterhall that trains Sentinels and Wayfinders",
  { tag: WEBKIT },
  async ({ page }) => {
    const errors = collectPageErrors(page, { console: true });
    const mission = new MissionDriver(page);
    const selected = page.locator("#selection-details");
    const cultivate = async () => {
      await mission.select("Cultivator");
      await mission.press('[data-economy-action="cultivate:near-lifebloom"]');
    };
    await mission.opening({ faction: "circle" });
    await mission.ground(9, 51);
    await expect(selected).toContainText("Heartgrove");
    await mission.press("#train-circle-cultivator");
    await mission.advance(5);
    await mission.select("Cultivator");
    await mission.place("circle-conservatory", 16, 50, {
      placement: "Tending growth",
      completion: "Cultivating Lifebloom",
    });
    await cultivate();
    await mission.waitForStockpile(100);
    await mission.place("circle-musterhall", 12, 54, {
      completion: "Gather your expedition",
    });
    await cultivate();
    await mission.waitForStockpile(55);
    // Use the side of the footprint clear of the Heartgrove canopy.
    await mission.ground(13, 55);
    await expect(selected).toContainText("Musterhall");
    await expect(page.locator("#selection-info")).toHaveText(
      "Circle infantry production · Trains Sentinel, Wayfinder, and Healer.",
    );
    for (const [id, label, cost] of [
      ["sentinel", "Train Sentinel", "35 Lifebloom"],
      ["wayfinder", "Train Wayfinder", "20 Lifebloom"],
    ]) {
      const selector = `#train-circle-${id}`;
      const card = page.locator(selector);
      await expect(card).toHaveAccessibleName(label);
      await expect(card.locator(".option-cost")).toHaveText(cost);
      await mission.press(selector);
    }
    await mission.advance(10);
    await mission.press("#tab-units");
    const roster = page.locator("#unit-roster button");
    await expect(roster.filter({ hasText: "Sentinel" })).toHaveCount(1);
    await expect(roster.filter({ hasText: "Wayfinder" })).toHaveCount(1);
    expect(errors).toEqual([]);
  },
);

test(
  "Circle growth explains its worker and resumes through both Tend actions",
  { tag: WEBKIT },
  async ({ page }) => {
    const errors = collectPageErrors(page, { console: true });
    const mission = new MissionDriver(page, { realTime: true });
    await mission.opening({ dismissGuide: false, faction: "circle" });
    await dismissExplanation(page, "Welcome, Guide");
    await pressPoint(page, await terrainPoint(page, 9, 51));
    await page.locator("#train-circle-cultivator").click();
    await page.locator('[data-speed="4"]').click();
    const worker = page
      .locator("#unit-roster button")
      .filter({ hasText: "Cultivator" });
    await expect(worker).toHaveCount(1);
    await page.locator("#tab-buildings").click();
    await expect(
      page
        .locator(".production-card")
        .filter({ has: page.locator("#build-circle-conservatory") }),
    ).toHaveAccessibleDescription(/Select a Cultivator to tend construction/);
    await page.locator("#tab-units").click();
    await worker.click();

    await page.locator("#tab-buildings").click();
    await page.locator("#build-circle-conservatory").click();
    await dismissExplanation(page, "Tending growth");
    const site = await terrainPoint(page, 16, 50);
    await page.mouse.move(site.x, site.y);
    const canvas = page.locator("#game-canvas");
    await expect(canvas).toHaveAttribute("data-placement-status", "valid");
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const { gameScene } = await import("/e2e/harness.ts");
          return !!gameScene().getMeshByName("growth-worker-preview");
        }),
      )
      .toBe(true);
    await page.mouse.click(site.x, site.y);
    await expect(canvas).toHaveAttribute("data-placement-active", "false");
    await page.locator('[data-speed="1"]').click();
    await page.locator("#tab-units").click();
    await worker.click();
    const tend = page.locator('[data-economy-action^="tend:"]');
    const stop = page.locator("#stop-units");

    await stop.click();
    await expect(tend).toBeEnabled();
    await tend.click();
    await expect(tend).toBeDisabled();

    await stop.click();
    await expect(tend).toBeEnabled();
    await page.mouse.click(site.x, site.y, { button: "right" });
    const menu = page.locator(".radial-menu");
    await expect(menu.locator(".radial-default")).toContainText("Tend");
    await menu.locator(".radial-default").click();
    await expect(tend).toBeDisabled();
    expect(errors).toEqual([]);
  },
);

test(
  "Circle silhouettes and living focus bolts render together",
  { tag: WEBKIT },
  async ({ page }, testInfo) => {
    const errors = collectPageErrors(page, { console: true });
    await page.goto("/?level=circle-wolf-den");
    await dismissExplanation(page, "Welcome, Guide");
    const result = await page.evaluate(async () => {
      const { createTestView, frames, Vector3 } =
        await import("/e2e/harness.ts");
      const { currentContentPack } = await import("/src/content/packs.ts");
      const { loadSkinnedActorAppearance } =
        await import("/src/render/skinned-actor-appearance.ts");
      const { loadModelAsset } = await import("/src/render/glb-model.ts");
      const { createCombatEffectsView } =
        await import("/src/render/combat-effects.ts");
      const view = createTestView({
        map: { width: 12, height: 12, tileSize: 1 },
        size: { width: 1000, height: 600 },
      });
      view.canvas.id = "circle-showcase";
      Object.assign(view.canvas.style, {
        position: "fixed",
        top: "0",
        left: "0",
        zIndex: "50",
      });
      view.camera.setTarget(new Vector3(0, 0.9, 0));
      view.camera.alpha = Math.PI / 2;
      view.camera.beta = 1.1;
      view.view.camera.zoomBy(0.4);
      view.camera.orthoLeft = -3.5;
      view.camera.orthoRight = 3.5;
      view.camera.orthoTop = 2.1;
      view.camera.orthoBottom = -2.1;
      const content = currentContentPack("base");
      for (const [index, id] of [
        "circle-sentinel",
        "circle-wayfinder",
      ].entries()) {
        const model = content.presentation[id]!.model!;
        if (!("glb" in model))
          throw new Error("Expected generated Circle model");
        const appearance = await loadSkinnedActorAppearance(
          view.scene,
          model.glb,
        );
        const actor = appearance.instantiate(id, 0);
        actor.root.position.x = index ? 1.35 : -1.35;
        actor.setAnimationState?.({ aiming: index === 0 });
        actor.play?.("attack");
        actor.animate?.({ seconds: 0.12, distance: 0, turn: 0 });
      }
      const bolt = await loadModelAsset(view.scene, content.props!.bolt!);
      let reduced = false;
      const effects = createCombatEffectsView(
        view.scene,
        view.map,
        () => bolt,
        () => reduced,
      );
      effects.hit(
        { from: { x: -1.3, z: 0.6 }, to: { x: 0.7, z: 2.7 } } as AttackEvent,
        "bolt",
      );
      effects.update(0.08);
      await frames(3);
      const strands = view.scene.meshes.filter(({ name }) =>
        name.includes("living-strand"),
      );
      const normal = strands[0].scaling.x;
      reduced = true;
      effects.update(0.01);
      await frames(2);
      const held = strands[0].scaling.x;
      effects.update(0.01);
      await frames(2);
      const stable = strands[0].scaling.x === held;
      window.expireCircleShowcase = () => {
        effects.update(1);
        return strands.every((strand) => strand.isDisposed());
      };
      return {
        strands: strands.length,
        animates: normal !== held,
        reducedMotionStable: stable,
      };
    });
    expect(result.strands).toBeGreaterThanOrEqual(3);
    expect(result.animates).toBe(true);
    expect(result.reducedMotionStable).toBe(true);
    await testInfo.attach("circle-showcase", {
      body: await page
        .locator("#circle-showcase")
        .screenshot({ path: testInfo.outputPath("circle-showcase.png") }),
      contentType: "image/png",
    });
    expect(await page.evaluate(() => window.expireCircleShowcase())).toBe(true);
    expect(errors).toEqual([]);
  },
);

test(
  "Circle production portraits show elven roles and living buildings",
  { tag: WEBKIT },
  async ({ page }, testInfo) => {
    const errors = collectPageErrors(page, { console: true });
    await page.goto("/?level=circle-wolf-den");
    await dismissExplanation(page, "Welcome, Guide");
    const ids = await page.evaluate(async () => {
      const { createProductionCards } =
        await import("/src/ui/production-card.ts");
      const { currentContentPack } = await import("/src/content/packs.ts");
      const content = currentContentPack("base");
      const root = document.createElement("section");
      root.id = "circle-portrait-review";
      Object.assign(root.style, {
        position: "fixed",
        left: "340px",
        top: "80px",
        width: "470px",
        display: "grid",
        gridTemplateColumns: "repeat(3, 1fr)",
        gap: "12px",
        padding: "16px",
        background: "#132d29",
        zIndex: "50",
      });
      document.body.append(root);
      const cards = createProductionCards(root, new AbortController().signal);
      const ids = [
        "circle-cultivator",
        "circle-sentinel",
        "circle-wayfinder",
        "circle-heartgrove",
        "circle-conservatory",
        "circle-musterhall",
      ];
      for (const id of ids) {
        const definition = content.actors.find((actor) => actor.id === id)!;
        const presentation = content.presentation[id]!;
        cards.create(
          root,
          { id: `review-${id}`, label: presentation.name },
          definition,
          {
            name: presentation.name,
            details: presentation.description,
            portrait: presentation.portrait,
          },
        );
      }
      return ids;
    });
    for (const id of ids)
      await expect(page.locator(`#review-${id} svg`)).toHaveAttribute(
        "data-portrait",
        id,
      );
    await testInfo.attach("circle-portraits", {
      body: await page
        .locator("#circle-portrait-review")
        .screenshot({ path: testInfo.outputPath("circle-portraits.png") }),
      contentType: "image/png",
    });
    expect(errors).toEqual([]);
  },
);

test(
  "Circle sites select for inspection and announce dormancy once",
  { tag: WEBKIT },
  async ({ page }) => {
    const errors = collectPageErrors(page, { console: true });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await withoutApp(page);
    await page.goto("/");
    await page.evaluate(async () => {
      const { startSidebarSession } = await import("/e2e/sidebar-session.ts");
      const { level, placeBuildings } = await import("/e2e/missions.ts");
      const { createNotifications } = await import("/src/ui/notifications.ts");
      const { controlSessionClock, prototypeTerrainMap } =
        await import("/e2e/harness.ts");
      const notifications = createNotifications(
        document.querySelector<HTMLElement>("#mission-alerts")!,
      );
      const mission = level("circle-wolf-den");
      placeBuildings(mission, [
        {
          actorId: "test-conservatory",
          definitionId: "circle-conservatory",
          origin: { x: 16, z: 50 },
        },
      ]);
      // Just above dormancy, so four workers drain it within seconds.
      mission.state.economy!.cultivation!.sites[0]!.reserve = 10500;
      const { view } = await startSidebarSession(mission, {
        onAlerts: (alerts) => {
          for (const alert of alerts) notifications.alert(alert, "");
        },
      });
      controlSessionClock(view);
      const map = prototypeTerrainMap();
      view.focus(map.tileCenter(20, 50));
    });
    await advance(page, 1);
    const canvas = page.locator("#game-canvas");
    await expect(canvas).toHaveAttribute("data-models-ready", "true");
    await pressPoint(page, await terrainPoint(page, 20, 50));
    await expect(canvas).toHaveAttribute(
      "data-selected-site",
      "near-lifebloom",
    );
    await expect(page.locator("#selection-details")).toHaveText(
      "Near Lifebloom",
    );
    await expect(page.locator("#site-reserve")).toBeVisible();
    await expect(page.locator("#selection-info")).toContainText("% efficiency");

    await page.evaluate(async () => {
      const { createActor } = await import("/src/simulation/actor.ts");
      const { prototypeTerrainMap } = await import("/e2e/harness.ts");
      const { view } = window.sessionHarness;
      const map = prototypeTerrainMap();
      for (const [index, z] of [49, 50, 51, 52].entries()) {
        const actorId = `test-cultivator-${index}`;
        view.simulation.spawnActor(
          createActor({
            id: actorId,
            owner: "player",
            definitionId: "circle-cultivator",
            worldPosition: map.tileCenter(19, z),
          }),
        );
        view.simulation.submitCommand(
          { kind: "gather", actorId, siteId: "near-lifebloom" },
          { owner: "player" },
        );
      }
    });

    const dormantAlerts = page
      .locator("#alert-history li")
      .filter({ hasText: "Near Lifebloom is dormant" });
    await expect
      .poll(async () => {
        await advance(page, 1);
        return page.locator("#selection-info").textContent();
      })
      .toContain("Recovery reopens it at 60%");
    await expect(page.locator("#selection-info")).toContainText("Dormant");
    await expect(dormantAlerts).toHaveCount(1);
    await expect
      .poll(async () => {
        await advance(page, 1);
        return page.evaluate(async () => {
          const { gameScene } = await import("/e2e/harness.ts");
          return gameScene().transformNodes.some(({ name }) =>
            name.startsWith("worker-badge-waiting-"),
          );
        });
      })
      .toBe(true);
    await advance(page, 10);
    await expect(dormantAlerts).toHaveCount(1);

    await page.evaluate(() =>
      window.sessionHarness.view.selectActor("test-cultivator-0"),
    );
    await advance(page, 0.1);
    await expect(canvas).toHaveAttribute("data-selected-site", "");
    await expect(page.locator("#site-reserve")).toBeHidden();
    await expect(page.locator("#harvester-details")).toContainText(
      "Waiting for site recovery",
    );
    expect(errors).toEqual([]);
  },
);
