import { expect, test } from "./fixtures";
import { collectPageErrors, withoutApp } from "./page-helpers";
import { WEBKIT } from "./tags";

import type { Page } from "@playwright/test";
import type { GameSession } from "../src/session";

declare global {
  interface Window {
    presentation: GameSession;
  }
}

async function openPresentation(
  page: Page,
  levelId = "arc-economy-opening",
  variant?: "healing" | "harvester",
) {
  const errors = collectPageErrors(page, { console: true });
  // The spec owns the session on the production HTML.
  await withoutApp(page);
  await page.goto("/");
  await page.evaluate(
    async ({ levelId, variant }) => {
      const { startSidebarSession } = await import("/e2e/sidebar-session.ts");
      const { level, placeBuildings, missionMap } =
        await import("/e2e/missions.ts");
      const { SIMULATION_TICK_SECONDS, secondsToTicks } =
        await import("/src/simulation/clock.ts");
      const mission = level(levelId);
      if (levelId === "arc-economy-opening") {
        placeBuildings(mission, [
          {
            actorId: "blueprint",
            definitionId: "arc-field-barracks",
            origin: { x: 16, z: 50 },
          },
        ]);
        const actor = (id: string) =>
          mission.state.actors.find((each) => each.id === id)!;
        const barracks = mission.definitions.find(
          ({ id }) => id === "arc-field-barracks",
        )!;
        const totalTicks = secondsToTicks(
          barracks.constructionSeconds,
          SIMULATION_TICK_SECONDS,
        );
        // The second of three stages cuts the building at half height.
        actor("blueprint").construction = {
          paidCost: barracks.materialsCost!,
          completedTicks: Math.round(totalTicks / 2),
          totalTicks,
        };
        actor("starting-command-center").health = 500;
      }
      if (variant) {
        const { createActor } = await import("/src/simulation/actor.ts");
        const map = missionMap(mission);
        if (variant === "healing") {
          mission.state.tick = 600;
          const wolf = mission.state.actors.find(
            ({ id }) => id === "lone-wolf",
          )!;
          wolf.health = 50;
          wolf.territory!.mode = "regenerating";
          wolf.territory!.lastCombatTick = 0;
          mission.state.actors.push(
            createActor({
              id: "watcher",
              definitionId: "arc-scout",
              owner: "player",
              worldPosition: {
                x: wolf.worldPosition.x + 9,
                z: wolf.worldPosition.z,
              },
            }),
          );
        } else {
          placeBuildings(mission, [
            {
              actorId: "present-refinery",
              definitionId: "arc-materials-refinery",
              origin: { x: 12, z: 54 },
            },
          ]);
          mission.state.actors.push(
            createActor({
              id: "present-worker",
              definitionId: "arc-harvester",
              owner: "player",
              worldPosition: map.tileCenter(13, 56),
            }),
          );
          mission.state.economy!.harvesters.push({
            actorId: "present-worker",
            refineryId: "present-refinery",
            cargo: 100,
            cargoSources: [
              {
                siteId: mission.state.economy!.sites[0].id,
                amount: 100_000,
              },
            ],
            gatherProgress: 0,
            targetSiteId: mission.state.economy!.sites[0].id,
            phase: "returning",
          });
        }
      }
      const { view } = await startSidebarSession(mission, {
        startPaused: true,
      });
      window.presentation = view;
    },
    { levelId, variant },
  );
  await expect(page.locator("#game-canvas")).toHaveAttribute(
    "data-models-ready",
    "true",
    { timeout: 20_000 },
  );
  // A few rendered frames compile the clipped and translucent materials.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        let frames = 0;
        const observer = window.presentation.scene.onAfterRenderObservable.add(
          () => {
            if (++frames < 5) return;
            window.presentation.scene.onAfterRenderObservable.remove(observer);
            resolve();
          },
        );
      }),
  );
  return errors;
}

async function freezePresentationTime(page: Page) {
  await page.evaluate(async () => {
    const { controlSessionClock } = await import("/e2e/harness.ts");
    controlSessionClock(window.presentation);
    window.presentation.resume();
  });
}

