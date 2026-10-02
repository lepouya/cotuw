import { expect, test } from "@playwright/test";
import { PNG } from "pngjs";

import type { Page } from "@playwright/test";

/** Summed channel distance that separates terrain from antialiased clear color. */
const CLEAR_COLOR_TOLERANCE = 40;

/** In-page test helpers, loaded by `openHarness`. */
declare const harness: typeof import("./harness");

async function openHarness(page: Page): Promise<void> {
  await page.goto("/");
  await page.evaluate(async () => {
    const harnessPath: string = "/e2e/harness.ts";
    Object.assign(window, { harness: await import(harnessPath) });
  });
}

test("the initial view starts close enough to read tile detail", async ({
  page,
}, testInfo) => {
  await openHarness(page);
  const canvas = page.locator("#game-canvas");

  await expect(canvas).toHaveAttribute("data-terrain-ready", "true");
  await expect(canvas).toHaveAttribute("data-actor-ready", "true");
  const screenshot = await canvas.screenshot({
    style: ".camera-controls { visibility: hidden; }",
  });
  await testInfo.attach("initial-terrain", {
    body: screenshot,
    contentType: "image/png",
  });

  const bounds = findTerrainBounds(
    PNG.sync.read(screenshot),
    await page.evaluate(() => harness.clearColorBytes()),
  );

  expect(bounds.left).toBeLessThan(5);
  expect(bounds.right).toBeGreaterThan(bounds.width - 5);
  expect(bounds.top).toBeLessThan(5);
  expect(bounds.bottom).toBeGreaterThan(bounds.height - 5);
});

test("zooming out from the start reveals the whole map", async ({
  page,
}, testInfo) => {
  await openHarness(page);
  const canvas = page.locator("#game-canvas");

  await expect(canvas).toHaveAttribute("data-terrain-ready", "true");
  await page.mouse.move(640, 360);
  await page.mouse.wheel(0, 6_000);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  );

  const screenshot = await canvas.screenshot({
    style: ".camera-controls { visibility: hidden; }",
  });
  await testInfo.attach("zoomed-out-terrain", {
    body: screenshot,
    contentType: "image/png",
  });

  const bounds = findTerrainBounds(
    PNG.sync.read(screenshot),
    await page.evaluate(() => harness.clearColorBytes()),
  );

  expect(bounds.left).toBeGreaterThan(20);
  expect(bounds.right).toBeLessThan(bounds.width - 20);
  expect(bounds.top).toBeGreaterThan(20);
  expect(bounds.bottom).toBeLessThan(bounds.height - 20);
});

test("zoom limits span a handful of tiles to the whole map", async ({
  page,
}) => {
  await openHarness(page);

  const zoom = await page.evaluate(() => {
    const { createTestView, viewHeight, wheel } = harness;
    const { canvas, camera, dispose } = createTestView();

    const initial = viewHeight(camera);
    wheel(canvas, -10_000);
    const closest = viewHeight(camera);
    wheel(canvas, 20_000);
    const furthest = viewHeight(camera);

    dispose();
    return { initial, closest, furthest };
  });

  expect(zoom.initial).toBeCloseTo(24);
  expect(zoom.closest).toBeCloseTo(2);
  // Far enough out for the whole 100 tile map, without a sea of empty space.
  expect(zoom.furthest).toBeGreaterThan(100);
  expect(zoom.furthest).toBeLessThan(140);
});

test("wheel zoom normalizes line and page deltas to pixels", async ({
  page,
}) => {
  await openHarness(page);

  const zooms = await page.evaluate(() => {
    const { createTestView, viewHeight, wheel } = harness;
    const { canvas, camera, dispose } = createTestView();
    /** How much one wheel event scales the visible height. */
    const zoomFactor = (deltaY: number, deltaMode: number) => {
      const before = viewHeight(camera);
      wheel(canvas, deltaY, deltaMode);
      return viewHeight(camera) / before;
    };

    const zooms = {
      pixels: zoomFactor(-160, WheelEvent.DOM_DELTA_PIXEL),
      lines: zoomFactor(-10, WheelEvent.DOM_DELTA_LINE),
      pages: zoomFactor(-0.2, WheelEvent.DOM_DELTA_PAGE),
    };

    dispose();
    return zooms;
  });

  const zoomFor = (pixels: number) => Math.exp(-pixels * 0.0015);
  expect(zooms.pixels).toBeCloseTo(zoomFor(160));
  // Ten lines are 16 px each, so they match the 160 px step exactly.
  expect(zooms.lines).toBeCloseTo(zoomFor(160));
  // A fifth of the 720 px viewport height is 144 px.
  expect(zooms.pages).toBeCloseTo(zoomFor(144));
});

