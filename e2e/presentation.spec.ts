import { expect, test } from "@playwright/test";

import type { Page } from "@playwright/test";
import type { GameSession } from "../src/session";

declare global {
  interface Window {
    presentation: GameSession;
  }
}

async function openPresentation(page: Page, levelId = "arc-economy-opening") {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  // The spec owns the session on the production HTML.
  await page.route(
    (url) => url.pathname === "/src/main.ts",
    (route) =>
      route.fulfill({
        contentType: "text/javascript",
        body: 'import "/src/styles.css";',
      }),
  );
  await page.goto("/");
  await page.evaluate(async (levelId) => {
    const sessionPath: string = "/src/session.ts";
    const sidebarPath: string = "/src/ui/sidebar.ts";
    const missionsPath: string = "/e2e/missions.ts";
    const clockPath: string = "/src/simulation/clock.ts";
    const { createGameSession } = (await import(
      sessionPath
    )) as typeof import("../src/session");
    const { createSidebar } = (await import(
      sidebarPath
    )) as typeof import("../src/ui/sidebar");
    const { level, placeBuildings } = (await import(
      missionsPath
    )) as typeof import("./missions");
    const { SIMULATION_TICK_SECONDS, secondsToTicks } = (await import(
      clockPath
    )) as typeof import("../src/simulation/clock");
    const mission = level(levelId);
    if (levelId === "arc-economy-opening") {
      placeBuildings(mission, [
        {
          actorId: "blueprint",
          definitionId: "arc-field-barracks",
          origin: { x: 16, z: 50 },
        },
      ]);
      const actor = (id: string) =>
        mission.state.actors.find((each) => each.id === id)!;
      const barracks = mission.definitions.find(
        ({ id }) => id === "arc-field-barracks",
      )!;
      const totalTicks = secondsToTicks(
        barracks.constructionSeconds,
        SIMULATION_TICK_SECONDS,
      );
      // The second of three stages cuts the building at half height.
      actor("blueprint").construction = {
        paidMaterials: barracks.materialsCost!,
        completedTicks: Math.round(totalTicks / 2),
        totalTicks,
      };
      actor("starting-command-center").health = 500;
    }
    const sidebar = createSidebar(
      document.querySelector<HTMLElement>("#game-sidebar")!,
      {
        definitions: mission.definitions,
        presentations: new Map(Object.entries(mission.content.presentation)),
        economy: !!mission.state.economy,
        playerFaction: "arc",
        goals: [],
        selectActor: () => {},
      },
    );
    window.presentation = await createGameSession(
      document.querySelector<HTMLCanvasElement>("#game-canvas")!,
      document.querySelector<HTMLCanvasElement>("#minimap")!,
      { ...sidebar.controls, mission, startPaused: true },
    );
  }, levelId);
  const canvas = page.locator("#game-canvas");
  await expect(canvas).toHaveAttribute("data-models-ready", "true", {
    timeout: 20_000,
  });
  // A few rendered frames compile the clipped and translucent materials.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        let frames = 0;
        const observer = window.presentation.scene.onAfterRenderObservable.add(
          () => {
            if (++frames < 5) return;
            window.presentation.scene.onAfterRenderObservable.remove(observer);
            resolve();
          },
        );
      }),
  );
  return errors;
}

test("blueprints, damage, and birds render with their generated props", async ({
  page,
}) => {
  const errors = await openPresentation(page);
  const shown = await page.evaluate(() => {
    const { scene } = window.presentation;
    const node = (name: string) => scene.getTransformNodeByName(name);
    const quarters = scene.getMeshByName(
      "tile-placed-actor-blueprint-root-model-barracks-quarters",
    );
    return {
      scaffold: !!node("tile-placed-actor-blueprint-root-scaffold"),
      clipped: !!quarters?.material?.clipPlane,
      smoke: scene.transformNodes.filter(
        ({ name }) =>
          name.startsWith("damage-starting-command-center-smoke-") &&
          name.split("-").length === 6,
      ).length,
      fire: !!node("damage-starting-command-center-fire"),
      birds: scene.transformNodes.filter(({ name }) => /^bird-0-\d$/.test(name))
        .length,
    };
  });
  expect(shown).toEqual({
    scaffold: true,
    clipped: true,
    smoke: 12,
    fire: true,
    birds: 4,
  });
  expect(errors).toEqual([]);
});

test("a building placed and producing in one tick plays its generated exit clip", async ({
  page,
}) => {
  const errors = await openPresentation(page, "sandbox");
  await page.evaluate(() => {
    const session = window.presentation;
    session.simulation.submitCommand({
      kind: "place-actor",
      actorId: "new-barracks",
      definitionId: "arc-field-barracks",
      origin: { x: 12, z: 12 },
    });
    session.simulation.submitCommand({
      kind: "train-unit",
      actorId: "new-trooper",
      producerId: "new-barracks",
      definitionId: "arc-trooper",
    });
    session.resume();
  });
  await expect
    .poll(() =>
      page.evaluate(() => {
        const door = window.presentation.scene.getMeshByName(
          "tile-placed-actor-new-barracks-root-model-barracks-entrance-leaf-1",
        );
        return Math.abs(door?.position.x ?? 0);
      }),
    )
    .toBeGreaterThan(0.4);
  await page.evaluate(() => window.presentation.pause());
  expect(
    await page.evaluate(
      () => !!window.presentation.simulation.actorById("new-trooper"),
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
