import { expect, test } from "@playwright/test";

test("refreshes footprint geometry and in-place color changes at the same center", async ({
  page,
}) => {
  await page.goto("/?sandbox");
  const results = await page.evaluate(async () => {
    const minimapPath: string = "/src/render/minimap.ts";
    const mapPath: string = "/src/map.ts";
    const corePath: string = "/e2e/harness.ts";
    const { createMinimap } = await import(minimapPath);
    const { TerrainMap } = await import(mapPath);
    const { EngineStore } = await import(corePath);
    const scene = EngineStore.Instances[0].scenes[0];
    const map = new TerrainMap({ width: 4, height: 4, tileSize: 1 });
    const canvas = document.createElement("canvas");
    canvas.style.cssText = "width:200px;height:200px";
    document.body.append(canvas);
    const context = canvas.getContext("2d")!;
    let corners = 0;
    const fills: {
      corners: number;
      color: string | CanvasGradient | CanvasPattern;
    }[] = [];
    const moveTo = context.moveTo.bind(context);
    const fill = context.fill.bind(context);
    const beginPath = context.beginPath.bind(context);
    context.beginPath = () => {
      corners = 0;
      beginPath();
    };
    context.moveTo = (x, y) => {
      corners++;
      moveTo(x, y);
    };
    context.fill = () => {
      fills.push({ corners, color: context.fillStyle });
      fill();
    };
    const actor = {
      id: "structure",
      worldPosition: { x: 0, z: 0 },
      tiles: [{ x: 1, z: 1 }],
      color: [1, 0, 0],
    };
    const minimap = createMinimap(
      scene,
      map,
      {
        viewFootprint: () => [
          { x: -1, z: -1 },
          { x: 1, z: -1 },
          { x: 1, z: 1 },
          { x: -1, z: 1 },
        ],
      },
      canvas,
      { actors: () => [actor] },
    );
    try {
      scene.onAfterRenderObservable.notifyObservers(scene);
      const first = fills[0];
      fills.length = 0;
      actor.tiles = [
        { x: 1, z: 1 },
        { x: 2, z: 1 },
      ];
      minimap.refreshActors();
      scene.onAfterRenderObservable.notifyObservers(scene);
      const geometry = fills[0];
      fills.length = 0;
      actor.color[0] = 0;
      actor.color[2] = 1;
      minimap.refreshActors();
      scene.onAfterRenderObservable.notifyObservers(scene);
      return { first, geometry, color: fills[0] };
    } finally {
      minimap.dispose();
      canvas.remove();
    }
  });
  expect(results.first).toEqual({ corners: 1, color: "#ff0000" });
  expect(results.geometry).toEqual({ corners: 2, color: "#ff0000" });
  expect(results.color).toEqual({ corners: 2, color: "#0000ff" });
});

import type { Page } from "@playwright/test";

/** In-page test helpers, loaded by `openHarness`. */
declare const harness: typeof import("./harness");
declare const testView: ReturnType<typeof harness.createTestView>;

const MINIMAP_SIZE = 200;

async function openMinimapView(page: Page): Promise<void> {
  await page.goto("/?sandbox");
  await page.evaluate(async (minimapSize) => {
    const harnessPath: string = "/e2e/harness.ts";
    const loaded: typeof harness = await import(harnessPath);
    Object.assign(window, {
      harness: loaded,
      testView: loaded.createTestView({ minimapSize }),
    });
    await loaded.frames(2);
  }, MINIMAP_SIZE);
}

const cameraTarget = (page: Page) =>
  page.evaluate(() => {
    const { x, z } = testView.camera.target;
    return { x, z };
  });

const viewportOutline = (page: Page) =>
  page.evaluate((size) => {
    const projection = harness.minimapProjection(testView.map, size, size);
    return testView.view.camera.viewFootprint().map(projection.toMinimap);
  }, MINIMAP_SIZE);

/** The world point under a minimap pixel, per the minimap's own projection. */
const worldAt = (page: Page, x: number, y: number) =>
  page.evaluate(
    ({ x, y, size }) => {
      const point = harness
        .minimapProjection(testView.map, size, size)
        .toWorld({ x, y });
      return { x: point.x, z: point.z };
    },
    { x, y, size: MINIMAP_SIZE },
  );

async function settle(page: Page): Promise<void> {
  // Outlasts the glide, then lets the minimap redraw.
  await page.waitForTimeout(500);
  await page.evaluate(() => harness.frames(2));
}

test("clicking the minimap glides the camera to that point", async ({
  page,
}) => {
  await openMinimapView(page);
  const destination = await worldAt(page, 150, 60);

  await page.mouse.click(150, 60);
  await settle(page);

  const target = await cameraTarget(page);
  expect(target.x).toBeCloseTo(destination.x, 1);
  expect(target.z).toBeCloseTo(destination.z, 1);
});

