import { expect, test } from "@playwright/test";
import { terrainPoint } from "./prototype-helpers";
import { WEBKIT } from "./tags";

test(
  "restart clears asset readiness and finishes after a failed BRDF load",
  { tag: WEBKIT },
  async ({ page }) => {
    await page.goto("/?level=sandbox");
    const canvas = page.locator("#game-canvas");
    await expect(canvas).toHaveAttribute("data-models-ready", "true", {
      timeout: 15_000,
    });
    await page.evaluate(async () => {
      const path: string = "/e2e/harness.ts";
      const { EngineStore } = (await import(
        path
      )) as typeof import("./harness");
      const texture =
        EngineStore.Instances[0].scenes[0].environmentBRDFTexture!;
      Object.defineProperty(texture, "loadingError", { get: () => true });
      texture.isReady = () => false;
    });
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/assets/models/command-center.glb", async (route) => {
      await held;
      await route.continue();
    });
    try {
      await page.locator("#open-menu").click();
      await page.locator("#restart-mission").click();
      await expect(page.locator("#game-menu")).not.toBeVisible();
      await expect(canvas).not.toHaveAttribute("data-models-ready", "true");
      release();
      await expect(canvas).toHaveAttribute("data-models-ready", "true", {
        timeout: 15_000,
      });
    } finally {
      release();
    }
  },
);

test("an active building preview refreshes when its generated model loads", async ({
  page,
}) => {
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/assets/models/command-center.glb", async (route) => {
    await held;
    await route.continue();
  });
  try {
    await page.goto("/?level=sandbox", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#game-canvas")).toHaveAttribute(
      "data-actor-ready",
      "true",
    );
    await page.locator("#build-command-center").click();
    const point = await terrainPoint(page, 55, 39);
    await page.mouse.move(point.x, point.y);
    await expect(page.locator("#game-canvas")).toHaveAttribute(
      "data-placement-status",
      "valid",
    );
    const hasModel = () =>
      page.evaluate(async () => {
        const path: string = "/e2e/harness.ts";
        const { EngineStore } = (await import(
          path
        )) as typeof import("./harness");
        return EngineStore.Instances[0].scenes[0]
          .getTransformNodeByName("tile-placed-actor-building-preview-root")!
          .getChildMeshes()
          .some((mesh) => mesh.name.endsWith("-command-cabin"));
      });
    expect(await hasModel()).toBe(false);
    release();
    await expect.poll(hasModel).toBe(true);
  } finally {
    release();
  }
});

test(
  "generated models render with their exported clips",
  { tag: WEBKIT },
  async ({ page }, testInfo) => {
    await page.goto("/?level=sandbox");
    await expect(page.locator("#game-canvas")).toHaveAttribute(
      "data-models-ready",
      "true",
    );
    const result = await page.evaluate(async () => {
      const harnessPath: string = "/e2e/harness.ts";
      const actorPath: string = "/src/render/skinned-actor-appearance.ts";
      const propPath: string = "/src/render/glb-model.ts";
      const { createTestView, currentContentPack, frames } = (await import(
        harnessPath
      )) as typeof import("./harness");
      const { loadSkinnedActorAppearance } = (await import(
        actorPath
      )) as typeof import("../src/render/skinned-actor-appearance");
      const { loadModelAsset } = (await import(
        propPath
      )) as typeof import("../src/render/glb-model");
      const { scene, canvas, camera } = createTestView({
        map: { width: 20, height: 12, tileSize: 1, createHeight: () => 0 },
        size: { width: 1000, height: 600 },
      });
      canvas.id = "generated-models";
      Object.assign(canvas.style, {
        position: "fixed",
        top: "0",
        left: "0",
        zIndex: "50",
      });
      camera.orthoLeft = -10;
      camera.orthoRight = 10;
      camera.orthoTop = 6;
      camera.orthoBottom = -6;
      const pack = currentContentPack("base");
      for (const [index, id] of [
        "arc-trooper",
        "arc-scout",
        "wolf",
        "alpha-wolf",
        "arc-harvester",
      ].entries()) {
        const model = pack.presentation[id]!.model!;
        if (!("glb" in model)) throw new Error("Expected a generated model");
        const appearance = await loadSkinnedActorAppearance(scene, model.glb);
        const actor = appearance.instantiate(id, 0);
        actor.root.position.set(-6 + index * 3, 0, 2);
        actor.setAnimationState?.({ working: true });
        actor.animate?.({ seconds: 0.1, distance: 0.15, turn: 0 });
        actor.play?.("attack");
      }
      for (const [index, id] of [
        "arc-command-center-prototype",
        "arc-field-barracks",
        "arc-materials-refinery",
      ].entries()) {
        const asset = await loadModelAsset(
          scene,
          pack.presentation[id]!.building!.glb!,
        );
        const model = asset.instantiate(id);
        model.root.position.set(-5 + index * 5, 0, -2);
        model.pose(1);
      }
      for (const [index, id] of (
        ["materials-mound", "salvage"] as const
      ).entries()) {
        const asset = await loadModelAsset(scene, pack.props![id]!);
        const model = asset.instantiate(id);
        model.root.position.set(-1 + index * 3, 0.8, 5);
        model.pose(1);
      }
      await frames(3);
      return {
        skins: scene.meshes.filter((mesh) => mesh.skeleton).length,
        meshes: scene.meshes.filter(
          (mesh) => mesh.getTotalVertices() > 0 && mesh.isEnabled(),
        ).length,
      };
    });
    expect(result.skins).toBeGreaterThanOrEqual(7);
    expect(result.meshes).toBeGreaterThan(30);
    await testInfo.attach("generated-models", {
      body: await page.locator("#generated-models").screenshot(),
      contentType: "image/png",
    });
  },
);
