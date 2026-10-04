import { expect, test } from "@playwright/test";

declare global {
  interface Window {
    finishMissionRead: () => void;
  }
}

for (const action of ["restart", "exit", "newer load"] as const) {
  test(`a pending file read cannot override ${action}`, async ({ page }) => {
    await page.goto("/");
    const canvas = page.locator("#game-canvas");
    await expect(canvas).toHaveAttribute("data-terrain-ready", "true");
    const source = await page.evaluate(async () => {
      const contentPath: string = "/src/content/economy-scenario.ts";
      const scenarioPath: string = "/src/simulation/scenario.ts";
      const { ECONOMY_SCENARIO, ECONOMY_ACTOR_DEFINITIONS } = (await import(
        contentPath
      )) as typeof import("../src/content/economy-scenario");
      const { createScenarioState, serializeMission } = (await import(
        scenarioPath
      )) as typeof import("../src/simulation/scenario");
      const state = createScenarioState(
        ECONOMY_SCENARIO,
        ECONOMY_ACTOR_DEFINITIONS,
      );
      state.economy!.materials = 77;
      return serializeMission(state, 1 / 60);
    });
    const upload = async (name: string, data = source) => {
      await page.locator("#mission-save-file").setInputFiles({
        name,
        mimeType: "application/json",
        buffer: Buffer.from(data),
      });
    };
    await upload("initial.json");
    await expect(page.locator("#mission-result-title")).toHaveText(
      "Mission loaded",
    );
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
      const newer = JSON.parse(source);
      newer.state.economy.materials = 99;
      await upload("newer.json", JSON.stringify(newer));
      await expect(page.locator("#materials-counter")).toHaveText("99");
      await expect(page.locator("#restart-mission")).toBeEnabled();
      await page.locator("#inspect-loaded-mission").click();
    } else {
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
      await expect(page.locator("#mission-result-title")).toHaveText(
        "Mission ended",
      );
    } else {
      await expect(page.locator("#mission-result")).not.toBeVisible();
      await expect(page.locator("#materials-counter")).toHaveText(
        action === "restart" ? "150" : "99",
      );
    }
  });
}
