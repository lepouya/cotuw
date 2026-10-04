import { expect, test } from "@playwright/test";

test("a restored mission renders its own map and saved terrain", async ({
  page,
}) => {
  await page.goto("/?sandbox");
  await expect(page.locator("#game-canvas")).toHaveAttribute(
    "data-terrain-ready",
    "true",
  );
  const result = await page.evaluate(async () => {
    const harnessPath: string = "/e2e/harness.ts";
    const prototypePath: string = "/src/prototype.ts";
    const contentPath: string = "/src/content/economy-scenario.ts";
    const scenarioPath: string = "/src/simulation/scenario.ts";
    const terrainPath: string = "/src/simulation/terrain.ts";
    const { frames } = (await import(
      harnessPath
    )) as typeof import("./harness");
    const { createTerrainPrototype, loadMissionSave } = (await import(
      prototypePath
    )) as typeof import("../src/prototype");
    const { ECONOMY_SCENARIO, ECONOMY_ACTOR_DEFINITIONS } = (await import(
      contentPath
    )) as typeof import("../src/content/economy-scenario");
    const { createScenarioState, serializeMission } = (await import(
      scenarioPath
    )) as typeof import("../src/simulation/scenario");
    const { TerrainGrid } = (await import(
      terrainPath
    )) as typeof import("../src/simulation/terrain");
    const map = new TerrainGrid({
      width: 20,
      height: 12,
      tileSize: 2,
      terrainTypeIds: ECONOMY_SCENARIO.terrainTypeIds,
    });
    const scenario = {
      ...ECONOMY_SCENARIO,
      id: "rendered-scenario-test",
      terrain: map.terrainState(),
      tileSize: map.tileSize,
      buildings: [{ ...ECONOMY_SCENARIO.buildings[0], origin: { x: 2, z: 4 } }],
      units: [],
      objectives: [],
      sites: [],
      loot: [],
    };
    const state = createScenarioState(scenario, ECONOMY_ACTOR_DEFINITIONS);
    state.terrain!.heights.fill(3);
    state.terrain!.tiles[8 * map.width + 10] = { typeId: "water" };
    const loaded = loadMissionSave(serializeMission(state, 1 / 60), scenario);
    const canvas = document.createElement("canvas");
    const minimap = document.createElement("canvas");
    Object.assign(canvas.style, { width: "640px", height: "480px" });
    Object.assign(minimap.style, { width: "128px", height: "128px" });
    document.body.append(canvas, minimap);
    const view = await createTerrainPrototype(canvas, minimap, {
      scenario,
      initialState: loaded,
      startPaused: true,
    });
    try {
      await view.scene.whenReadyAsync();
      while (view.scene.textures.some((texture) => !texture.isReady()))
        await frames(1);
      view.engine.stopRenderLoop();
      view.scene.render();
      const dirt = view.scene.getMeshByName("terrain-0-0-layer-0-tile-dirt")!;
      const water = view.scene.getMeshByName("terrain-0-0-layer-1-tile-water")!;
      const bounds = dirt.getBoundingInfo().boundingBox;
      const waterBounds = water.getBoundingInfo().boundingBox;
      const camera = view.scene
        .activeCamera as import("@babylonjs/core").ArcRotateCamera;
      return {
        terrain: view.simulation.snapshot().terrain,
        expectedTerrain: loaded.terrain,
        bounds: {
          min: bounds.minimum.asArray(),
          max: bounds.maximum.asArray(),
        },
        waterBounds: {
          min: waterBounds.minimum.asArray(),
          max: waterBounds.maximum.asArray(),
        },
        focus: { x: camera.target.x, z: camera.target.z },
        base: view.simulation.actors[0].worldPosition,
        faulted: canvas.dataset.simulationFault,
      };
    } finally {
      view.dispose();
      canvas.remove();
      minimap.remove();
    }
  });
  expect(result.terrain).toEqual(result.expectedTerrain);
  expect(result.bounds).toEqual({ min: [-20, 3, -12], max: [20, 3, 12] });
  expect(result.waterBounds.min[0]).toBe(0);
  expect(result.waterBounds.min[2]).toBe(4);
  expect(result.waterBounds.max[0]).toBe(2);
  expect(result.waterBounds.max[2]).toBe(6);
  expect(result.focus).toEqual(result.base);
  expect(result.faulted).not.toBe("true");
});
