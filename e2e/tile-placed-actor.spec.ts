import { terrainPoint, placeBuilding } from "./prototype-helpers";
import { expect, test } from "@playwright/test";

import type { Page } from "@playwright/test";
import type { AbstractMesh } from "@babylonjs/core";

async function ready(page: Page) {
  await page.goto("/");
  await expect(page.locator("#game-canvas")).toHaveAttribute(
    "data-tile-placed-actor-ready",
    "true",
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
    const assembly = scene.getTransformNodeByName(`${root.name}-assembly`)!;
    const canopy = scene.getMeshByName(`${root.name}-entry-canopy`)!;
    canopy.computeWorldMatrix(true);
    return {
      facing: assembly.rotation.y,
      transparent: root
        .getChildMeshes()
        .every((mesh: AbstractMesh) => mesh.material?.alpha === 0.42),
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
      const assembly = scene.getTransformNodeByName(`${root.name}-assembly`)!;
      return {
        tiles: root
          .getChildMeshes()
          .filter(({ name }: { name: string }) => name.includes("-tile-"))
          .length,
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
    const prototypePath: string = "/src/prototype.ts";
    const { EngineStore } = await import(path);
    const { createPrototypeMap } = await import(prototypePath);
    const point = EngineStore.Instances[0].scenes[0]
      .getTransformNodeByName("actor-trained-unit-1-root")!
      .getAbsolutePosition();
    return createPrototypeMap().tileAtWorldPosition(point.x, point.z);
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
    const mesh = scene.getMeshByName(
      "tile-placed-actor-arc-command-center-prototype-1-root-command-cabin",
    )!;
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
  await page.locator("#animate-building").uncheck();
  const angle = () =>
    page.evaluate(async () => {
      const path: string = "/e2e/harness.ts";
      const { EngineStore } = await import(path);
      return EngineStore.Instances[0].scenes[0].getTransformNodeByName(
        "tile-placed-actor-arc-command-center-prototype-1-root-radar",
      )!.rotation.y;
    });
  const frozen = await angle();
  await page.waitForTimeout(150);
  expect(await angle()).toBe(frozen);
  await page.locator("#animate-building").check();
  await expect.poll(angle).toBeGreaterThan(frozen);
});

test("touch previews before explicit confirmation in compact landscape", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 844, height: 390 },
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
        const prototypePath: string = "/src/prototype.ts";
        const { EngineStore, Vector3, frames } = await import(harnessPath);
        const { createPrototypeMap } = await import(prototypePath);
        const map = createPrototypeMap();
        const point = map.tileCenter(x, z);
        const scene = EngineStore.Instances[0].scenes[0];
        scene.activeCamera!.setTarget(
          new Vector3(
            point.x,
            map.heightAtWorldPosition(point.x, point.z),
            point.z,
          ),
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
