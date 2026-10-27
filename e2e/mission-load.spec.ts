import { expect, test } from "./fixtures";
import { openOpening, importMission } from "./prototype-helpers";
import type { MissionFile } from "../src/simulation/mission-file";

declare global {
  interface Window {
    finishMissionRead: () => void;
  }
}

for (const action of ["restart", "exit", "newer load"] as const) {
  test(`a pending file read cannot override ${action}`, async ({ page }) => {
    await openOpening(page);
    const canvas = page.locator("#game-canvas");
    await expect(canvas).toHaveAttribute("data-terrain-ready", "true");
    const source = await page.evaluate(async () => {
      const missionsPath: string = "/e2e/missions.ts";
      const { level, missionSource } = (await import(
        missionsPath
      )) as typeof import("./missions");
      const mission = level();
      mission.state.economy!.stockpiles[0].amount = 77;
      // A save, not a level, so loading it never replaces the restart level.
      mission.state.tick = 1;
      return missionSource(mission);
    });
    const upload = (name: string, data = source) =>
      importMission(page, data, name);
    await upload("initial.json");
    await expect(page.locator("#game-menu-title")).toHaveText("Mission loaded");
    await expect(canvas).toHaveAttribute("data-terrain-ready", "true");
    await expect(page.locator("#materials-counter")).toHaveText("77");
    await expect(page.locator("#restart-mission")).toBeEnabled();
    await page.evaluate((source) => {
      const text = File.prototype.text;
      const pending = new Promise<string>((resolve) => {
        window.finishMissionRead = () => resolve(source);
      });
      File.prototype.text = function () {
        return this.name === "slow.json" ? pending : text.call(this);
      };
    }, source);
    await upload("slow.json");
    if (action === "newer load") {
      const newer: MissionFile = JSON.parse(source);
      newer.state.economy!.stockpiles[0].amount = 99;
      await upload("newer.json", JSON.stringify(newer));
      await expect(page.locator("#materials-counter")).toHaveText("99");
      await expect(page.locator("#restart-mission")).toBeEnabled();
      await page.locator("#inspect-loaded-mission").click();
    } else {
      await page.locator("#cancel-load").click();
      await page
        .locator(action === "restart" ? "#restart-mission" : "#exit-mission")
        .click();
    }
    if (action === "restart") {
      await expect(canvas).toHaveAttribute("data-terrain-ready", "true");
      await expect(page.locator("#materials-counter")).toHaveText("150");
    }
    await page.evaluate(async () => {
      window.finishMissionRead();
      const path: string = "/e2e/harness.ts";
      const { frames } = await import(path);
      await frames(2);
    });
    if (action === "exit") {
      await expect(page.locator("#game-menu-title")).toHaveText(
        "Citadels of the Unquiet World",
      );
    } else {
      await expect(page.locator("#game-menu")).not.toBeVisible();
      await expect(page.locator("#materials-counter")).toHaveText(
        action === "restart" ? "150" : "99",
      );
    }
  });
}
