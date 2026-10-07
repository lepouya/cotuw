import { expect, test } from "@playwright/test";

import { MissionDriver } from "./mission-driver";

for (const failure of ["simulation", "ready"] as const)
  test(`failed ${failure} setup releases the session and its controls`, async ({
    page,
  }) => {
    const mission = new MissionDriver(page, false, false);
    await mission.opening();
    const result = await page.evaluate(async (failure) => {
      const harnessPath: string = "/e2e/harness.ts";
      const sessionPath: string = "/src/session.ts";
      const levelsPath: string = "/src/content/levels.ts";
      const { EngineStore } = await import(harnessPath);
      const { createGameSession, loadMission } = await import(sessionPath);
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
            throw new Error("ready failed");
          },
        });
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
      failure === "simulation" ? "state tick" : "ready failed",
    );
    expect(result.disposed).toBe(1);
    expect(result.extraEngines).toBe(0);
    expect(result.extraControls).toBe(0);
    expect(result.prevented).toBe(false);
    if (failure === "ready") expect(result.mutationError).toContain("disposed");
    await mission.advance(1);
    await expect(page.locator("#mission-time")).toHaveText("0:01");
  });