test("dragging carries the ground with the pointer at every zoom", async ({
  page,
}) => {
  await openHarness(page);

  const drags = await page.evaluate(async () => {
    const { createTestView, frames, pointer, viewHeight, wheel } = harness;
    const { canvas, camera, dispose } = createTestView();
    /** World units the ground travels per dragged pixel. */
    const measureDrag = async (zoomDelta: number) => {
      wheel(canvas, zoomDelta);
      await frames(1);
      const { x, z } = camera.target;
      const worldPerPixel = viewHeight(camera) / canvas.clientHeight;

      pointer(canvas, "pointerdown", { button: 2, x: 500, y: 360 });
      pointer(canvas, "pointermove", { button: 2, x: 700, y: 360 });
      pointer(canvas, "pointerup", { button: 2, x: 700, y: 360 });
      await frames(2);
      const moved = Math.hypot(camera.target.x - x, camera.target.z - z);
      return moved / 200 / worldPerPixel;
    };

    const close = await measureDrag(-10_000);
    const far = await measureDrag(20_000);
    dispose();
    return { close, far };
  });

  expect(drags.close).toBeCloseTo(1, 2);
  expect(drags.far).toBeCloseTo(1, 2);
});

test("primary drag leaves the camera fixed, secondary pans, and Shift-secondary rotates", async ({
  page,
}) => {
  await openHarness(page);

  const drags = await page.evaluate(async () => {
    const { createTestView, frames, pointer } = harness;
    const { canvas, camera, dispose } = createTestView();
    const drag = async (button: number, shift = false) => {
      const before = {
        alpha: camera.alpha,
        beta: camera.beta,
        x: camera.target.x,
        z: camera.target.z,
      };
      pointer(canvas, "pointerdown", { button, shift, x: 500, y: 360 });
      pointer(canvas, "pointermove", { button, shift, x: 620, y: 300 });
      pointer(canvas, "pointerup", { button, shift, x: 620, y: 300 });
      await frames(2);
      return {
        swung:
          Math.abs(camera.alpha - before.alpha) +
          Math.abs(camera.beta - before.beta),
        panned: Math.hypot(
          camera.target.x - before.x,
          camera.target.z - before.z,
        ),
      };
    };

    const left = await drag(0);
    const right = await drag(2);
    const rotate = await drag(2, true);
    dispose();
    return { left, right, rotate };
  });

  expect(drags.left.panned).toBe(0);
  expect(drags.left.swung).toBe(0);
  expect(drags.right.swung).toBe(0);
  expect(drags.right.panned).toBeGreaterThan(0);
  expect(drags.rotate.swung).toBeGreaterThan(0);
  expect(drags.rotate.panned).toBe(0);
});

test("a close, low-angle view keeps foreground terrain visible", async ({
  page,
}, testInfo) => {
  await openHarness(page);
  const canvas = page.locator("#game-canvas");

  await expect(canvas).toHaveAttribute("data-terrain-ready", "true");
  await page.mouse.move(640, 360);
  await page.keyboard.down("Shift");
  await page.mouse.down({ button: "right" });
  await page.mouse.move(640, 40, { steps: 12 });
  await page.mouse.up({ button: "right" });
  await page.keyboard.up("Shift");
  await page.mouse.wheel(0, -1600);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  );

  const screenshot = await canvas.screenshot({
    style: ".camera-controls { visibility: hidden; }",
  });
  await testInfo.attach("low-angle-terrain", {
    body: screenshot,
    contentType: "image/png",
  });

  const bounds = findTerrainBounds(
    PNG.sync.read(screenshot),
    await page.evaluate(() => harness.clearColorBytes()),
  );
  expect(bounds.bottom).toBeGreaterThan(bounds.height * 0.82);
});