test("dragging the outline pans without jumping to the pointer", async ({
  page,
}) => {
  await openMinimapView(page);
  await page.mouse.click(100, 100);
  await settle(page);
  const before = await cameraTarget(page);
  const outline = await viewportOutline(page);
  // Hit the middle of the visible edge, not merely the viewport interior.
  const startPoint = {
    x: (outline[0].x + outline[1].x) / 2,
    y: (outline[0].y + outline[1].y) / 2,
  };
  const endPoint = { x: startPoint.x - 20, y: startPoint.y + 20 };
  const start = await worldAt(page, startPoint.x, startPoint.y);
  const end = await worldAt(page, endPoint.x, endPoint.y);

  // Grabs the outline off-center; the view must keep that grip.
  await page.mouse.move(startPoint.x, startPoint.y);
  await page.mouse.down();
  await page.mouse.move(
    (startPoint.x + endPoint.x) / 2,
    (startPoint.y + endPoint.y) / 2,
    { steps: 4 },
  );
  await page.mouse.move(endPoint.x, endPoint.y, { steps: 4 });
  await page.mouse.up();
  await page.evaluate(() => harness.frames(2));

  const after = await cameraTarget(page);
  expect(after.x - before.x).toBeCloseTo(end.x - start.x, 1);
  expect(after.z - before.z).toBeCloseTo(end.z - start.z, 1);
});

test("scrolling over the minimap never zooms the main view", async ({
  page,
}) => {
  await openMinimapView(page);
  const viewHeight = () =>
    page.evaluate(() => harness.viewHeight(testView.camera));
  const heightBefore = await viewHeight();

  await page.mouse.move(100, 100);
  await page.mouse.wheel(0, 2_000);
  await page.evaluate(() => harness.frames(2));

  expect(await viewHeight()).toBe(heightBefore);
});

test("actor markers redraw at their current world positions", async ({
  page,
}) => {
  await page.goto("/?sandbox");
  const pixels = await page.evaluate(async () => {
    const harnessPath: string = "/e2e/harness.ts";
    const { createMinimap, createTestView, frames, minimapProjection } =
      await import(harnessPath);
    const test = createTestView({
      map: { width: 10, height: 10, tileSize: 1 },
      size: { width: 200, height: 200 },
    });
    const canvas = document.createElement("canvas");
    Object.assign(canvas.style, {
      position: "fixed",
      top: "0",
      left: "0",
      width: "200px",
      height: "200px",
      zIndex: "20",
    });
    document.body.append(canvas);
    const actor = { id: "trooper", worldPosition: { x: -2, z: 0 } };
    const minimap = createMinimap(
      test.scene,
      test.map,
      test.view.camera,
      canvas,
      {
        actors: () => [actor],
      },
    );
    await frames(2);

    const pixelAt = (worldPosition: { x: number; z: number }) => {
      const point = minimapProjection(test.map, 200, 200).toMinimap(
        worldPosition,
      );
      const ratio = canvas.width / canvas.clientWidth;
      return Array.from(
        canvas
          .getContext("2d")!
          .getImageData(
            Math.round(point.x * ratio),
            Math.round(point.y * ratio),
            1,
            1,
          ).data,
      );
    };
    const first = pixelAt(actor.worldPosition);
    const previousPosition = actor.worldPosition;
    actor.worldPosition = { x: 2, z: 0 };
    minimap.refreshActors();
    await frames(2);
    const oldPosition = pixelAt(previousPosition);
    const second = pixelAt(actor.worldPosition);

    test.dispose();
    canvas.remove();
    return { first, oldPosition, second };
  });

  expect(pixels.first).toEqual([222, 88, 31, 255]);
  expect(pixels.oldPosition).not.toEqual([222, 88, 31, 255]);
  expect(pixels.second).toEqual([222, 88, 31, 255]);
});

test("minimap commands wait for a click and ignore drags and cancelled capture", async ({
  page,
}) => {
  await page.goto("/?sandbox");
  await page.evaluate(async () => {
    const harnessPath: string = "/e2e/harness.ts";
    const loaded: typeof harness = await import(harnessPath);
    const view = loaded.createTestView({ size: { width: 200, height: 200 } });
    const canvas = document.createElement("canvas");
    canvas.id = "command-minimap";
    canvas.style.cssText =
      "position:fixed;top:0;left:0;width:200px;height:200px;z-index:20;touch-action:none";
    document.body.append(canvas);
    const targets: { x: number; z: number }[] = [];
    loaded.createMinimap(view.scene, view.map, view.view.camera, canvas, {
      commandMode: () => true,
      onCommand: (target: { x: number; z: number }) => {
        targets.push(target);
        return true;
      },
    });
    Object.assign(window, { commandTargets: targets });
    await loaded.frames(2);
  });
  const count = () =>
    page.evaluate(() => Reflect.get(window, "commandTargets").length);
  await page.mouse.move(150, 60);
  await page.mouse.down();
  expect(await count()).toBe(0);
  await page.mouse.up();
  expect(await count()).toBe(1);

  await page.mouse.down();
  await page.mouse.move(170, 80, { steps: 4 });
  await page.mouse.move(150, 60, { steps: 4 });
  await page.mouse.up();
  expect(await count()).toBe(1);

  await page.mouse.down();
  await page.evaluate(() => {
    document
      .querySelector("#command-minimap")!
      .dispatchEvent(new PointerEvent("lostpointercapture", { pointerId: 1 }));
  });
  await page.mouse.up();
  expect(await count()).toBe(1);
  await page.mouse.click(150, 60);
  expect(await count()).toBe(2);
});
