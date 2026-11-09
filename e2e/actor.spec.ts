import { expect, test } from "./fixtures";
import { holdRequests, trainTestUnits } from "./page-helpers";

import type { GameSession } from "../src/session";

type ActorInteractionTest = {
  canvas: HTMLCanvasElement;
  initialScoutX: number;
  initialTrooperX: number;
  minimap: HTMLCanvasElement;
  view: GameSession;
};

declare global {
  interface Window {
    actorInteractionTest?: ActorInteractionTest;
  }
}

test.use({ deviceScaleFactor: 2 });

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

  await page.goto("/?level=sandbox", { waitUntil: "domcontentloaded" });
  const canvas = page.locator("#game-canvas");
  await expect(canvas).toHaveAttribute("data-terrain-ready", "true");
  await expect(canvas).toHaveAttribute("data-actor-ready", "true");
  await expect.poll(() => actorRequests).toBeGreaterThan(0);
  await trainTestUnits(page, ["trooper"]);
  await page.locator("#unit-roster button").click();
  await expect(canvas).toHaveAttribute("data-selected-actor", "trained-unit-1");
  expect(
    await page.evaluate(async () => {
      const { gameScene } = await import("/e2e/harness.ts");
      const scene = gameScene();
      return scene
        .getTransformNodeByName("actor-trained-unit-1-root")!
        .getChildMeshes()
        .every((mesh) => mesh.skeleton === null);
    }),
  ).toBe(true);

  releaseLoads();
  await expect
    .poll(
      async () =>
        page.evaluate(async () => {
          const { gameScene } = await import("/e2e/harness.ts");
          const scene = gameScene();
          return scene
            .getTransformNodeByName("actor-trained-unit-1-root")!
            .getChildMeshes()
            .some((mesh) => mesh.skeleton !== null);
        }),
      { timeout: 10_000 },
    )
    .toBe(true);
});

test("replaces each stand-in when its own model loads", async ({ page }) => {
  const releaseScout = await holdRequests(
    page,
    "**/assets/actors/arc-scout.glb",
  );

  await page.goto("/?level=sandbox", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#game-canvas")).toHaveAttribute(
    "data-actor-ready",
    "true",
  );
  await trainTestUnits(page);
  const hasSkin = (actorId: string) =>
    page.evaluate(async (id) => {
      const { gameScene } = await import("/e2e/harness.ts");
      const scene = gameScene();
      return scene
        .getTransformNodeByName(`actor-${id}-root`)
        ?.getChildMeshes()
        .some((mesh) => mesh.skeleton !== null);
    }, actorId);

  await expect
    .poll(() => hasSkin("trained-unit-1"), { timeout: 15_000 })
    .toBe(true);
  expect(await hasSkin("trained-unit-2")).toBe(false);

  releaseScout();
  await expect
    .poll(() => hasSkin("trained-unit-2"), { timeout: 15_000 })
    .toBe(true);
});

test("clicking a selected actor issues terrain-aware movement", async ({
  page,
}) => {
  await page.goto("/?level=sandbox");
  const targets = await page.evaluate(async () => {
    const { Vector3, frames, projectToCanvas } =
      await import("/e2e/harness.ts");
    const { createGameSession } = await import("/src/session.ts");
    const { level, missionMap } = await import("/e2e/missions.ts");
    const mission = level("sandbox");
    const { createActor } = await import("/src/simulation/actor.ts");
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
    const view = await createGameSession(canvas, minimap, {
      mission,
    });
    const map = missionMap(mission);
    view.simulation.spawnActor(
      createActor({
        id: "prototype-trooper",
        definitionId: "arc-trooper",
        owner: "player",
        worldPosition: map.tileCenter(46, 40),
      }),
    );
    view.simulation.spawnActor(
      createActor({
        id: "prototype-scout",
        definitionId: "arc-scout",
        owner: "player",
        worldPosition: map.tileCenter(55, 45),
      }),
    );
    await frames(2);

    // This interaction checks rigged meshes, which replace the stand-ins.
    for (const id of ["prototype-trooper", "prototype-scout"])
      while (
        !view.scene
          .getTransformNodeByName(`actor-${id}-root`)
          ?.getChildMeshes()
          .some((mesh) => mesh.skeleton)
      )
        await frames(1);
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
      const { x, y } = projectToCanvas(view.scene, canvas, point);
      return { clientX: x, clientY: y };
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
  // Repeated clicks retain selection; Shift-click removes the unit.
  await page.mouse.click(targets.trooper.clientX, targets.trooper.clientY);
  await page.waitForFunction(
    () =>
      window.actorInteractionTest?.canvas.dataset.selectedActor ===
      "prototype-trooper",
  );
  await page.keyboard.down("Shift");
  await page.mouse.click(targets.trooper.clientX, targets.trooper.clientY);
  await page.keyboard.up("Shift");
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
    const { frames } = await import("/e2e/harness.ts");
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
      await frames(1);
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
    if (!test) return false;
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
    if (!test) return false;
    const scout = test.view.scene.getTransformNodeByName(
      "actor-prototype-scout-root",
    );
    return scout !== null && scout.getAbsolutePosition().x < test.initialScoutX;
  });

  const result = await page.evaluate(async () => {
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

    await test.view.disposeAsync();
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
