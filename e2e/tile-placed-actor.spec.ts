import { terrainPoint, placeBuilding } from "./prototype-helpers";
import { expect, test } from "@playwright/test";
import { TOUCH_PROFILES } from "./profiles";

import type { Page } from "@playwright/test";
import type { AbstractMesh, TransformNode } from "@babylonjs/core";

async function ready(page: Page) {
  await page.goto("/?level=sandbox");
  await expect(page.locator("#game-canvas")).toHaveAttribute(
    "data-models-ready",
    "true",
    { timeout: 15_000 },
  );
}

async function buildingPreview(page: Page) {
  return page.evaluate(async () => {
    const path: string = "/e2e/harness.ts";
    const { EngineStore } = await import(path);
    const scene = EngineStore.Instances[0].scenes[0];
    const root = scene.getTransformNodeByName(
      "tile-placed-actor-building-preview-root",
    );
    if (!root) return null;
    const assembly = scene.getTransformNodeByName(`${root.name}-model`)!;
    const canopy = root
      .getChildMeshes()
      .find((mesh: AbstractMesh) => mesh.name.endsWith("-entry-canopy"))!;
    canopy.computeWorldMatrix(true);
    return {
      facing: assembly.rotation.y,
      transparent: root
        .getChildMeshes()
        .filter((mesh: AbstractMesh) => mesh.getTotalVertices() > 0)
        .every((mesh: AbstractMesh) => {
          if (mesh.visibility !== 0.42)
            throw new Error(`${mesh.name}: visibility ${mesh.visibility}`);
          return true;
        }),
      pickable: root
        .getChildMeshes()
        .some((mesh: AbstractMesh) => mesh.isPickable),
      entranceOffset: canopy
        .getAbsolutePosition()
        .subtract(assembly.getAbsolutePosition())
        .asArray(),
    };
  });
}

test("previews, rotates, places, selects, and removes a Command Center", async ({
  page,
}) => {
  await ready(page);
  const canvas = page.locator("#game-canvas");
  await expect(canvas).toHaveAttribute("data-tile-placed-actor-count", "0");
  await page.locator("#build-command-center").click();
  const point = await terrainPoint(page, 55, 39);
  await page.mouse.move(point.x, point.y);
  await expect(canvas).toHaveAttribute("data-placement-status", "valid");
  await expect(canvas).toHaveAttribute("data-tile-placed-actor-count", "0");
  expect(await buildingPreview(page)).toMatchObject({
    facing: 0,
    transparent: true,
    pickable: false,
  });
  expect((await buildingPreview(page))!.entranceOffset[2]).toBeCloseTo(0.68);
  await page.locator("#rotate-building").click();
  await expect(canvas).toHaveAttribute("data-placement-rotation", "1");
  expect(await buildingPreview(page)).toMatchObject({
    facing: Math.PI / 2,
    transparent: true,
    pickable: false,
  });
  expect((await buildingPreview(page))!.entranceOffset[0]).toBeCloseTo(0.68);
  await page.mouse.click(point.x, point.y);
  await expect(canvas).toHaveAttribute("data-tile-placed-actor-count", "1");
  await expect(canvas).toHaveAttribute("data-placement-active", "false");
  expect(await buildingPreview(page)).toBeNull();
  await expect(canvas).toHaveAttribute(
    "data-selected-actor",
    "arc-command-center-prototype-1",
  );
  await expect(page.locator("#selection-details")).toHaveText(
    "Command Center · 2 × 2 · 90°",
  );
  expect(
    await page.evaluate(async () => {
      const path: string = "/e2e/harness.ts";
      const { EngineStore } = await import(path);
      const scene = EngineStore.Instances[0].scenes[0];
      const root = scene.getTransformNodeByName(
        "tile-placed-actor-arc-command-center-prototype-1-root",
      )!;
      const assembly = scene.getTransformNodeByName(`${root.name}-model`)!;
      return {
        tiles: root
          .getChildMeshes()
          .filter(
            (mesh: AbstractMesh) =>
              mesh.name.includes("-tile-") && mesh.getTotalVertices() > 0,
          ).length,
        detailCount: root.getChildMeshes().length,
        facing: assembly.rotation.y,
        selected: !!scene.getMeshByName("building-selection-outline"),
        preview: !!scene.getMeshByName("building-placement-outline"),
      };
    }),
  ).toMatchObject({
    tiles: 4,
    facing: Math.PI / 2,
    selected: true,
    preview: false,
  });
  await page.locator("#remove-building").click();
  await expect(canvas).toHaveAttribute("data-tile-placed-actor-count", "0");
  await expect(canvas).toHaveAttribute("data-selected-actor", "");
  await expect(page.locator("#remove-building")).toBeDisabled();
});

