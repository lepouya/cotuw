import { expect, test } from "./fixtures";
import { forEachProfile, MOUSE_AND_PHONE_PROFILES } from "./profiles";
import { WEBKIT } from "./tags";
import {
  activate,
  advance,
  collectPageErrors,
  expectTerrainReady,
  pressPoint,
  selectInSession,
  withoutApp,
} from "./page-helpers";
import type { Page } from "@playwright/test";

async function opening(page: Page) {
  await withoutApp(page);
  await page.goto("/");
  await page.evaluate(async () => {
    const { startSidebarSession } = await import("/e2e/sidebar-session.ts");
    const { level, withScenario } = await import("/e2e/missions.ts");
    const { controlSessionClock } = await import("/e2e/harness.ts");
    const { defineScenario } = await import("/src/simulation/scenario.ts");
    const { TerrainGrid } = await import("/src/simulation/terrain.ts");
    const map = new TerrainGrid({
      width: 32,
      height: 24,
      tileSize: 1,
      terrainTypeIds: ["plain", "path", "rough", "water"],
    });
    const scenario = defineScenario({
      id: "support-controls",
      tileSize: 1,
      terrainTypeIds: [...map.terrainTypeIds],
      terrain: map.terrainState(),
      owners: [{ id: "player", faction: "arc" }],
      playerOwner: "player",
      stockpiles: [{ owners: ["player"], resource: "materials", amount: 500 }],
      sites: [],
      loot: [],
      buildings: [
        {
          actorId: "cc",
          definitionId: "arc-command-center-prototype",
          origin: { x: 8, z: 6 },
        },
        {
          actorId: "barracks",
          definitionId: "arc-field-barracks",
          origin: { x: 13, z: 6 },
        },
      ],
      units: [
        {
          actorId: "trooper",
          definitionId: "arc-trooper",
          tile: { x: 17, z: 11 },
        },
        {
          actorId: "harvester",
          definitionId: "arc-harvester",
          tile: { x: 15, z: 14 },
        },
      ],
    });
    const mission = withScenario(level(), scenario);
    mission.state.actors.find(({ id }) => id === "trooper")!.health = 1;
    mission.state.actors.find(({ id }) => id === "harvester")!.health = 20;
    const { view } = await startSidebarSession(mission);
    controlSessionClock(view);
  });
  await expectTerrainReady(page);
  await selectInSession(page, "barracks");
}

async function actorPoint(page: Page, id: string) {
  return page.evaluate(async (id) => {
    const { Vector3, projectToCanvas } = await import("/e2e/harness.ts");
    const { view } = window.sessionHarness;
    const root = view.scene.getTransformNodeByName(`actor-${id}-root`)!;
    const canvas = document.querySelector<HTMLCanvasElement>("#game-canvas")!;
    const bounds = canvas.getBoundingClientRect();
    const points = [1.2, 0.9, 0.6].map((height) =>
      root.getAbsolutePosition().add(new Vector3(0, height, 0)),
    );
    for (const point of points) {
      const screen = projectToCanvas(view.scene, canvas, point);
      const pick = view.scene.pick(
        screen.x - bounds.left,
        screen.y - bounds.top,
      );
      if (pick?.pickedMesh?.isDescendantOf(root))
        return {
          ...screen,
          clear: document.elementFromPoint(screen.x, screen.y) === canvas,
        };
    }
    throw new Error(`No clickable mesh point for ${id}`);
  }, id);
}

