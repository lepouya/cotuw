import { expect, test } from "./fixtures";
import { expectTerrainReady } from "./page-helpers";

import type { ArcRotateCamera } from "@babylonjs/core";

test("building visibility follows fog in a mission without an economy", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { createGameSession } = await import("/src/session.ts");
    const { level } = await import("/e2e/missions.ts");
    const { frames } = await import("/e2e/harness.ts");
    const { createMissionState } = await import("/src/simulation/mission.ts");
    const { createTilePlacedActor } =
      await import("/src/simulation/placement.ts");
    const { TerrainGrid } = await import("/src/simulation/terrain.ts");
    const mission = level("sandbox");
    const { definitions } = mission;
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
      fog: { explored: {} },
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
        view.simulation.submitCommand(
          {
            kind: "move",
            actorId: "scout",
            target: map.tileCenter(x, 10),
          },
          { owner: view.simulation.playerOwner },
        );
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
  await expectTerrainReady(page);
  const result = await page.evaluate(async () => {
    const { frames } = await import("/e2e/harness.ts");
    const { createGameSession } = await import("/src/session.ts");
    const { loadMission } = await import("/src/mission-loading.ts");
    const { currentContentPack } = await import("/src/content/packs.ts");
    const { createScenarioState } = await import("/src/simulation/scenario.ts");
    const { serializeMission } =
      await import("/src/simulation/mission-file.ts");
    const { TerrainGrid } = await import("/src/simulation/terrain.ts");
    const content = currentContentPack("base");
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
      const camera = view.scene.activeCamera as ArcRotateCamera;
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
