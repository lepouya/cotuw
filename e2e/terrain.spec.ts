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

test("terraforming refreshes height and layer geometry", async ({ page }) => {
  await page.goto("/");

  const heights = await page.evaluate(async () => {
    const sourceRoot: string = "/src";
    const { TerrainMap } = await import(`${sourceRoot}/map.ts`);
    const { PROTOTYPE_VIEW_OPTIONS } = await import(
      `${sourceRoot}/prototype.ts`
    );
    const { createGameView, createTerrainMeshes } = await import(
      `${sourceRoot}/render/index.ts`
    );
    const canvas = document.createElement("canvas");
    canvas.style.width = "240px";
    canvas.style.height = "240px";
    document.body.append(canvas);

    const map = new TerrainMap({
      width: 1,
      height: 1,
      tileSize: 1,
    });
    const view = createGameView(canvas, map, PROTOTYPE_VIEW_OPTIONS);
    createTerrainMeshes(view.scene, map);
    const lighting = {
      clearColor: view.scene.clearColor.asArray(),
      skyColor: view.lighting.sky.diffuse.asArray(),
      skyIntensity: view.lighting.sky.intensity,
      sunColor: view.lighting.sun.diffuse.asArray(),
      sunIntensity: view.lighting.sun.intensity,
    };
    const mesh = () => view.scene.getMeshByName("terrain-0-0-layer-0-plain");
    const baseColor = view.scene.clearColor.clone().set(0.2, 0.4, 0.3, 1);
    map.layersAt(0, 0).push({ color: baseColor });
    map.notifyChange({ minX: 0, minZ: 0, maxX: 0, maxZ: 0 });
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    const before = mesh()?.getVerticesData("position")?.[1];

    map.setHeight(0, 0, 7);
    map.layersAt(0, 0).push({
      texture: "terrain/dirt",
      color: baseColor.clone().set(1, 1, 1, 0.5),
    });
    map.notifyChange(map.tilesAroundCorner(0, 0));
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    const after = mesh()?.getVerticesData("position")?.[1];
    const addedLayer = Boolean(
      view.scene.getMeshByName("terrain-0-0-layer-1-texture-terrain/dirt"),
    );

    map.layersAt(0, 0).pop();
    map.notifyChange({ minX: 0, minZ: 0, maxX: 0, maxZ: 0 });
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    const removedLayer = !view.scene.getMeshByName(
      "terrain-0-0-layer-1-texture-terrain/dirt",
    );

    const subscribed = map.onChangedObservable.hasObservers();
    view.dispose();
    const unsubscribed = !map.onChangedObservable.hasObservers();
    canvas.remove();
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
  await page.goto("/");

  const water = await page.evaluate(async () => {
    const sourceRoot: string = "/src";
    const { TerrainMap } = await import(`${sourceRoot}/map.ts`);
    const { PROTOTYPE_VIEW_OPTIONS } = await import(
      `${sourceRoot}/prototype.ts`
    );
    const { createGameView, createTerrainMeshes } = await import(
      `${sourceRoot}/render/index.ts`
    );
    const canvas = document.createElement("canvas");
    canvas.style.width = "240px";
    canvas.style.height = "240px";
    document.body.append(canvas);

    // One row of three tiles, with water only in the middle one.
    const color = (alpha: number) =>
      PROTOTYPE_VIEW_OPTIONS.clearColor.clone().set(1, 1, 1, alpha);
    const map = new TerrainMap({
      width: 3,
      height: 1,
      tileSize: 1,
      createLayers: (x: number) => [
        { texture: "terrain/dirt", color: color(1) },
        ...(x === 1
          ? [
              {
                texture: "terrain/water",
                color: color(1),
                featherEdges: true,
              },
            ]
          : []),
      ],
    });
    const view = createGameView(canvas, map, PROTOTYPE_VIEW_OPTIONS);
    createTerrainMeshes(view.scene, map);
    const mesh = view.scene.getMeshByName(
      "terrain-0-0-layer-1-texture-terrain/water",
    );
    const colors = mesh?.getVerticesData("color") ?? [];
    const dirt = view.scene.getMeshByName(
      "terrain-0-0-layer-0-texture-terrain/dirt",
    );
    const dirtColors = dirt?.getVerticesData("color") ?? [];
    const alphas = [];
    for (let index = 3; index < colors.length; index += 4) {
      alphas.push(colors[index]);
    }

    view.dispose();
    canvas.remove();
    return {
      alphas,
      dirtAlphas: [dirtColors[3], dirtColors[7]],
    };
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
  await page.goto("/");

  const alpha = await page.evaluate(async () => {
    const sourceRoot: string = "/src";
    const { TerrainMap } = await import(`${sourceRoot}/map.ts`);
    const { PROTOTYPE_VIEW_OPTIONS } = await import(
      `${sourceRoot}/prototype.ts`
    );
    const { createGameView, createTerrainMeshes } = await import(
      `${sourceRoot}/render/index.ts`
    );
    const color = (value: number) =>
      PROTOTYPE_VIEW_OPTIONS.clearColor.clone().set(1, 1, 1, value);
    const map = new TerrainMap({
      width: 33,
      height: 1,
      tileSize: 1,
      createLayers: (x: number) => [
        { texture: "terrain/dirt", color: color(1) },
        ...(x === 31
          ? [
              {
                texture: "terrain/water",
                color: color(1),
                featherEdges: true,
              },
            ]
          : []),
      ],
    });
    const canvas = document.createElement("canvas");
    const view = createGameView(canvas, map, PROTOTYPE_VIEW_OPTIONS);
    createTerrainMeshes(view.scene, map);
    const waterMesh = () =>
      view.scene.getMeshByName("terrain-0-0-layer-1-texture-terrain/water");
    const rightEdgeAlpha = () => waterMesh()?.getVerticesData("color")?.[11];
    const before = rightEdgeAlpha();

    map.layersAt(32, 0).push({
      texture: "terrain/water",
      color: color(1),
      featherEdges: true,
    });
    map.notifyChange({ minX: 32, minZ: 0, maxX: 32, maxZ: 0 });
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    const after = rightEdgeAlpha();

    view.dispose();
    return { before, after };
  });

  expect(alpha.before).toBe(0.5);
  expect(alpha.after).toBe(1);
});

test("prototype water keeps fixed layer slots across clutter tiles", async ({
  page,
}) => {
  await page.goto("/");

  const layerIndices = await page.evaluate(async () => {
    const sourceRoot: string = "/src";
    const { createPrototypeMap } = await import(`${sourceRoot}/prototype.ts`);
    const map = createPrototypeMap();
    const water = new Set<number>();
    const ripples = new Set<number>();

    for (let z = 0; z < map.height; z += 1) {
      for (let x = 0; x < map.width; x += 1) {
        for (const [index, layer] of map.layersAt(x, z).entries()) {
          if (layer.texture === "terrain/water") water.add(index);
          if (layer.texture === "terrain/water-ripples") ripples.add(index);
        }
      }
    }

    return {
      water: [...water],
      ripples: [...ripples],
    };
  });

  expect(layerIndices).toEqual({ water: [1], ripples: [2] });
});

test("loads layered terrain textures and advances both water passes", async ({
  page,
}) => {
  await page.goto("/");

  const textureState = await page.evaluate(async () => {
    const sourceRoot: string = "/src";
    const { TerrainMap } = await import(`${sourceRoot}/map.ts`);
    const { PROTOTYPE_VIEW_OPTIONS } = await import(
      `${sourceRoot}/prototype.ts`
    );
    const { createGameView, createTerrainMeshes } = await import(
      `${sourceRoot}/render/index.ts`
    );
    const color = (red: number, green: number, blue: number, alpha: number) =>
      PROTOTYPE_VIEW_OPTIONS.clearColor.clone().set(red, green, blue, alpha);
    const canvas = document.createElement("canvas");
    canvas.id = "texture-preview";
    canvas.style.width = "720px";
    canvas.style.height = "720px";
    document.body.append(canvas);

    const map = new TerrainMap({
      width: 3,
      height: 3,
      tileSize: 1,
      createLayers: (x: number) => [
        {
          texture: "terrain/dirt",
          color: color(1, 1, 1, 1),
        },
        ...(x === 1
          ? [
              {
                texture: "terrain/water",
                color: color(1, 1, 1, 0.82),
              },
              {
                texture: "terrain/water-ripples",
                color: color(1, 1, 1, 0.3),
              },
            ]
          : []),
        ...(x === 2
          ? [
              {
                texture: "terrain/clutter",
                color: color(1, 1, 1, 1),
              },
            ]
          : []),
      ],
    });
    const view = createGameView(canvas, map, PROTOTYPE_VIEW_OPTIONS);
    createTerrainMeshes(view.scene, map);
    await view.scene.whenReadyAsync();
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );

    const material = view.scene.getMaterialByName(
      "terrain-material-texture-terrain/water",
    );
    const rippleMaterial = view.scene.getMaterialByName(
      "terrain-material-texture-terrain/water-ripples",
    );
    const dirtMaterial = view.scene.getMaterialByName(
      "terrain-material-texture-terrain/dirt",
    );
    const clutterMaterial = view.scene.getMaterialByName(
      "terrain-material-texture-terrain/clutter",
    );
    const water = material?.getActiveTextures()[0] as
      | {
          hasAlpha: boolean;
          isReady: () => boolean;
          uOffset: number;
          wrapU: number;
          wrapV: number;
        }
      | undefined;
    const initialOffset = water?.uOffset;
    const ripples = rippleMaterial?.getActiveTextures()[0] as
      | {
          hasAlpha: boolean;
          isReady: () => boolean;
          uOffset: number;
          uScale: number;
          wrapU: number;
          wrapV: number;
        }
      | undefined;
    const initialRippleOffset = ripples?.uOffset;
    const dirt = dirtMaterial?.getActiveTextures()[0];
    const clutter = clutterMaterial?.getActiveTextures()[0];
    const baseMesh = view.scene.getMeshByName(
      "terrain-0-0-layer-0-texture-terrain/dirt",
    );
    const baseNormalY = baseMesh?.getVerticesData("normal")?.[1];
    const firstTwoTileUvs = baseMesh?.getVerticesData("uv")?.slice(0, 16);
    await new Promise((resolve) => window.setTimeout(resolve, 100));

    return {
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
      waterMoved:
        initialOffset !== water?.uOffset &&
        initialRippleOffset !== ripples?.uOffset,
      rippleScale: ripples?.uScale,
      wrapModes: [water?.wrapU, water?.wrapV, ripples?.wrapU, ripples?.wrapV],
      firstTwoTileUvs,
      opaqueBase: baseMesh?.hasVertexAlpha === false,
      upwardNormal: typeof baseNormalY === "number" && baseNormalY > 0,
    };
  });

  expect(textureState).toEqual({
    texturesReady: true,
    alphaChannels: true,
    waterMoved: true,
    rippleScale: 1.37,
    // Babylon's MIRROR_ADDRESSMODE constant is 2.
    wrapModes: [2, 2, 2, 2],
    firstTwoTileUvs: [0, 0, 0, 1, 1, 0, 1, 1, 1, 0, 1, 1, 2, 0, 2, 1],
    opaqueBase: true,
    upwardNormal: true,
  });
});

test("water animation changes rendered pixels", async ({ page }, testInfo) => {
  await page.goto("/");
  const canvas = page.locator("#game-canvas");

  await expect(canvas).toHaveAttribute("data-terrain-ready", "true");
  const before = PNG.sync.read(await canvas.screenshot());
  await page.waitForTimeout(500);
  const afterBuffer = await canvas.screenshot();
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