test("rejects occupied terrain and units without changing the world, and cancels cleanly", async ({
  page,
}) => {
  await ready(page);
  const canvas = page.locator("#game-canvas");
  await placeBuilding(page, "build-command-center", 49, 39);
  await placeBuilding(page, "build-barracks", 45, 39);
  await page.locator("#tab-units").click();
  await page.locator("#train-trooper").click();
  await expect(page.locator("#unit-roster button")).toHaveCount(1);
  await page.locator("#tab-buildings").click();
  await page.locator("#build-command-center").click();
  const occupied = await terrainPoint(page, 49, 39);
  await page.mouse.move(occupied.x, occupied.y);
  await expect(canvas).toHaveAttribute(
    "data-placement-status",
    "occupancy-conflict",
  );
  await expect(page.locator("#confirm-building")).toBeDisabled();
  await page.mouse.click(occupied.x, occupied.y);
  await expect(canvas).toHaveAttribute("data-tile-placed-actor-count", "2");
  const unitTile = await page.evaluate(async () => {
    const path: string = "/e2e/harness.ts";
    const { EngineStore, prototypeTerrainMap } = await import(path);
    const point = EngineStore.Instances[0].scenes[0]
      .getTransformNodeByName("actor-trained-unit-1-root")!
      .getAbsolutePosition();
    return prototypeTerrainMap().tileAtWorldPosition(point.x, point.z);
  });
  const unit = await terrainPoint(page, unitTile.x, unitTile.z);
  await page.mouse.move(unit.x, unit.y);
  await expect(canvas).toHaveAttribute(
    "data-placement-status",
    "actor-conflict",
  );
  await page.mouse.click(unit.x, unit.y);
  await expect(canvas).toHaveAttribute("data-selected-actor", "");
  await page.keyboard.press("Escape");
  await expect(canvas).toHaveAttribute("data-placement-active", "false");
  await expect(page.locator("#build-command-center")).toBeEnabled();
  expect(await buildingPreview(page)).toBeNull();
  expect(
    await page.evaluate(async () => {
      const path: string = "/e2e/harness.ts";
      const { EngineStore } = await import(path);
      return !!EngineStore.Instances[0].scenes[0].getMeshByName(
        "building-placement-outline",
      );
    }),
  ).toBe(false);
});

