import { expect, test } from "@playwright/test";

test("terrain clips load, advance, freeze, and release their frame textures", async ({
  page,
}) => {
  await page.goto("/?level=sandbox");
  const result = await page.evaluate(async () => {
    const path: string = "/e2e/harness.ts";
    const { createTestView, createTerrainMeshes, currentContentPack, color } =
      (await import(path)) as typeof import("./harness");
    const content = currentContentPack("base");
    const graphics = content.terrain.tileTypes.grass.graphics!;
    const testView = createTestView({
      map: {
        width: 8,
        height: 1,
        tileSize: 1,
        createLayers: () => [
          { type: { id: "grass", graphics }, color: color(1, 1, 1, 1) },
        ],
      },
    });
    const { scene, map } = testView;
    let still = false;
    const terrain = createTerrainMeshes(scene, map, {
      clips: content.clips,
      reducedMotion: () => still,
    });
    const materials = scene.materials.filter(({ name }) =>
      name.includes("terrain-material"),
    ) as import("@babylonjs/core").StandardMaterial[];
    const before = map.terrainState();
    const initialTextures = scene.textures.length;
    try {
      // Image decoding is asynchronous in both browser engines.
      const deadline = performance.now() + 5000;
      while (materials.some(({ alpha }) => alpha === 0)) {
        if (performance.now() > deadline)
          throw new Error("Grass clip did not load.");
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve()),
        );
        scene.render();
      }
      const distinct = new Set(
        materials.map(({ diffuseTexture }) => diffuseTexture),
      ).size;
      still = true;
      scene.render();
      const first = materials[0]!.diffuseTexture!;
      const frozen = materials.every(
        ({ diffuseTexture }) => diffuseTexture === first,
      );
      still = false;
      scene.getEngine().getDeltaTime = () => 180;
      const played = new Set();
      for (let i = 0; i < 16; i++) {
        scene.render();
        played.add(materials[0]!.diffuseTexture);
      }
      still = true;
      scene.render();
      const held = materials.every(
        ({ diffuseTexture }) => diffuseTexture === first,
      );
      const unchanged =
        JSON.stringify(map.terrainState()) === JSON.stringify(before);
      const size = first.getSize();
      terrain.dispose();
      terrain.dispose();
      const released = scene.textures.length === initialTextures;
      return {
        distinct,
        frozen,
        held,
        unchanged,
        released,
        played: played.size,
        size,
      };
    } finally {
      testView.dispose();
    }
  });
  expect(result.distinct).toBeGreaterThan(1);
  expect(result.played).toBe(8);
  expect(result.size).toEqual({ width: 384, height: 384 });
  expect(
    result.frozen && result.held && result.unchanged && result.released,
  ).toBe(true);
});
