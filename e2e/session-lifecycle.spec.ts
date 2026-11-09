import { expect, test } from "./fixtures";
import { MissionDriver } from "./mission-driver";
import {
  collectPageErrors,
  dismissExplanation,
  openOpening,
  startOpening,
} from "./page-helpers";
import { WEBKIT } from "./tags";

import type { Page } from "@playwright/test";
import type { GameSession } from "../src/session";

const engineCount = (page: Page) =>
  page.evaluate(async () => {
    const { EngineStore } = await import("/e2e/harness.ts");
    return EngineStore.Instances.length;
  });

test(
  "startup and sidebar cleanup failures leave title navigation usable",
  { tag: WEBKIT },
  async ({ page }) => {
    const errors = collectPageErrors(page);
    const reported: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") reported.push(message.text());
    });
    await page.route(
      (url) => url.pathname === "/src/ui/sidebar.ts" && !url.search,
      (route) =>
        route.fulfill({
          contentType: "text/javascript",
          body: `
      import { createSidebar as original } from "/src/ui/sidebar.ts?original";
      export function createSidebar(...args) {
        const sidebar = original(...args);
        return { ...sidebar, dispose() {
          sidebar.dispose();
          throw new Error("Sidebar cleanup failed");
        } };
      }
    `,
        }),
    );
    await page.route(
      (url) => url.pathname === "/src/session.ts" && !url.search,
      (route) =>
        route.fulfill({
          contentType: "text/javascript",
          body: 'export async function createGameSession() { throw new Error("Session startup failed"); }',
        }),
    );
    await page.goto("/");
    await page.locator("#new-mission").click();
    await page.locator("#choose-arc").click();
    await expect(page.locator("#new-mission")).toBeVisible();
    await expect(page.locator("#new-mission")).toBeEnabled();
    await expect(page.locator("#game-menu-status")).toContainText(
      "could not start",
    );
    await page.locator("#open-options").click();
    await expect(page.locator("#audio-master-volume")).toBeFocused();
    expect(
      reported.some((message) => message.includes("Sidebar cleanup failed")),
    ).toBe(true);
    expect(
      reported.some((message) => message.includes("Session startup failed")),
    ).toBe(true);
    expect(errors).toEqual([]);
  },
);

test(
  "a departing session cannot publish a guide into its replacement",
  { tag: WEBKIT },
  async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.route(
      (url) => url.pathname === "/src/session.ts" && !url.search,
      (route) =>
        route.fulfill({
          contentType: "text/javascript",
          body: `
      import { createGameSession as original } from "/src/session.ts?original";
      export async function createGameSession(canvas, minimap, controls) {
        const session = await original(canvas, minimap, controls);
        const dispose = session.disposeAsync;
        session.disposeAsync = async () => {
          controls.onPopup?.({ id: "departing-guide", title: "Departing guide",
            text: "This belongs to the old mission.",
            trigger: { kind: "actor", definitionId: "arc-command-center" } });
          await dispose();
        };
        return session;
      }
    `,
        }),
    );
    await openOpening(page);
    await page.locator("#open-menu").click();
    await page.locator("#restart-mission").click();
    await expect(page.locator("#explanation-title")).toHaveText(
      "Welcome, Commander",
    );
    await page.locator("#dismiss-explanation").click();
    expect(errors).toEqual([]);
  },
);

for (const action of ["exit-mission", "restart-mission"]) {
  test(`a cleanup failure during ${action} leaves a usable title screen`, async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await openOpening(page);
    await page.evaluate(async () => {
      const { EngineStore } = await import("/e2e/harness.ts");
      const engine = EngineStore.Instances[0];
      const dispose = engine.dispose.bind(engine);
      engine.dispose = () => {
        dispose();
        throw new Error("Cleanup regression");
      };
    });
    await page.locator("#open-menu").click();
    await page.locator(`#${action}`).click();
    await expect(page.locator("#new-mission")).toBeEnabled();
    await expect(page.locator("#game-menu-title")).toHaveText(
      "Citadels of the Unquiet World",
    );
    expect(await engineCount(page)).toBe(0);
    await page.locator("#new-mission").click();
    await page.locator("#choose-arc").click();
    await expect(page.locator("#explanation-title")).toHaveText(
      "Welcome, Commander",
    );
    expect(errors).toEqual([]);
  });
}

