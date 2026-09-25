import { expect, test } from "@playwright/test";

import type { Page } from "@playwright/test";
import type { GameView } from "../src/render";

type ActorInteractionTest = {
  canvas: HTMLCanvasElement;
  initialScoutX: number;
  initialTrooperX: number;
  minimap: HTMLCanvasElement;
  view: GameView;
};

declare global {
  interface Window {
    actorInteractionTest?: ActorInteractionTest;
  }
}

test.use({ deviceScaleFactor: 2 });

/** In-page test helpers, loaded by `openHarness`. */
declare const harness: typeof import("./harness");

async function openHarness(page: Page): Promise<void> {
  await page.goto("/");
  await page.evaluate(async () => {
    const harnessPath: string = "/e2e/harness.ts";
    Object.assign(window, { harness: await import(harnessPath) });
  });
}

test("clicking a selected actor issues direct terrain movement", async ({
  page,
}) => {
  await openHarness(page);

  const targets = await page.evaluate(async () => {
    const { Matrix, Vector3, frames } = harness;
    const prototypePath: string = "/src/prototype.ts";
    const { createTerrainPrototype } = await import(prototypePath);
    const canvas = document.createElement("canvas");
    const minimap = document.createElement("canvas");
    Object.assign(canvas.style, {
      position: "fixed",
      top: "0",
      left: "0",
      zIndex: "20",
      width: "640px",
      height: "480px",
    });
    document.body.append(canvas, minimap);
    const view = createTerrainPrototype(canvas, minimap);
    await frames(2);

    const trooper = view.scene.getMeshByName("actor-prototype-trooper")!;
    const scout = view.scene.getMeshByName("actor-prototype-scout")!;
    const pointOnScreen = (
      point: ReturnType<typeof trooper.getAbsolutePosition>,
    ) => {
      const projected = Vector3.Project(
        point,
        Matrix.Identity(),
        view.scene.getTransformMatrix(),
        view.scene.activeCamera!.viewport.toGlobal(
          view.engine.getRenderWidth(),
          view.engine.getRenderHeight(),
        ),
      );
      return {
        clientX:
          projected.x * (canvas.clientWidth / view.engine.getRenderWidth()),
        clientY:
          projected.y * (canvas.clientHeight / view.engine.getRenderHeight()),
      };
    };
    const trooperScreen = pointOnScreen(trooper.getAbsolutePosition());
    const scoutScreen = pointOnScreen(scout.getAbsolutePosition());
    const trooperTarget = new Vector3(4, 0, -10);
    const scoutTarget = new Vector3(0, 0, -5);
    window.actorInteractionTest = {
      canvas,
      initialScoutX: scout.getAbsolutePosition().x,
      initialTrooperX: trooper.getAbsolutePosition().x,
      minimap,
      view,
    };
    return {
      scout: scoutScreen,
      scoutTerrain: pointOnScreen(scoutTarget),
      trooper: trooperScreen,
      trooperTerrain: pointOnScreen(trooperTarget),
    };
  });

  await page.mouse.click(targets.trooper.clientX, targets.trooper.clientY);
  await page.waitForFunction(
    () =>
      window.actorInteractionTest?.canvas.dataset.selectedActor ===
      "prototype-trooper",
  );
  // Clicking the selected actor again deselects it.
  await page.mouse.click(targets.trooper.clientX, targets.trooper.clientY);
  await page.waitForFunction(
    () => window.actorInteractionTest?.canvas.dataset.actorSelected === "false",
  );
  await page.mouse.click(targets.trooper.clientX, targets.trooper.clientY);
  await page.waitForFunction(
    () =>
      window.actorInteractionTest?.canvas.dataset.selectedActor ===
      "prototype-trooper",
  );
  await page.mouse.click(
    targets.trooperTerrain.clientX,
    targets.trooperTerrain.clientY,
  );
  await page.waitForFunction(
    () => window.actorInteractionTest?.canvas.dataset.actorTarget !== undefined,
  );
  await page.waitForFunction(() => {
    const test = window.actorInteractionTest;
    if (!test) {
      return false;
    }

    const trooper = test.view.scene.getMeshByName("actor-prototype-trooper");
    return (
      trooper !== null && trooper.getAbsolutePosition().x > test.initialTrooperX
    );
  });
  await page.mouse.click(targets.scout.clientX, targets.scout.clientY);
  await page.waitForFunction(
    () =>
      window.actorInteractionTest?.canvas.dataset.selectedActor ===
      "prototype-scout",
  );
  await page.mouse.click(
    targets.scoutTerrain.clientX,
    targets.scoutTerrain.clientY,
  );
  await page.waitForFunction(() => {
    const test = window.actorInteractionTest;
    if (!test) {
      return false;
    }

    const scout = test.view.scene.getMeshByName("actor-prototype-scout");
    return scout !== null && scout.getAbsolutePosition().x < test.initialScoutX;
  });

  const result = await page.evaluate(() => {
    const test = window.actorInteractionTest!;
    const trooper = test.view.scene.getMeshByName("actor-prototype-trooper")!;
    const scout = test.view.scene.getMeshByName("actor-prototype-scout")!;
    const result = {
      selected: test.canvas.dataset.actorSelected,
      selectedActor: test.canvas.dataset.selectedActor,
      initialScoutX: test.initialScoutX,
      initialTrooperX: test.initialTrooperX,
      scoutX: scout.getAbsolutePosition().x,
      trooperX: trooper.getAbsolutePosition().x,
    };

    test.view.dispose();
    test.canvas.remove();
    test.minimap.remove();
    window.actorInteractionTest = undefined;
    return result;
  });

  expect(result.selected).toBe("true");
  expect(result.selectedActor).toBe("prototype-scout");
  expect(result.trooperX).toBeGreaterThan(result.initialTrooperX);
  expect(result.scoutX).toBeLessThan(result.initialScoutX);
});
