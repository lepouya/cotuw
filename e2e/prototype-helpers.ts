import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

export async function terrainPoint(page: Page, x: number, z: number) {
  return page.evaluate(
    async ({ x, z }) => {
      const harnessPath: string = "/e2e/harness.ts";
      const { EngineStore, Vector3, projectToCanvas, prototypeTerrainMap } =
        await import(harnessPath);
      const map = prototypeTerrainMap();
      const point = map.tileCenter(x, z);
      const scene = EngineStore.Instances[0].scenes[0];
      const canvas = document.querySelector<HTMLCanvasElement>("#game-canvas")!;
      return projectToCanvas(
        scene,
        canvas,
        new Vector3(
          point.x,
          map.heightAtWorldPosition(point.x, point.z),
          point.z,
        ),
      );
    },
    { x, z },
  );
}

export async function placeBuilding(
  page: Page,
  buttonId: string,
  x: number,
  z: number,
) {
  const canvas = page.locator("#game-canvas");
  const count = Number(
    await canvas.getAttribute("data-tile-placed-actor-count"),
  );
  await page.locator("#tab-buildings").click();
  await page.locator(`#${buttonId}`).click();
  const point = await terrainPoint(page, x, z);
  await page.mouse.move(point.x, point.y);
  await expect(page.locator("#game-canvas")).toHaveAttribute(
    "data-placement-status",
    "valid",
  );
  await page.mouse.click(point.x, point.y);
  await expect(page.locator("#game-canvas")).toHaveAttribute(
    "data-placement-active",
    "false",
  );
  await expect(canvas).toHaveAttribute(
    "data-tile-placed-actor-count",
    String(count + 1),
  );
}

export async function trainTestUnits(page: Page, units = ["trooper", "scout"]) {
  await expect(page.locator("#game-canvas")).toHaveAttribute(
    "data-terrain-ready",
    "true",
  );
  await placeBuilding(page, "build-barracks", 49, 39);
  await page.locator("#tab-units").click();
  for (const [index, unit] of units.entries()) {
    const button = page.locator(`#train-${unit}`);
    await expect(button).toBeEnabled();
    await button.click();
    await expect(page.locator("#unit-roster button")).toHaveCount(index + 1);
    await expect
      .poll(() =>
        page.evaluate(async (id) => {
          const path: string = "/e2e/harness.ts";
          const { EngineStore } = await import(path);
          return !!EngineStore.Instances[0].scenes[0].getTransformNodeByName(
            `actor-trained-unit-${id}-root`,
          );
        }, index + 1),
      )
      .toBe(true);
  }
}