test(
  "blueprints, damage, and birds render with their generated props",
  { tag: WEBKIT },
  async ({ page }) => {
    const errors = await openPresentation(page);
    const shown = await page.evaluate(() => {
      const { scene } = window.presentation;
      const node = (name: string) => scene.getTransformNodeByName(name);
      const quarters = scene.getMeshByName(
        "tile-placed-actor-blueprint-root-model-barracks-quarters",
      );
      return {
        scaffold: !!node("tile-placed-actor-blueprint-root-scaffold"),
        clipped: !!quarters?.material?.clipPlane,
        smoke: scene.transformNodes.filter(
          ({ name }) =>
            name.startsWith("damage-starting-command-center-smoke-") &&
            name.split("-").length === 6,
        ).length,
        fire: !!node("damage-starting-command-center-fire"),
        birds: scene.transformNodes.filter(({ name }) =>
          /^bird-0-\d$/.test(name),
        ).length,
      };
    });
    expect(shown).toEqual({
      scaffold: true,
      clipped: true,
      smoke: 12,
      fire: true,
      birds: 4,
    });
    expect(errors).toEqual([]);
  },
);

test("a building placed and producing in one tick plays its generated exit clip", async ({
  page,
}) => {
  const errors = await openPresentation(page, "sandbox");
  await page.evaluate(() => {
    const session = window.presentation;
    session.simulation.submitCommand(
      {
        kind: "place-actor",
        actorId: "new-barracks",
        definitionId: "arc-field-barracks",
        origin: { x: 12, z: 12 },
      },
      { owner: session.simulation.playerOwner },
    );
    session.simulation.submitCommand(
      {
        kind: "train-unit",
        actorId: "new-trooper",
        producerId: "new-barracks",
        definitionId: "arc-trooper",
      },
      { owner: session.simulation.playerOwner },
    );
    session.resume();
  });
  await expect
    .poll(() =>
      page.evaluate(() => {
        const door = window.presentation.scene.getMeshByName(
          "tile-placed-actor-new-barracks-root-model-barracks-entrance-leaf-1",
        );
        return Math.abs(door?.position.x ?? 0);
      }),
    )
    .toBeGreaterThan(0.4);
  await page.evaluate(() => window.presentation.pause());
  expect(
    await page.evaluate(
      () => !!window.presentation.simulation.actorById("new-trooper"),
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("resuming keeps a paused unit at its committed pose", async ({ page }) => {
  const errors = await openPresentation(page, "arc-economy-opening", "healing");
  await freezePresentationTime(page);
  const positions = await page.evaluate(() => {
    const { simulation, scene } = window.presentation;
    const start = simulation.actorById("watcher")!.worldPosition;
    simulation.submitCommand(
      {
        kind: "move",
        actorId: "watcher",
        target: { x: start.x, z: start.z - 1 },
      },
      { owner: simulation.playerOwner },
    );
    window.sessionHarness.now += 20;
    scene.render();
    const root = scene.getTransformNodeByName("actor-watcher-root")!;
    const moving = root.position.z;
    window.presentation.pause();
    scene.render();
    const paused = root.position.z;
    window.presentation.resume();
    scene.render();
    const resumed = root.position.z;
    window.sessionHarness.now += 20;
    scene.render();
    return { moving, paused, resumed, next: root.position.z };
  });
  expect(positions.paused).toBeLessThan(positions.moving);
  expect(positions.resumed).toBeCloseTo(positions.paused, 8);
  expect(positions.next).toBeLessThan(positions.resumed);
  expect(errors).toEqual([]);
});

test("committed combat animates both survivors, aiming, and wolf pursuit", async ({
  page,
}) => {
  const errors = await openPresentation(page);
  await page.evaluate(async () => {
    const { createActor } = await import("/src/simulation/actor.ts");
    const session = window.presentation;
    session.simulation.spawnActor(
      createActor({
        id: "duelist",
        definitionId: "arc-trooper",
        owner: "player",
        worldPosition: { x: -9.5, z: -17.5 },
      }),
    );
    session.camera.focusOnTile(43, 32);
  });
  await freezePresentationTime(page);
  const observed = await page.evaluate(() => {
    const session = window.presentation;
    const { scene } = session;
    const played = new Set<string>();
    for (let frame = 0; frame < 160; frame++) {
      window.sessionHarness.now += 50;
      scene.render();
      for (const group of scene.animationGroups)
        if (group.weight > 0) played.add(group.name);
    }
    session.pause();
    return {
      targetHit: played.has("actor-lone-wolf-hit"),
      trooperHit: played.has("actor-duelist-hit"),
      aimed: played.has("actor-duelist-aim"),
      ran: played.has("actor-lone-wolf-run"),
    };
  });
  expect(observed).toEqual({
    targetHit: true,
    trooperHit: true,
    aimed: true,
    ran: true,
  });
  expect(errors).toEqual([]);
});

test("loaded healing shows a frozen cue and removes it when the wolf becomes hidden", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const errors = await openPresentation(page, "arc-economy-opening", "healing");
  await page.evaluate(() => window.presentation.camera.focusOnTile(46, 32));
  await page.screenshot({ path: testInfo.outputPath("wolf-regeneration.png") });
  await freezePresentationTime(page);
  const observed = await page.evaluate(() => {
    const session = window.presentation;
    const { scene } = session;
    scene.render();
    const mark = scene.getTransformNodeByName(
      "regeneration-lone-wolf-model-healing-mark-0",
    )!;
    const height = mark.position.y;
    window.sessionHarness.now += 100;
    scene.render();
    const held = mark.position.y === height;
    session.simulation.submitCommand(
      {
        kind: "move",
        actorId: "watcher",
        target: { x: 5.5, z: 0 },
      },
      { owner: session.simulation.playerOwner },
    );
    for (let frame = 0; frame < 60; frame++) {
      window.sessionHarness.now += 100;
      scene.render();
    }
    session.pause();
    return {
      held,
      hidden: !session.simulation.detects(
        "player",
        session.simulation.actorById("lone-wolf")!,
      ),
      removed: !scene.getTransformNodeByName("regeneration-lone-wolf"),
      stillHealing:
        session.simulation.actorById("lone-wolf")!.territory?.mode ===
        "regenerating",
    };
  });
  expect(observed).toEqual({
    held: true,
    hidden: true,
    removed: true,
    stillHealing: true,
  });
  expect(errors).toEqual([]);
});

test("a committed delivery unloads the Harvester, gathering deploys it, and Stop stows it", async ({
  page,
}) => {
  const errors = await openPresentation(
    page,
    "arc-economy-opening",
    "harvester",
  );
  await freezePresentationTime(page);
  const observed = await page.evaluate(() => {
    const session = window.presentation;
    const { scene } = session;
    const played = new Set<string>();
    let stopped = false;
    for (let frame = 0; frame < 180; frame++) {
      window.sessionHarness.now += 100;
      scene.render();
      for (const group of scene.animationGroups)
        if (group.weight > 0) played.add(group.name);
      if (!stopped && played.has("actor-present-worker-harvest")) {
        session.simulation.submitCommand(
          {
            kind: "stop",
            actorId: "present-worker",
          },
          { owner: session.simulation.playerOwner },
        );
        stopped = true;
      }
    }
    session.pause();
    return {
      unloaded: played.has("actor-present-worker-unload"),
      deployed: played.has("actor-present-worker-deploy"),
      harvested: played.has("actor-present-worker-harvest"),
      stowed: played.has("actor-present-worker-stow"),
      deposited: session.simulation.economy!.deposited[0]?.amount ?? 0,
      drillHeight: scene.getTransformNodeByName(
        "actor-present-worker-harvester-drill",
      )!.position.y,
    };
  });
  expect(observed).toMatchObject({
    unloaded: true,
    deployed: true,
    harvested: true,
    stowed: true,
    deposited: 100,
  });
  expect(observed.drillHeight).toBeCloseTo(0.65);
  expect(errors).toEqual([]);
});