test("resizing keeps the current zoom and re-fits the aspect ratio", async ({
  page,
}) => {
  await openHarness(page);

  const view = await page.evaluate(async () => {
    const { createTestView, frames, viewAspectRatio, viewHeight, wheel } =
      harness;
    const { canvas, camera, dispose } = createTestView();

    wheel(canvas, -800);
    const zoomed = viewHeight(camera);
    canvas.style.width = "720px";
    canvas.style.height = "1080px";
    await frames(2);

    const resized = {
      height: viewHeight(camera),
      aspectRatio: viewAspectRatio(camera),
    };
    dispose();
    return { zoomed, resized };
  });

  expect(view.zoomed).toBeLessThan(24);
  expect(view.resized.height).toBeCloseTo(view.zoomed);
  expect(view.resized.aspectRatio).toBeCloseTo(720 / 1_080);
});

test("a canvas that loses its size does not strand the camera", async ({
  page,
}) => {
  await openHarness(page);

  const view = await page.evaluate(async () => {
    const { createTestView, frames, viewAspectRatio, viewHeight } = harness;
    const { canvas, camera, dispose } = createTestView();

    const before = viewHeight(camera);
    // A hidden canvas measures 0x0, and NaN bounds never recover.
    canvas.style.display = "none";
    await frames(3);
    const hidden = viewHeight(camera);
    canvas.style.display = "block";
    await frames(3);

    const restored = {
      height: viewHeight(camera),
      aspectRatio: viewAspectRatio(camera),
    };
    dispose();
    return { before, hidden, restored };
  });

  expect(view.before).toBeCloseTo(24);
  expect(Number.isFinite(view.hidden)).toBe(true);
  expect(view.restored.height).toBeCloseTo(view.before);
  expect(view.restored.aspectRatio).toBeCloseTo(1_280 / 720);
});

test("terraforming refreshes height and layer geometry", async ({ page }) => {
  await openHarness(page);

  const heights = await page.evaluate(async () => {
    const { color, createTestView, frames } = harness;
    const { map, scene, view, dispose } = createTestView({
      map: { width: 1, height: 1, tileSize: 1 },
      size: { width: 240, height: 240 },
      terrain: true,
    });
    const lighting = {
      clearColor: scene.clearColor.asArray(),
      skyColor: view.lighting.sky.diffuse.asArray(),
      skyIntensity: view.lighting.sky.intensity,
      sunColor: view.lighting.sun.diffuse.asArray(),
      sunIntensity: view.lighting.sun.intensity,
    };
    const mesh = () => scene.getMeshByName("terrain-0-0-layer-0-plain");
    map.layersAt(0, 0).push({ color: color(0.2, 0.4, 0.3, 1) });
    map.notifyChange(
      { minX: 0, minZ: 0, maxX: 0, maxZ: 0 },
      { affectsNavigation: false },
    );
    await frames(2);
    const before = mesh()?.getVerticesData("position")?.[1];

    map.setHeight(0, 0, 7);
    map.layersAt(0, 0).push({
      type: { id: "overlay" },
      color: color(1, 1, 1, 0.5),
    });
    map.notifyChange(map.tilesAroundCorner(0, 0));
    await frames(2);
    const after = mesh()?.getVerticesData("position")?.[1];
    const addedLayer = Boolean(
      scene.getMeshByName("terrain-0-0-layer-1-tile-overlay"),
    );

    map.layersAt(0, 0).pop();
    map.notifyChange(
      { minX: 0, minZ: 0, maxX: 0, maxZ: 0 },
      { affectsNavigation: false },
    );
    await frames(2);
    const removedLayer = !scene.getMeshByName(
      "terrain-0-0-layer-1-tile-overlay",
    );

    const subscribed = map.onChangedObservable.hasObservers();
    dispose();
    const unsubscribed = !map.onChangedObservable.hasObservers();
    return {
      before,
      after,
      addedLayer,
      removedLayer,
      subscribed,
      unsubscribed,
      lighting,
    };
  });

  expect(heights.before).toBe(0);
  expect(heights.after).toBe(7);
  expect(heights.addedLayer).toBe(true);
  expect(heights.removedLayer).toBe(true);
  expect(heights.subscribed).toBe(true);
  expect(heights.unsubscribed).toBe(true);
  expect(heights.lighting).toEqual({
    clearColor: [0.035, 0.07, 0.09, 1],
    skyColor: [0.6, 0.78, 0.77],
    skyIntensity: 1.05,
    sunColor: [1, 1, 1],
    sunIntensity: 1.3,
  });
});