forEachProfile(MOUSE_AND_PHONE_PROFILES, ({ touch }) => {
  test(`Barracks support training and manual recovery targeting ${WEBKIT}`, async ({
    page,
  }, info) => {
    const errors = collectPageErrors(page);
    await opening(page);
    await activate(page.locator("#open-training"), touch);
    await expect(page.locator("#train-medic")).toBeEnabled();
    await expect(page.locator("#train-mechanic")).toBeEnabled();
    for (const role of ["medic", "mechanic"]) {
      const card = page.locator(`#train-${role}`);
      const portrait = card.locator(".actor-portrait");
      await expect(portrait).toHaveAttribute("data-portrait", `arc-${role}`);
      await card.scrollIntoViewIfNeeded();
      await expect(portrait).toBeInViewport({ ratio: 1 });
      await portrait.screenshot({
        path: info.outputPath(`support-${role}-portrait.png`),
      });
    }
    await expect(page.locator("#train-scout .actor-portrait")).toHaveAttribute(
      "data-portrait",
      "unarmed",
    );
    await activate(page.locator("#train-medic"), touch);
    await advance(page, 0.1);
    await activate(page.locator("#train-mechanic"), touch);
    await advance(page, 12.5);
    const providers = await page.evaluate(() => {
      const sim = window.sessionHarness.view.simulation;
      return ["medic", "mechanic"].map((role) => ({
        id: sim.actors.find(
          ({ definitionId }) => definitionId === `arc-${role}`,
        )!.id,
        targetId: role === "medic" ? "trooper" : "harvester",
      }));
    });
    for (const { id, targetId } of providers) {
      await selectInSession(page, id);
      if (id === providers[0]!.id) {
        await activate(page.locator("#add-selection"), touch);
        await expect(page.locator("#selection-info")).toContainText(
          "Turn off Add units",
        );
        await activate(page.locator("#add-selection"), touch);
        await activate(page.locator("#box-select"), touch);
        await expect(page.locator("#selection-info")).toContainText(
          "Turn off Box select",
        );
        await activate(page.locator("#box-select"), touch);
        await page.evaluate(() => window.sessionHarness.view.pause());
        await expect(page.locator("#selection-info")).toContainText(
          "Resume the mission",
        );
        await page.evaluate(() => window.sessionHarness.view.resume());
      }
      await activate(page.locator("#focus-selection"), touch);
      await advance(page, 0.5);
      let target = await actorPoint(page, targetId);
      expect(target.clear).toBe(true);
      await activate(page.locator("#queue-orders"), touch);
      target = await actorPoint(page, targetId);
      await pressPoint(page, target, touch);
      await advance(page, 0.1);
      await expect(page.locator("#movement-status")).toContainText(
        "Support order queued",
      );
      expect(
        await page.evaluate(
          (id) => window.sessionHarness.view.simulation.actorById(id)!.orders,
          id,
        ),
      ).toEqual([{ kind: "service", targetId }]);
      await activate(page.locator("#queue-orders"), touch);
      target = await actorPoint(page, targetId);
      await pressPoint(page, target, touch);
      await advance(page, 0.1);
      await expect(page.locator("#movement-status")).toContainText(
        "Support target prioritized",
      );
      expect(
        await page.evaluate(
          (id) =>
            window.sessionHarness.view.simulation.actorById(id)!.service
              ?.manual,
          id,
        ),
      ).toBe(true);
      await expect(page.locator("#selection-info")).toContainText(
        /(Servicing|Approaching)/,
      );
      await activate(page.locator("#stop-units"), touch);
      await advance(page, 0.1);
      await expect(page.locator("#movement-status")).toHaveText(
        "Selected units stopped.",
      );
    }
    const health = await page.evaluate(() =>
      ["trooper", "harvester"].map(
        (id) => window.sessionHarness.view.simulation.actorById(id)!.health!,
      ),
    );
    await advance(page, 2);
    const recovered = await page.evaluate(() =>
      ["trooper", "harvester"].map(
        (id) => window.sessionHarness.view.simulation.actorById(id)!.health!,
      ),
    );
    expect(recovered[0]).toBeGreaterThan(health[0]);
    expect(recovered[1]).toBeGreaterThan(health[1]);
    await page.screenshot({ path: info.outputPath("support-controls.png") });
    expect(errors).toEqual([]);
  });
});
