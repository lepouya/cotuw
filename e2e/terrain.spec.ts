import { expect, test } from "@playwright/test";
import { PNG } from "pngjs";

test("the initial terrain view fills the viewport without clipping", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  const canvas = page.locator("#game-canvas");

  await expect(canvas).toHaveAttribute("data-terrain-ready", "true");
  const screenshot = await canvas.screenshot();
  await testInfo.attach("initial-terrain", {
    body: screenshot,
    contentType: "image/png",
  });

  const image = PNG.sync.read(screenshot);
  const bounds = findTerrainBounds(image);

  expect(bounds.left).toBeGreaterThan(20);
  expect(bounds.right).toBeLessThan(bounds.width - 20);
  expect(bounds.top).toBeGreaterThan(20);
  expect(bounds.bottom).toBeGreaterThan(bounds.height * 0.84);
  expect(bounds.bottom).toBeLessThan(bounds.height - 20);
});

test("a close, low-angle view keeps foreground terrain visible", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  const canvas = page.locator("#game-canvas");

  await expect(canvas).toHaveAttribute("data-terrain-ready", "true");
  await page.mouse.move(640, 360);
  await page.mouse.down();
  await page.mouse.move(640, 40, { steps: 12 });
  await page.mouse.up();
  await page.mouse.wheel(0, -1600);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  );

  const screenshot = await canvas.screenshot();
  await testInfo.attach("low-angle-terrain", {
    body: screenshot,
    contentType: "image/png",
  });

  const bounds = findTerrainBounds(PNG.sync.read(screenshot));
  expect(bounds.bottom).toBeGreaterThan(bounds.height * 0.82);
});

test("resizing re-fits the terrain without clipping its sides", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  const canvas = page.locator("#game-canvas");

  await expect(canvas).toHaveAttribute("data-terrain-ready", "true");
  await page.setViewportSize({ width: 720, height: 1_080 });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );

  const screenshot = await canvas.screenshot();
  await testInfo.attach("resized-terrain", {
    body: screenshot,
    contentType: "image/png",
  });

  const bounds = findTerrainBounds(PNG.sync.read(screenshot));
  expect(bounds.left).toBeGreaterThan(20);
  expect(bounds.right).toBeLessThan(bounds.width - 20);
});

test("a batched terrain edit refreshes Babylon geometry", async ({ page }) => {
  await page.goto("/");

  const heights = await page.evaluate(async () => {
    const sourceRoot: string = "/src";
    const { TerrainMap } = await import(`${sourceRoot}/map.ts`);
    const { createTerrainPrototype } = await import(
      `${sourceRoot}/prototype.ts`
    );
    const canvas = document.createElement("canvas");
    canvas.style.width = "240px";
    canvas.style.height = "240px";
    document.body.append(canvas);

    const map = new TerrainMap(1, 1, 1, () => 0);
    map.addTileLayer(0, 0, { tint: [0.2, 0.4, 0.3], alpha: 1 });
    const view = createTerrainPrototype(canvas, map);
    const mesh = () => view.scene.getMeshByName("terrain-layer-0-color");
    const before = mesh()?.getVerticesData("position")?.[1];

    map.edit(
      (terrain: {
        setCorner: (x: number, z: number, height: number) => void;
      }) => terrain.setCorner(0, 0, 7),
    );
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    const after = mesh()?.getVerticesData("position")?.[1];

    view.dispose();
    canvas.remove();
    return { before, after };
  });

  expect(heights.before).toBe(0);
  expect(heights.after).toBe(7);
});

function findTerrainBounds(image: PNG): {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
} {
  let left = image.width;
  let right = 0;
  let top = image.height;
  let bottom = 0;

  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const pixel = (y * image.width + x) * 4;
      const red = image.data[pixel];
      const green = image.data[pixel + 1];
      const blue = image.data[pixel + 2];
      const isTerrain =
        (green > blue + 6 && green > 25) ||
        (red > 100 && green > 80 && blue < 100);

      if (isTerrain) {
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }
  }

  return { left, right, top, bottom, width: image.width, height: image.height };
}
