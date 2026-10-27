import { expect, test } from "./fixtures";

import { MissionDriver } from "./mission-driver";
import { collectPageErrors, openOpening } from "./prototype-helpers";

for (const action of ["exit-mission", "restart-mission"]) {
  test(`a cleanup failure during ${action} leaves a usable title screen`, async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await openOpening(page);
    await page.evaluate(async () => {
      const path: string = "/e2e/harness.ts";
      const { EngineStore } = await import(path);
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
    expect(
      await page.evaluate(async () => {
        const path: string = "/e2e/harness.ts";
        const { EngineStore } = await import(path);
        return EngineStore.Instances.length;
      }),
    ).toBe(0);
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
    const mission = new MissionDriver(page, false, false);
    await mission.opening();
    const result = await page.evaluate(async (failure) => {
      const harnessPath: string = "/e2e/harness.ts";
      const sessionPath: string = "/src/session.ts";
      const loadingPath: string = "/src/mission-loading.ts";
      const levelsPath: string = "/src/content/levels.ts";
      const { EngineStore } = await import(harnessPath);
      const { createGameSession } = await import(sessionPath);
      const { loadMission } = await import(loadingPath);
      const { LEVEL_SOURCES } = await import(levelsPath);
      const loaded = loadMission(LEVEL_SOURCES.get("arc-economy-opening"));
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
      let created: any;
      let error = "";
      try {
        await createGameSession(canvases[0], canvases[1], {
          mission: loaded,
          onDispose: () => disposed++,
          onReady: (session: any) => {
            created = session;
            if (failure === "disposal")
              created.pause = () => {
                throw new Error("pause failed");
              };
            else throw new Error("ready failed");
          },
        });
        if (failure === "disposal") await created.disposeAsync();
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
      failure === "simulation"
        ? "state tick"
        : failure === "ready"
          ? "ready failed"
          : "pause failed",
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
