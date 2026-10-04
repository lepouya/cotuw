import { expect, test } from "@playwright/test";
import { importMission, placeBuilding } from "./prototype-helpers";

import type { Page } from "@playwright/test";

const materials = (page: Page) => page.locator("#materials-counter");

async function openLoadPanel(page: Page) {
  await page.locator("#open-menu").click();
  await page.locator("#load-mission").click();
  await expect(page.locator("#save-entries li").first()).toBeVisible();
}

test("manual saves and the quicksave restore earlier progress", async ({
  page,
}) => {
  await page.goto("/");
  const canvas = page.locator("#game-canvas");
  await expect(canvas).toHaveAttribute("data-terrain-ready", "true");
  await page.locator("#open-menu").click();
  await expect(page.locator("#game-menu-title")).toHaveText("Paused");
  await page.locator("#save-mission").click();
  await page.locator("#save-name").fill("Opening");
  await page.locator("#confirm-save").click();
  await expect(page.locator("#game-menu-status")).toHaveText(
    "Manual save complete: Opening",
  );
  await page.locator("#resume-mission").click();
  await page.keyboard.press("F5");
  await expect(page.locator("#save-status")).toHaveText(
    "Quick save complete: Quicksave",
  );
  await placeBuilding(page, "build-refinery", 12, 49);
  await expect(materials(page)).toHaveText("50");

  await page.keyboard.press("F9");
  await expect(page.locator("#game-menu-title")).toHaveText("Mission loaded");
  await expect(materials(page)).toHaveText("150");
  await page.locator("#resume-mission").click();
  await placeBuilding(page, "build-refinery", 12, 49);
  await expect(materials(page)).toHaveText("50");

  await openLoadPanel(page);
  const entries = page.locator("#save-entries li");
  await expect(entries).toHaveCount(2);
  await expect(entries.nth(0)).toContainText("Quick · Quicksave");
  await expect(entries.nth(1)).toContainText("Manual · Opening");
  await expect(entries.nth(1)).toContainText("Clear the wolf threat");
  await entries.nth(1).getByRole("button", { name: "Load" }).click();
  await expect(page.locator("#game-menu-title")).toHaveText("Mission loaded");
  await expect(materials(page)).toHaveText("150");

  await page.locator("#load-mission").click();
  const quick = page.locator("#save-entries li", { hasText: "Quicksave" });
  await quick.getByRole("button", { name: "Delete" }).click();
  await quick.getByRole("button", { name: "Confirm" }).click();
  await expect(entries).toHaveCount(1);
  await entries.first().getByRole("button", { name: "Delete" }).click();
  await entries.first().getByRole("button", { name: "Confirm" }).click();
  await expect(entries).toHaveText(["No saved missions yet."]);
});

test("completing an objective writes the autosave", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#game-canvas")).toHaveAttribute(
    "data-terrain-ready",
    "true",
  );
  const source = await page.evaluate(async () => {
    const missionsPath: string = "/e2e/missions.ts";
    const actorPath: string = "/src/simulation/actor.ts";
    const { level, missionSource } = (await import(
      missionsPath
    )) as typeof import("./missions");
    const { createActor } = (await import(
      actorPath
    )) as typeof import("../src/simulation/actor");
    const mission = level();
    const wolf = mission.state.actors.find(({ id }) => id === "lone-wolf")!;
    wolf.health = 1;
    mission.state.actors.push(
      createActor({
        id: "trooper-1",
        definitionId: "arc-trooper",
        worldPosition: {
          x: wolf.worldPosition.x - 1.5,
          z: wolf.worldPosition.z,
        },
      }),
    );
    mission.state.tick = 1;
    return missionSource(mission);
  });
  await importMission(page, source);
  await page.locator("#resume-mission").click();
  await expect(page.locator("#save-status")).toHaveText(
    "Auto save complete: Autosave: Defeat the lone wolf",
    { timeout: 15_000 },
  );
  await openLoadPanel(page);
  await expect(page.locator("#save-entries li")).toContainText([
    "Auto · Autosave: Defeat the lone wolf",
  ]);
});

