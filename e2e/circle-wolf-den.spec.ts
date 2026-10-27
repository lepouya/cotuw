import { expect, test } from "./fixtures";
import {
  activate,
  collectPageErrors,
  dismissExplanation,
  terrainPoint,
  placeBuilding,
} from "./prototype-helpers";
import { forEachProfile, MOUSE_AND_PHONE_PROFILES } from "./profiles";
import { WEBKIT } from "./tags";
import { MissionDriver } from "./mission-driver";

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
      const mission = new MissionDriver(page, touch, true);
      await mission.opening(false, "circle");
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
      if (touch) await page.touchscreen.tap(heart.x, heart.y);
      else await page.mouse.click(heart.x, heart.y);
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
      await placeBuilding(
        page,
        "build-circle-conservatory",
        16,
        50,
        "Tending growth",
        touch,
      );
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
      await testInfo.attach(`circle-cultivation-${name}`, {
        body: await page.screenshot(),
        contentType: "image/png",
      });
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

test(
  "Circle silhouettes and living focus bolts render together",
  { tag: WEBKIT },
  async ({ page }, testInfo) => {
    const errors = collectPageErrors(page, { console: true });
    await page.goto("/?level=circle-wolf-den");
    await dismissExplanation(page, "Welcome, Guide");
    const result = await page.evaluate(async () => {
      const harnessPath: string = "/e2e/harness.ts";
      const actorPath: string = "/src/render/skinned-actor-appearance.ts";
      const modelPath: string = "/src/render/glb-model.ts";
      const effectPath: string = "/src/render/combat-effects.ts";
      const { createTestView, currentContentPack, frames, Vector3 } =
        (await import(harnessPath)) as typeof import("./harness");
      const { loadSkinnedActorAppearance } = (await import(
        actorPath
      )) as typeof import("../src/render/skinned-actor-appearance");
      const { loadModelAsset } = (await import(
        modelPath
      )) as typeof import("../src/render/glb-model");
      const { createCombatEffectsView } = (await import(
        effectPath
      )) as typeof import("../src/render/combat-effects");
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
        { from: { x: -1.3, z: 0.6 }, to: { x: 0.7, z: 2.7 } } as any,
        "bolt",
      );
      effects.update(0.08);
      await frames(3);
      const strands = view.scene.meshes.filter(({ name }) =>
        name.includes("living-strand"),
      );
      const normal = strands[0]!.scaling.x;
      reduced = true;
      effects.update(0.01);
      await frames(2);
      const held = strands[0]!.scaling.x;
      effects.update(0.01);
      await frames(2);
      const stable = strands[0]!.scaling.x === held;
      Reflect.set(window, "expireCircleShowcase", () => {
        effects.update(1);
        return strands.every((strand) => strand.isDisposed());
      });
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
    expect(
      await page.evaluate(() => {
        return Reflect.get(window, "expireCircleShowcase")();
      }),
    ).toBe(true);
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
      const cardsPath: string = "/src/ui/production-card.ts";
      const contentPath: string = "/src/content/packs.ts";
      const { createProductionCards } = (await import(
        cardsPath
      )) as typeof import("../src/ui/production-card");
      const { currentContentPack } = (await import(
        contentPath
      )) as typeof import("../src/content/packs");
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