test("a feathered layer fades to clear at the tiles that lack it", async ({
  page,
}) => {
  await openHarness(page);

  const water = await page.evaluate(() => {
    const { color, createTestView, TEST_TILE_TYPES } = harness;
    // One row of three tiles, with water only in the middle one.
    const { scene, dispose } = createTestView({
      map: {
        width: 3,
        height: 1,
        tileSize: 1,
        createLayers: (x) => [
          { type: TEST_TILE_TYPES.dirt, color: color(1, 1, 1, 1) },
          ...(x === 1
            ? [{ type: TEST_TILE_TYPES.water, color: color(1, 1, 1, 1) }]
            : []),
        ],
      },
      size: { width: 240, height: 240 },
      terrain: true,
    });
    const colors =
      scene
        .getMeshByName("terrain-0-0-layer-1-tile-water")
        ?.getVerticesData("color") ?? [];
    const dirtColors =
      scene
        .getMeshByName("terrain-0-0-layer-0-tile-dirt")
        ?.getVerticesData("color") ?? [];
    const alphas = [];
    for (let index = 3; index < colors.length; index += 4) {
      alphas.push(colors[index]);
    }

    dispose();
    return { alphas, dirtAlphas: [dirtColors[3], dirtColors[7]] };
  });

  // Every corner of the lone water tile touches a dry tile, and the two
  // neighbors off the one-row map are skipped: one contributor of two.
  expect(water.alphas).toEqual([0.5, 0.5, 0.5, 0.5]);
  // Layers that do not opt in keep their flat tile alpha.
  expect(water.dirtAlphas).toEqual([1, 1]);
});

test("feathering invalidates the neighboring chunk at a tile edit", async ({
  page,
}) => {
  await openHarness(page);

  const alpha = await page.evaluate(async () => {
    const { color, createTestView, frames, TEST_TILE_TYPES } = harness;
    const { map, scene, dispose } = createTestView({
      map: {
        width: 33,
        height: 1,
        tileSize: 1,
        createLayers: (x) => [
          { type: TEST_TILE_TYPES.dirt, color: color(1, 1, 1, 1) },
          ...(x === 31
            ? [{ type: TEST_TILE_TYPES.water, color: color(1, 1, 1, 1) }]
            : []),
        ],
      },
      terrain: true,
    });
    const rightEdgeAlpha = () =>
      scene
        .getMeshByName("terrain-0-0-layer-1-tile-water")
        ?.getVerticesData("color")?.[11];
    const before = rightEdgeAlpha();

    map.layersAt(32, 0).push({
      type: TEST_TILE_TYPES.water,
      color: color(1, 1, 1, 1),
    });
    map.notifyChange(
      { minX: 32, minZ: 0, maxX: 32, maxZ: 0 },
      { affectsNavigation: false },
    );
    await frames(2);
    const after = rightEdgeAlpha();

    dispose();
    return { before, after };
  });

  expect(alpha.before).toBe(0.5);
  expect(alpha.after).toBe(1);
});