test("export writes the current mission as a readable file", async ({
  page,
}) => {
  await page.goto("/?level=sandbox");
  await expect(page.locator("#game-canvas")).toHaveAttribute(
    "data-terrain-ready",
    "true",
  );
  await page.locator("#open-menu").click();
  await page.locator("#save-mission").click();
  await page.locator("#save-name").fill("Sandbox base");
  const download = page.waitForEvent("download");
  await page.locator("#export-mission").click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("Sandbox-base.json");
  const stream = await file.createReadStream();
  let source = "";
  for await (const chunk of stream) source += chunk;
  const saved = JSON.parse(source);
  expect(saved.save.name).toBe("Sandbox base");
  expect(saved.scenario.id).toBe("sandbox");
  expect(saved.state.terrain.tiles[0]).toMatch(/^#+$/);
  await page.locator("#cancel-save").click();
  await importMission(page, source);
  await expect(page.locator("#game-menu-title")).toHaveText("Mission loaded");
});

test("a tick-zero save does not replace the authored restart level", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("#game-canvas")).toHaveAttribute(
    "data-terrain-ready",
    "true",
  );
  const source = await page.evaluate(async () => {
    const path: string = "/e2e/missions.ts";
    const { level } = (await import(path)) as typeof import("./missions");
    const mission = level();
    mission.state.economy!.materials = 77;
    const serializerPath: string = "/src/simulation/mission-file.ts";
    const { serializeMission } = (await import(
      serializerPath
    )) as typeof import("../src/simulation/mission-file");
    return serializeMission(mission.scenario, mission.state, 1 / 60, {
      name: "Immediate save",
      savedAt: "2026-10-04T10:00:00Z",
    });
  });
  await importMission(page, source);
  await expect(materials(page)).toHaveText("77");
  await page.locator("#restart-mission").click();
  await expect(materials(page)).toHaveText("150");
});

test("invalid scenario metadata leaves the current session intact", async ({
  page,
}) => {
  await page.goto("/");
  const canvas = page.locator("#game-canvas");
  await expect(canvas).toHaveAttribute("data-terrain-ready", "true");
  const source = await page.evaluate(async () => {
    const path: string = "/e2e/missions.ts";
    const { level, missionSource } = (await import(
      path
    )) as typeof import("./missions");
    const file = JSON.parse(missionSource(level()));
    file.scenario.goals = [null];
    return JSON.stringify(file);
  });
  await importMission(page, source);
  await expect(page.locator("#game-menu-status")).toContainText(
    "Scenario goals",
  );
  await expect(materials(page)).toHaveText("150");
  await page.locator("#cancel-load").click();
  await page.locator("#resume-mission").click();
  await placeBuilding(page, "build-refinery", 12, 49);
  await expect(materials(page)).toHaveText("50");
});

test("opening and closing the menu during inspection preserves a way to resume", async ({
  page,
}) => {
  await page.goto("/?level=sandbox");
  await expect(page.locator("#game-canvas")).toHaveAttribute(
    "data-terrain-ready",
    "true",
  );
  const source = await page.evaluate(async () => {
    const path: string = "/e2e/missions.ts";
    const { level, missionSource } = (await import(
      path
    )) as typeof import("./missions");
    return missionSource(level("sandbox"));
  });
  await importMission(page, source);
  await page.locator("#inspect-loaded-mission").click();
  await page.locator("#open-menu").click();
  await expect(page.locator("#resume-mission")).toHaveText("Close");
  await page.locator("#resume-mission").click();
  await expect(page.locator("#resume-loaded-mission")).toBeVisible();
  await page.locator("#resume-loaded-mission").click();
  await placeBuilding(page, "build-barracks", 49, 39);
  await page.locator("#open-menu").click();
  await expect(page.locator("#resume-mission")).toHaveText("Resume");
});