test("selects a constructed building and freezes idle equipment when disabled", async ({
  page,
}) => {
  await ready(page);
  await placeBuilding(page, "build-command-center", 49, 39);

  const point = await page.evaluate(async () => {
    const path: string = "/e2e/harness.ts";
    const { EngineStore, projectToCanvas } = await import(path);
    const engine = EngineStore.Instances[0];
    const scene = engine.scenes[0];
    const mesh = scene
      .getTransformNodeByName(
        "tile-placed-actor-arc-command-center-prototype-1-root",
      )!
      .getChildMeshes()
      .find((mesh: AbstractMesh) => mesh.name.endsWith("-command-cabin"))!;
    mesh.computeWorldMatrix(true);
    const canvas = document.querySelector<HTMLCanvasElement>("#game-canvas")!;
    return projectToCanvas(scene, canvas, mesh.getAbsolutePosition());
  });
  await page.mouse.click(point.x, point.y);
  await page.mouse.click(point.x, point.y);
  await expect(page.locator("#game-canvas")).toHaveAttribute(
    "data-selected-actor",
    "arc-command-center-prototype-1",
  );
  await page.locator("#tab-buildings").click();
  await page.locator("#tab-goals").click();
  await page.locator("#animate-building").uncheck();
  const angle = () =>
    page.evaluate(async () => {
      const path: string = "/e2e/harness.ts";
      const { EngineStore } = await import(path);
      return EngineStore.Instances[0].scenes[0]
        .getTransformNodeByName(
          "tile-placed-actor-arc-command-center-prototype-1-root",
        )!
        .getChildTransformNodes()
        .find((node: TransformNode) => node.name.endsWith("-radar"))!
        .rotationQuaternion!.asArray();
    });
  const frozen = await angle();
  await page.waitForTimeout(150);
  expect(await angle()).toEqual(frozen);
  await page.locator("#animate-building").check();
  await expect.poll(angle).not.toEqual(frozen);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator("#animate-building")).toBeDisabled();
  await page.waitForTimeout(100);
  const reduced = await angle();
  await page.waitForTimeout(150);
  expect(await angle()).toEqual(reduced);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(page.locator("#animate-building")).toBeEnabled();
  await expect.poll(angle).not.toEqual(reduced);
});

for (const profile of TOUCH_PROFILES)
  test(`${profile.name} touch previews before explicit confirmation`, async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: profile.viewport,
      hasTouch: true,
    });
    const page = await context.newPage();
    try {
      await ready(page);
      await page.locator("#build-command-center").tap();
      const point = await terrainPoint(page, 55, 39);
      await page.touchscreen.tap(point.x, point.y);
      const canvas = page.locator("#game-canvas");
      await expect(canvas).toHaveAttribute("data-placement-status", "valid");
      await expect(canvas).toHaveAttribute("data-tile-placed-actor-count", "0");
      await page.locator("#rotate-building").tap();
      await page.locator("#confirm-building").tap();
      await expect(canvas).toHaveAttribute("data-tile-placed-actor-count", "1");
    } finally {
      await context.close();
    }
  });

test("previews reject water, cliffs, and the playable-map boundary", async ({
  page,
}) => {
  await ready(page);
  await page.locator("#build-command-center").click();
  for (const { x, z, reason } of [
    { x: 42, z: 58, reason: "disallowed-terrain" },
    { x: 65, z: 20, reason: "excessive-slope" },
    { x: 2, z: 5, reason: "out-of-bounds" },
  ]) {
    await page.evaluate(
      async ({ x, z }) => {
        const harnessPath: string = "/e2e/harness.ts";
        const { EngineStore, Vector3, frames, prototypeTerrainMap } =
          await import(harnessPath);
        const map = prototypeTerrainMap();
        const point = map.tileCenter(x, z);
        const scene = EngineStore.Instances[0].scenes[0];
        // View the cliff from its exposed side.
        const camera =
          scene.activeCamera as import("@babylonjs/core").ArcRotateCamera;
        camera.alpha = -Math.PI / 4;
        camera.setTarget(
          new Vector3(
            point.x,
            map.heightAtWorldPosition(point.x, point.z),
            point.z,
          ),
          false,
          false,
          true,
        );
        await frames(2);
      },
      { x, z },
    );
    const point = await terrainPoint(page, x, z);
    await page.mouse.move(point.x, point.y);
    await expect(page.locator("#game-canvas")).toHaveAttribute(
      "data-placement-status",
      reason,
    );
    await expect(page.locator("#confirm-building")).toBeDisabled();
    expect(await buildingPreview(page)).toMatchObject({
      transparent: true,
      pickable: false,
    });
    await page.mouse.click(point.x, point.y);
    await expect(page.locator("#game-canvas")).toHaveAttribute(
      "data-tile-placed-actor-count",
      "0",
    );
  }
  await page.locator("#cancel-building").click();
  await expect(page.locator("#game-canvas")).toHaveAttribute(
    "data-placement-active",
    "false",
  );
});
