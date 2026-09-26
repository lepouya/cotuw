import { expect, test } from "@playwright/test";

import type { Page } from "@playwright/test";
import type { AbstractMesh } from "@babylonjs/core";
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

test("starts with stand-ins while actor models load", async ({ page }) => {
  let releaseLoads = () => {};
  const heldLoads = new Promise<void>((resolve) => {
    releaseLoads = resolve;
  });
  let actorRequests = 0;
  await page.route("**/assets/actors/*.glb", async (route) => {
    actorRequests += 1;
    await heldLoads;
    await route.continue();
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });
  const canvas = page.locator("#game-canvas");
  await expect(canvas).toHaveAttribute("data-terrain-ready", "true");
  await expect(canvas).toHaveAttribute("data-actor-ready", "true");
  await expect.poll(() => actorRequests).toBeGreaterThan(0);
  expect(
    await page.evaluate(async () => {
      const harnessPath: string = "/e2e/harness.ts";
      const { EngineStore } = await import(harnessPath);
      const scene = EngineStore.Instances[0].scenes[0];
      return scene
        .getTransformNodeByName("actor-prototype-trooper-root")!
        .getChildMeshes()
        .every((mesh: AbstractMesh) => mesh.skeleton === null);
    }),
  ).toBe(true);

  releaseLoads();
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const harnessPath: string = "/e2e/harness.ts";
        const { EngineStore } = await import(harnessPath);
        const scene = EngineStore.Instances[0].scenes[0];
        return scene
          .getTransformNodeByName("actor-prototype-trooper-root")!
          .getChildMeshes()
          .some((mesh: AbstractMesh) => mesh.skeleton !== null);
      }),
    )
    .toBe(true);
});

test("replaces each stand-in when its own model loads", async ({ page }) => {
  let releaseScout = () => {};
  const heldScout = new Promise<void>((resolve) => {
    releaseScout = resolve;
  });
  await page.route("**/assets/actors/arc-scout.glb", async (route) => {
    await heldScout;
    await route.continue();
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#game-canvas")).toHaveAttribute(
    "data-actor-ready",
    "true",
  );
  const hasSkin = (actorId: string) =>
    page.evaluate(async (id) => {
      const harnessPath: string = "/e2e/harness.ts";
      const { EngineStore } = await import(harnessPath);
      const scene = EngineStore.Instances[0].scenes[0];
      return scene
        .getTransformNodeByName(`actor-${id}-root`)
        ?.getChildMeshes()
        .some((mesh: AbstractMesh) => mesh.skeleton !== null);
    }, actorId);

  await expect.poll(() => hasSkin("prototype-trooper")).toBe(true);
  expect(await hasSkin("prototype-scout")).toBe(false);

  releaseScout();
  await expect.poll(() => hasSkin("prototype-scout")).toBe(true);
});

test("clicking a selected actor issues terrain-aware movement", async ({
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
    const view = (await createTerrainPrototype(canvas, minimap)) as GameView;
    await frames(2);

    const trooper = view.scene.getTransformNodeByName(
      "actor-prototype-trooper-root",
    )!;
    const scout = view.scene.getTransformNodeByName(
      "actor-prototype-scout-root",
    )!;
    const trooperSkin = trooper.getChildMeshes().find((mesh) => mesh.skeleton)!;
    const scoutSkin = scout.getChildMeshes().find((mesh) => mesh.skeleton)!;
    const rigsIndependent =
      trooperSkin.skeleton !== scoutSkin.skeleton &&
      trooperSkin
        .skeleton!.bones.find((bone) => bone.name === "left-leg")!
        .getTransformNode()!
        .isDescendantOf(trooper);
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
    const trooperScreen = pointOnScreen(
      trooper.getAbsolutePosition().add(new Vector3(0, 1.3, 0)),
    );
    const scoutScreen = pointOnScreen(
      scout.getAbsolutePosition().add(new Vector3(0, 1.1, 0)),
    );
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
      rigsIndependent,
      scout: scoutScreen,
      scoutTerrain: pointOnScreen(scoutTarget),
      trooper: trooperScreen,
      trooperTerrain: pointOnScreen(trooperTarget),
    };
  });

  expect(targets.rigsIndependent).toBe(true);

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
    const scene = window.actorInteractionTest?.view.scene;
    return Boolean(
      scene?.getMeshByName("movement-path-route") &&
      scene.getMeshByName("movement-path-destination"),
    );
  });
  const legSwing = await page.evaluate(async () => {
    const scene = window.actorInteractionTest!.view.scene;
    const mesh = scene
      .getTransformNodeByName("actor-prototype-trooper-root")!
      .getChildMeshes()
      .find((candidate) => candidate.skeleton)!;
    const leg = mesh
      .skeleton!.bones.find((bone) => bone.name === "left-leg")!
      .getTransformNode()!;
    let largestRotation = 0;
    for (let frame = 0; frame < 20; frame++) {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
      largestRotation = Math.max(
        largestRotation,
        Math.abs(leg.rotationQuaternion?.x ?? 0),
      );
    }
    return largestRotation;
  });
  expect(legSwing).toBeGreaterThan(0.04);
  await page.waitForFunction(() => {
    const test = window.actorInteractionTest;
    if (!test) {
      return false;
    }

    const trooper = test.view.scene.getTransformNodeByName(
      "actor-prototype-trooper-root",
    );
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

    const scout = test.view.scene.getTransformNodeByName(
      "actor-prototype-scout-root",
    );
    return scout !== null && scout.getAbsolutePosition().x < test.initialScoutX;
  });

  const result = await page.evaluate(() => {
    const test = window.actorInteractionTest!;
    const trooper = test.view.scene.getTransformNodeByName(
      "actor-prototype-trooper-root",
    )!;
    const scout = test.view.scene.getTransformNodeByName(
      "actor-prototype-scout-root",
    )!;
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
