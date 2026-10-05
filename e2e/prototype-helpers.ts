import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

/** Uses the same input modality throughout a browser flow. */
export async function activate(locator: Locator, touch = false) {
  if (touch) await locator.tap();
  else await locator.click();
}

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

/** Checks a scenario popup's title, then dismisses it. */
export async function dismissExplanation(
  page: Page,
  title: string,
  touch = false,
) {
  await expect(page.locator("#explanation-title")).toHaveText(title);
  await activate(page.locator("#dismiss-explanation"), touch);
  await expect(page.locator("#explanation")).toBeHidden();
}

export async function placeBuilding(
  page: Page,
  buttonId: string,
  x: number,
  z: number,
  /** The popup title that starting this placement shows. */
  explanation?: string,
  touch = false,
) {
  const canvas = page.locator("#game-canvas");
  const count = Number(
    await canvas.getAttribute("data-tile-placed-actor-count"),
  );
  await activate(page.locator("#tab-buildings"), touch);
  await activate(page.locator(`#${buttonId}`), touch);
  if (explanation) await dismissExplanation(page, explanation, touch);
  const point = await terrainPoint(page, x, z);
  if (touch) await page.touchscreen.tap(point.x, point.y);
  else await page.mouse.move(point.x, point.y);
  await expect(page.locator("#game-canvas")).toHaveAttribute(
    "data-placement-status",
    "valid",
  );
  if (touch) await page.locator("#confirm-building").tap();
  else await page.mouse.click(point.x, point.y);
  await expect(page.locator("#game-canvas")).toHaveAttribute(
    "data-placement-active",
    "false",
  );
  await expect(canvas).toHaveAttribute(
    "data-tile-placed-actor-count",
    String(count + 1),
  );
}

export async function trainTestUnits(
  page: Page,
  units = ["trooper", "scout"],
  touch = false,
) {
  await expect(page.locator("#game-canvas")).toHaveAttribute(
    "data-terrain-ready",
    "true",
  );
  await placeBuilding(page, "build-barracks", 49, 39, undefined, touch);
  await activate(page.locator("#tab-units"), touch);
  for (const [index, unit] of units.entries()) {
    const button = page.locator(`#train-${unit}`);
    await expect(button).toBeEnabled();
    await activate(button, touch);
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

/** Imports a mission file through the game menu's Load panel. */
export async function importMission(
  page: Page,
  source: string,
  name = "mission.json",
  touch = false,
) {
  if (!(await page.locator("#game-menu").isVisible()))
    await activate(page.locator("#open-menu"), touch);
  if (await page.locator("#load-panel").isHidden())
    await activate(page.locator("#load-mission"), touch);
  const chooser = page.waitForEvent("filechooser");
  await activate(page.locator("#import-mission"), touch);
  await (
    await chooser
  ).setFiles({
    name,
    mimeType: "application/json",
    buffer: Buffer.from(source),
  });
}
