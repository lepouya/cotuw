import { expect, test } from "./fixtures";
import { withoutApp } from "./prototype-helpers";
import { WEBKIT } from "./tags";

test(
  "unseen gathering and pickups keep last-seen map and sidebar markers",
  {
    tag: WEBKIT,
  },
  async ({ page }) => {
    await withoutApp(page);
    await page.goto("/");
    const result = await page.evaluate(async () => {
      const sessionPath: string = "/src/session.ts";
      const missionsPath: string = "/e2e/missions.ts";
      const scenarioPath: string = "/src/simulation/scenario.ts";
      const actorPath: string = "/src/simulation/actor.ts";
      const sidebarPath: string = "/src/ui/sidebar.ts";
      const terrainPath: string = "/src/simulation/terrain.ts";
      const harnessPath: string = "/e2e/harness.ts";
      const { createGameSession } = (await import(
        sessionPath
      )) as typeof import("../src/session");
      const { level } = (await import(
        missionsPath
      )) as typeof import("./missions");
      const { createScenarioState, defineScenario } = (await import(
        scenarioPath
      )) as typeof import("../src/simulation/scenario");
      const { createActor } = (await import(
        actorPath
      )) as typeof import("../src/simulation/actor");
      const { createSidebar } = (await import(
        sidebarPath
      )) as typeof import("../src/ui/sidebar");
      const { TerrainGrid } = (await import(
        terrainPath
      )) as typeof import("../src/simulation/terrain");
      const { frames, minimapProjection } = (await import(
        harnessPath
      )) as typeof import("./harness");
      const mission = level();
      const map = new TerrainGrid({
        width: 60,
        height: 20,
        tileSize: 1,
        terrainTypeIds: ["plain", "path", "rough", "water"],
      });
      const scenario = defineScenario({
        id: "resource-memory",
        tileSize: 1,
        terrainTypeIds: [...map.terrainTypeIds],
        terrain: map.terrainState(),
        owners: [
          { id: "player", faction: "arc" },
          { id: "rival", faction: "arc" },
        ],
        playerOwner: "player",
        buildings: [
          {
            actorId: "cc",
            definitionId: "arc-command-center-prototype",
            origin: { x: 31, z: 6 },
            owner: "rival",
          },
          {
            actorId: "refinery",
            definitionId: "arc-materials-refinery",
            origin: { x: 37, z: 6 },
            owner: "rival",
          },
        ],
        units: [
          {
            actorId: "home",
            definitionId: "arc-trooper",
            tile: { x: 4, z: 10 },
          },
          {
            actorId: "spotter",
            definitionId: "arc-scout",
            tile: { x: 40, z: 10 },
          },
          {
            actorId: "worker",
            definitionId: "arc-harvester",
            tile: { x: 45, z: 10 },
            owner: "rival",
          },
          {
            actorId: "collector",
            definitionId: "arc-scout",
            tile: { x: 44, z: 10 },
            owner: "rival",
          },
        ],
        stockpiles: ["player", "rival"].map((owner) => ({
          resource: "materials" as const,
          owners: [owner],
          amount: 100,
        })),
        sites: [
          {
            id: "far",
            name: "Far Materials",
            tile: { x: 45, z: 10 },
            initialMaterials: 1,
            remainingMaterials: 1,
          },
        ],
        loot: [
          {
            id: "gift",
            name: "Gift",
            tile: { x: 44, z: 10 },
            materials: 25,
            collected: false,
          },
        ],
      });
      const sidebar = createSidebar(
        document.querySelector<HTMLElement>("#game-sidebar")!,
        {
          definitions: mission.definitions,
          presentations: new Map(Object.entries(mission.content.presentation)),
          economy: true,
          goals: [],
          playerOwner: "player",
          playerFaction: "arc",
          selectActor: () => {},
        },
      );
      const canvas = document.querySelector<HTMLCanvasElement>("#game-canvas")!;
      const minimap = document.querySelector<HTMLCanvasElement>("#minimap")!;
      const view = await createGameSession(canvas, minimap, {
        ...sidebar.controls,
        startPaused: true,
        mission: {
          ...mission,
          scenario,
          state: createScenarioState(
            scenario,
            mission.definitions,
          ) as typeof mission.state,
        },
        onStateChanged: sidebar.update,
        onDispose: sidebar.dispose,
      });
      try {
        while (canvas.dataset.modelsReady !== "true") await frames(1);
        view.engine.stopRenderLoop();
        view.simulation.removeActor("spotter");
        view.scene.render();
        const shown = () =>
          ["materials-far", "materials-gift-gift"].map((name) =>
            view.scene.getTransformNodeByName(name)!.isEnabled(),
          );
        const overview = () =>
          document.querySelector("#resource-overview")!.textContent;
        const pixel = () => {
          const point = minimapProjection(
            map,
            minimap.clientWidth,
            minimap.clientHeight,
          ).toMinimap(map.tileCenter(44, 10));
          const ratio = minimap.width / minimap.clientWidth;
          return Array.from(
            minimap
              .getContext("2d")!
              .getImageData(
                Math.round(point.x * ratio),
                Math.round(point.y * ratio),
                1,
                1,
              ).data,
          );
        };
        const before = { shown: shown(), overview: overview(), pixel: pixel() };
        view.simulation.submitCommand(
          {
            kind: "assign-refinery",
            actorId: "worker",
            refineryId: "refinery",
          },
          { owner: "rival" },
        );
        view.simulation.submitCommand(
          { kind: "gather", actorId: "worker", siteId: "far" },
          { owner: "rival" },
        );
        for (let tick = 0; tick < 60; tick++) view.simulation.tick();
        view.scene.render();
        const unseen = { shown: shown(), overview: overview(), pixel: pixel() };
        const live = {
          remaining: view.simulation.economy!.sites[0]!.remainingMaterials,
          collected: view.simulation.economy!.loot[0]!.collected,
        };
        view.simulation.spawnActor(
          createActor({
            id: "returning",
            owner: "player",
            definitionId: "arc-scout",
            worldPosition: map.tileCenter(40, 10),
          }),
        );
        view.scene.render();
        return {
          before,
          unseen,
          live,
          returned: shown(),
          returnedOverview: overview(),
        };
      } finally {
        await view.disposeAsync();
      }
    });
    expect(result.before.shown).toEqual([true, true]);
    expect(result.before.overview).toContain("Far Materials");
    expect(result.before.overview).toContain("salvage");
    expect(result.unseen).toEqual(result.before);
    expect(result.live).toEqual({ remaining: 0, collected: true });
    expect(result.returned).toEqual([false, false]);
    expect(result.returnedOverview).not.toContain("salvage");
  },
);