test("loads layered terrain textures and advances both water passes", async ({
  page,
}) => {
  await openHarness(page);

  const textureState = await page.evaluate(async () => {
    const { color, createTestView, frames, TEST_TILE_TYPES } = harness;
    const { scene, dispose } = createTestView({
      map: {
        width: 3,
        height: 3,
        tileSize: 1,
        createLayers: (x) => [
          { type: TEST_TILE_TYPES.dirt, color: color(1, 1, 1, 1) },
          ...(x === 1
            ? [
                {
                  type: TEST_TILE_TYPES.water,
                  color: color(1, 1, 1, 0.82),
                },
                {
                  type: TEST_TILE_TYPES.waterRipples,
                  color: color(1, 1, 1, 0.3),
                },
              ]
            : []),
          ...(x === 2
            ? [{ type: TEST_TILE_TYPES.clutter, color: color(1, 1, 1, 1) }]
            : []),
        ],
      },
      size: { width: 720, height: 720 },
      terrain: true,
    });
    await scene.whenReadyAsync();
    await frames(2);

    const activeTexture = (name: string) =>
      scene
        .getMaterialByName(`terrain-material-tile-${name}`)
        ?.getActiveTextures()[0] as
        | {
            hasAlpha: boolean;
            isReady: () => boolean;
            uOffset: number;
            uScale: number;
            wrapU: number;
            wrapV: number;
          }
        | undefined;
    const dirt = activeTexture("dirt");
    const clutter = activeTexture("clutter");
    const water = activeTexture("water");
    const ripples = activeTexture("water-ripples");
    const initialOffset = water?.uOffset;
    const initialRippleOffset = ripples?.uOffset;
    const baseMesh = scene.getMeshByName("terrain-0-0-layer-0-tile-dirt");
    const baseNormalY = baseMesh?.getVerticesData("normal")?.[1];
    const firstTwoTileUvs = baseMesh?.getVerticesData("uv")?.slice(0, 16);
    const waterMoved = await new Promise<boolean>((resolve) => {
      const deadline = performance.now() + 5_000;
      const waitForMovement = () => {
        if (
          initialOffset !== water?.uOffset &&
          initialRippleOffset !== ripples?.uOffset
        ) {
          resolve(true);
        } else if (performance.now() >= deadline) {
          resolve(false);
        } else {
          requestAnimationFrame(waitForMovement);
        }
      };
      requestAnimationFrame(waitForMovement);
    });

    const state = {
      texturesReady:
        dirt?.isReady() &&
        clutter?.isReady() &&
        water?.isReady() &&
        ripples?.isReady(),
      alphaChannels:
        dirt?.hasAlpha === false &&
        clutter?.hasAlpha === true &&
        water?.hasAlpha === true &&
        ripples?.hasAlpha === true,
      waterMoved,
      rippleScale: ripples?.uScale,
      wrapModes: [water?.wrapU, water?.wrapV, ripples?.wrapU, ripples?.wrapV],
      firstTwoTileUvs,
      opaqueBase: baseMesh?.hasVertexAlpha === false,
      upwardNormal: typeof baseNormalY === "number" && baseNormalY > 0,
      // Blend order must follow the layer stack, not camera distance.
      alphaIndices: [
        "terrain-0-0-layer-1-tile-water",
        "terrain-0-0-layer-2-tile-water-ripples",
        "terrain-0-0-layer-3-tile-clutter",
      ].map((name) => scene.getMeshByName(name)?.alphaIndex),
    };
    dispose();
    return state;
  });

  expect(textureState).toEqual({
    texturesReady: true,
    alphaChannels: true,
    waterMoved: true,
    rippleScale: 1.37,
    // Babylon's WRAP_ADDRESSMODE constant is 1.
    wrapModes: [1, 1, 1, 1],
    firstTwoTileUvs: [0, 0, 0, 1, 1, 0, 1, 1, 1, 0, 1, 1, 2, 0, 2, 1],
    opaqueBase: true,
    upwardNormal: true,
    alphaIndices: [1, 2, 3],
  });
});

test("water animation changes rendered pixels", async ({ page }, testInfo) => {
  await page.goto("/");
  const canvas = page.locator("#game-canvas");

  await expect(canvas).toHaveAttribute("data-terrain-ready", "true");
  const before = PNG.sync.read(
    await canvas.screenshot({
      style: ".camera-controls { visibility: hidden; }",
    }),
  );
  await page.waitForTimeout(500);
  const afterBuffer = await canvas.screenshot({
    style: ".camera-controls { visibility: hidden; }",
  });
  const after = PNG.sync.read(afterBuffer);

  await testInfo.attach("animated-water", {
    body: afterBuffer,
    contentType: "image/png",
  });
  expect(countChangedPixels(before, after)).toBeGreaterThan(1_000);
});

function countChangedPixels(before: PNG, after: PNG): number {
  expect(after.width).toBe(before.width);
  expect(after.height).toBe(before.height);

  let changed = 0;
  for (let index = 0; index < before.data.length; index += 4) {
    const difference =
      Math.abs(before.data[index] - after.data[index]) +
      Math.abs(before.data[index + 1] - after.data[index + 1]) +
      Math.abs(before.data[index + 2] - after.data[index + 2]);
    if (difference > 8) {
      changed += 1;
    }
  }
  return changed;
}

/** Terrain is every pixel that differs visibly from the scene's clear color. */
function findTerrainBounds(
  image: PNG,
  [clearRed, clearGreen, clearBlue]: number[],
): {
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
      const difference =
        Math.abs(image.data[pixel] - clearRed) +
        Math.abs(image.data[pixel + 1] - clearGreen) +
        Math.abs(image.data[pixel + 2] - clearBlue);

      if (difference > CLEAR_COLOR_TOLERANCE) {
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }
  }

  return { left, right, top, bottom, width: image.width, height: image.height };
}