for (const failure of ["simulation", "ready", "disposal"] as const)
  test(`${failure} failure releases the session and its controls`, async ({
    page,
  }) => {
    const mission = new MissionDriver(page);
    await mission.opening();
    const result = await page.evaluate(async (failure) => {
      const { EngineStore } = await import("/e2e/harness.ts");
      const { createGameSession } = await import("/src/session.ts");
      const { loadMission } = await import("/src/mission-loading.ts");
      const { LEVEL_SOURCES } = await import("/src/content/levels.ts");
      const loaded = loadMission(LEVEL_SOURCES.get("arc-economy-opening")!);
      if (failure === "simulation") loaded.state.tick = -1;
      const canvases = [
        document.createElement("canvas"),
        document.createElement("canvas"),
      ];
      for (const canvas of canvases) {
        canvas.width = 256;
        canvas.height = 256;
        document.body.append(canvas);
      }
      const enginesBefore = EngineStore.Instances.length;
      const controlsBefore = document.querySelectorAll(
        ".radial-menu, .selection-box",
      ).length;
      let disposed = 0;
      let created: GameSession | undefined;
      let error = "";
      try {
        await createGameSession(canvases[0], canvases[1], {
          mission: loaded,
          onDispose: () => disposed++,
          onReady: (session) => {
            created = session;
            if (failure === "disposal")
              created.pause = () => {
                throw new Error("pause failed");
              };
            else throw new Error("ready failed");
          },
        });
        if (failure === "disposal") await created!.disposeAsync();
      } catch (fault) {
        error = (fault as Error).message;
      }
      let mutationError = "";
      try {
        created?.simulation.submitCommand({ kind: "stop", actorId: "missing" });
      } catch (fault) {
        mutationError = (fault as Error).message;
      }
      const prevented = !canvases[0].dispatchEvent(
        new Event("contextmenu", { cancelable: true }),
      );
      for (const canvas of canvases) canvas.remove();
      return {
        error,
        mutationError,
        disposed,
        prevented,
        extraEngines: EngineStore.Instances.length - enginesBefore,
        extraControls:
          document.querySelectorAll(".radial-menu, .selection-box").length -
          controlsBefore,
      };
    }, failure);
    expect(result.error).toContain(
      {
        simulation: "state tick",
        ready: "ready failed",
        disposal: "pause failed",
      }[failure],
    );
    expect(result.disposed).toBe(1);
    expect(result.extraEngines).toBe(0);
    expect(result.extraControls).toBe(0);
    expect(result.prevented).toBe(false);
    if (failure !== "simulation")
      expect(result.mutationError).toContain("disposed");
    await mission.advance(1);
    await expect(page.locator("#mission-time")).toHaveText("0:01");
  });

test("repeated loads, restarts, and returns to title release each session", async ({
  page,
}) => {
  const errors = collectPageErrors(page);
  await openOpening(page);
  const cards = page.locator("#building-options > *");
  const cardCount = await cards.count();
  expect(cardCount).toBeGreaterThan(0);
  const notifications = page.locator("#notifications > *");
  await page.keyboard.press("F5");
  await expect(notifications).toContainText(["Quick save complete"]);
  for (let round = 0; round < 3; round++) {
    await page.keyboard.press("F9");
    await expect(page.locator("#game-menu-title")).toHaveText("Mission loaded");
    expect(await engineCount(page)).toBe(1);
    await page.locator("#restart-mission").click();
    await dismissExplanation(page, "Welcome, Commander");
    expect(await engineCount(page)).toBe(1);
    await page.locator("#open-menu").click();
    await page.locator("#exit-mission").click();
    await expect(page.locator("#new-mission")).toBeEnabled();
    expect(await engineCount(page)).toBe(0);
    await startOpening(page);
    expect(await engineCount(page)).toBe(1);
    await expect(cards).toHaveCount(cardCount);
  }
  // A single application shortcut and session remain subscribed.
  await page.keyboard.press("F5");
  await expect(
    notifications.filter({ hasText: "Quick save complete" }),
  ).toHaveCount(1);
  expect(errors).toEqual([]);
});
