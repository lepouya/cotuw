import { expect, test } from "./fixtures";

test("building visibility follows fog in a mission without an economy", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const sessionPath: string = "/src/session.ts";
    const missionsPath: string = "/e2e/missions.ts";
    const harnessPath: string = "/e2e/harness.ts";
    const missionPath: string = "/src/simulation/mission.ts";
    const placementPath: string = "/src/simulation/placement.ts";
    const terrainPath: string = "/src/simulation/terrain.ts";
    const { createGameSession } = (await import(
      sessionPath
    )) as typeof import("../src/session");
    const { level } = (await import(
      missionsPath
    )) as typeof import("./missions");
    const { frames } = (await import(
      harnessPath
    )) as typeof import("./harness");
    const { createMissionState } = (await import(
      missionPath
    )) as typeof import("../src/simulation/mission");
    const { createTilePlacedActor } = (await import(
      placementPath
    )) as typeof import("../src/simulation/placement");
    const { TerrainGrid } = (await import(
      terrainPath
    )) as typeof import("../src/simulation/terrain");
    const mission = level("sandbox");
    const definitions = mission.definitions;
    const building = definitions.find(
      ({ production, refinery }) => production && !refinery,
    )!;
    const scout = definitions.find(({ id }) => id === "arc-scout")!;
    const map = new TerrainGrid({
      width: 36,
      height: 20,
      tileSize: 1,
      terrainTypeIds: ["plain", "path", "rough", "water"],
    });
    const state = {
      ...createMissionState([
        {
          id: "scout",
          definitionId: scout.id,
          owner: "player",
          worldPosition: map.tileCenter(12, 10),
          facing: 0,
          occupancyLayer: "surface" as const,
        },
        createTilePlacedActor(
          map,
          building,
          {
            actorId: "hostile-building",
            origin: { x: 18, z: 10 },
          },
          "rival",
        ),
      ]),
      terrain: map.terrainState(),
      owners: [
        { id: "player", faction: "arc" },
        { id: "rival", faction: "arc" },
      ],
      playerOwner: "player",
      fog: { explored: "0".repeat(map.width * map.height) },
    };
    const canvas = document.createElement("canvas");
    const minimap = document.createElement("canvas");
    Object.assign(canvas.style, { width: "640px", height: "480px" });
    document.body.append(canvas, minimap);
    const view = await createGameSession(canvas, minimap, {
      mission: {
        ...mission,
        scenario: { ...mission.scenario, tileSize: 1 },
        state,
      },
      startPaused: true,
    });
    try {
      while (canvas.dataset.modelsReady !== "true") await frames(1);
      view.engine.stopRenderLoop();
      view.scene.render();
      const drawn = () =>
        !!view.scene.getTransformNodeByName(
          "tile-placed-actor-hostile-building-root",
        );
      const initial = drawn();
      const visit = (x: number) => {
        view.simulation.submitCommand({
          kind: "move",
          actorId: "scout",
          target: map.tileCenter(x, 10),
        });
        for (let tick = 0; tick < 180; tick++) view.simulation.tick();
        view.scene.render();
        return drawn();
      };
      const hidden = visit(1);
      const detected = view.simulation.detects(
        "player",
        view.simulation.actorById("hostile-building")!,
      );
      const returned = visit(12);
      return { initial, hidden, detected, returned };
    } finally {
      await view.disposeAsync();
      canvas.remove();
      minimap.remove();
    }
  });
  expect(result).toEqual({
    initial: true,
    hidden: false,
    detected: false,
    returned: true,
  });
});

test("a restored mission renders its own map and saved terrain", async ({
  page,
}) => {
  await page.goto("/?level=sandbox");
  await expect(page.locator("#game-canvas")).toHaveAttribute(
    "data-terrain-ready",
    "true",
  );
  const result = await page.evaluate(async () => {
    const harnessPath: string = "/e2e/harness.ts";
    const prototypePath: string = "/src/session.ts";
    const loadingPath: string = "/src/mission-loading.ts";
    const contentPath: string = "/src/content/packs.ts";
    const scenarioPath: string = "/src/simulation/scenario.ts";
    const fileFormatPath: string = "/src/simulation/mission-file.ts";
    const terrainPath: string = "/src/simulation/terrain.ts";
    const { frames } = (await import(
      harnessPath
    )) as typeof import("./harness");
    const { createGameSession } = (await import(
      prototypePath
    )) as typeof import("../src/session");
    const { loadMission } = (await import(
      loadingPath
    )) as typeof import("../src/mission-loading");
    const { currentContentPack } = (await import(
      contentPath
    )) as typeof import("../src/content/packs");
    const content = currentContentPack("base");
    const { createScenarioState } = (await import(
      scenarioPath
    )) as typeof import("../src/simulation/scenario");
    const { serializeMission } = (await import(
      fileFormatPath
    )) as typeof import("../src/simulation/mission-file");
    const { TerrainGrid } = (await import(
      terrainPath
    )) as typeof import("../src/simulation/terrain");
    const map = new TerrainGrid({
      width: 20,
      height: 12,
      tileSize: 2,
      terrainTypeIds: ["plain", "path", "rough", "water"],
    });
    const scenario = {
      id: "rendered-scenario-test",
      content: { id: content.id, version: content.version },
      terrain: map.terrainState(),
      tileSize: map.tileSize,
      terrainTypeIds: [...map.terrainTypeIds],
      owners: [{ id: "player", faction: "arc" }],
      playerOwner: "player",
      buildings: [
        {
          actorId: "starting-command-center",
          definitionId: "arc-command-center-prototype",
          origin: { x: 2, z: 4 },
        },
      ],
      stockpiles: [
        { resource: "materials" as const, owners: ["player"], amount: 150 },
      ],
      sites: [],
      loot: [],
    };
    const state = createScenarioState(scenario, content.actors);
    state.terrain!.heights.fill(3);
    state.terrain!.tiles[8 * map.width + 10] = { typeId: "water" };
    const mission = loadMission(serializeMission(scenario, state, 1 / 60));
    const canvas = document.createElement("canvas");
    const minimap = document.createElement("canvas");
    Object.assign(canvas.style, { width: "640px", height: "480px" });
    Object.assign(minimap.style, { width: "128px", height: "128px" });
    document.body.append(canvas, minimap);
    const view = await createGameSession(canvas, minimap, {
      mission,
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
        expectedTerrain: mission.state.terrain,
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
      await view.disposeAsync();
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
