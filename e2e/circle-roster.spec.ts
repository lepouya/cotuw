import { expect, test } from "./fixtures";
import { forEachProfile, MOUSE_AND_PHONE_PROFILES } from "./profiles";
import { WEBKIT } from "./tags";
import {
  activate,
  actorPoint,
  advance,
  collectPageErrors,
  expectTerrainReady,
  pressPoint,
  selectInSession,
  withoutApp,
} from "./page-helpers";
import type { Page } from "@playwright/test";

/** A Circle base with each producer, a Thornspire, and damaged troops. */
async function opening(page: Page, health: Record<string, number> = {}) {
  await withoutApp(page);
  await page.goto("/");
  await page.evaluate(async (health) => {
    const { startSidebarSession } = await import("/e2e/sidebar-session.ts");
    const { level, withScenario } = await import("/e2e/missions.ts");
    const { controlSessionClock } = await import("/e2e/harness.ts");
    const { defineScenario } = await import("/src/simulation/scenario.ts");
    const { TerrainGrid } = await import("/src/simulation/terrain.ts");
    const map = new TerrainGrid({
      width: 32,
      height: 24,
      tileSize: 1,
      terrainTypeIds: ["plain", "path", "rough", "water"],
    });
    const scenario = defineScenario({
      id: "circle-roster-controls",
      content: level().scenario.content,
      tileSize: 1,
      terrainTypeIds: [...map.terrainTypeIds],
      terrain: map.terrainState(),
      owners: [
        { id: "player", faction: "circle" },
        { id: "raiders", faction: "arc" },
      ],
      playerOwner: "player",
      relationships: [
        { owners: ["player", "raiders"], relationship: "hostile" },
      ],
      stockpiles: [{ owners: ["player"], resource: "lifebloom", amount: 500 }],
      sites: [],
      loot: [],
      buildings: [
        {
          actorId: "heart",
          definitionId: "circle-heartgrove",
          origin: { x: 3, z: 6 },
        },
        {
          actorId: "muster",
          definitionId: "circle-musterhall",
          origin: { x: 9, z: 6 },
        },
        {
          actorId: "nursery",
          definitionId: "circle-construct-nursery",
          origin: { x: 13, z: 6 },
        },
        {
          actorId: "spire",
          definitionId: "circle-thornspire",
          origin: { x: 24, z: 6 },
        },
      ],
      units: [
        {
          actorId: "sentinel",
          definitionId: "circle-sentinel",
          tile: { x: 10, z: 13 },
        },
        {
          actorId: "ram",
          definitionId: "circle-briar-ram",
          tile: { x: 16, z: 14 },
        },
      ],
    });
    const mission = withScenario(level(), scenario);
    mission.state.actors.find(({ id }) => id === "sentinel")!.health = 20;
    mission.state.actors.find(({ id }) => id === "ram")!.health = 100;
    for (const [id, value] of Object.entries(health))
      mission.state.actors.find((actor) => actor.id === id)!.health = value;
    const { view } = await startSidebarSession(mission);
    controlSessionClock(view);
  }, health);
  await expectTerrainReady(page);
}

const idOf = (page: Page, definitionId: string, skipId?: string) =>
  page.evaluate(
    ({ definitionId, skipId }) =>
      window.sessionHarness.view.simulation.actors.find(
        (actor) => actor.definitionId === definitionId && actor.id !== skipId,
      )?.id,
    { definitionId, skipId },
  );

forEachProfile(MOUSE_AND_PHONE_PROFILES, ({ touch }) => {
  test(`Nursery shares its queue for Briar Rams and Artificers ${WEBKIT}`, async ({
    page,
  }, info) => {
    const errors = collectPageErrors(page, { console: true });
    await opening(page);
    await selectInSession(page, "muster");
    await activate(page.locator("#open-training"), touch);
    await expect(
      page.locator("#train-circle-healer .actor-portrait"),
    ).toHaveAttribute("data-portrait", "circle-healer");
    await expect(page.locator("#train-circle-healer")).toBeEnabled();
    await selectInSession(page, "nursery");
    await activate(page.locator("#open-training"), touch);
    const ram = page.locator("#train-circle-briar-ram");
    const artificer = page.locator("#train-circle-artificer");
    for (const [card, portrait] of [
      [ram, "circle-briar-ram"],
      [artificer, "circle-artificer"],
    ] as const) {
      await expect(card).toBeEnabled();
      await card.scrollIntoViewIfNeeded();
      await expect(card.locator(".actor-portrait")).toHaveAttribute(
        "data-portrait",
        portrait,
      );
      await card
        .locator(".actor-portrait")
        .screenshot({ path: info.outputPath(`${portrait}-portrait.png`) });
    }
    await expect(ram).toContainText("100 Lifebloom");
    const description = await ram.getAttribute("aria-describedby");
    await expect(page.locator(`#${description}`)).toContainText(
      "Batters buildings",
    );
    await activate(ram, touch);
    await advance(page, 0.1);
    await activate(artificer, touch);
    await advance(page, 12.5);
    expect(await idOf(page, "circle-briar-ram", "ram")).toBeDefined();
    expect(await idOf(page, "circle-artificer")).toBeUndefined();
    await advance(page, 6.5);
    const provider = (await idOf(page, "circle-artificer"))!;
    expect(provider).toBeDefined();
    await selectInSession(page, provider);
    await expect(page.locator("#selection-details")).toContainText("Artificer");
    // Keep the projection stable between locating the actor and sending input.
    await page.evaluate(async () => {
      const { Vector3 } = await import("/e2e/harness.ts");
      const { view } = window.sessionHarness;
      const { x, z } = view.simulation.actorById("ram")!.worldPosition;
      view.camera.focusOnPoint(new Vector3(x, 0, z));
    });
    await advance(page, 0.5);
    const target = await actorPoint(page, "ram", [1, 0.8, 0.5]);
    expect(target.clear).toBe(true);
    await pressPoint(page, target, touch);
    await advance(page, 0.1);
    await expect(page.locator("#movement-status")).toContainText(
      "Support target prioritized",
    );
    await expect(page.locator("#selection-info")).toContainText(
      /(Servicing|Approaching) Briar Ram/,
    );
    expect(errors).toEqual([]);
  });
});

test(`Healer and Artificer service shows Circle cues ${WEBKIT}`, async ({
  page,
}, info) => {
  const errors = collectPageErrors(page, { console: true });
  await opening(page);
  await page.evaluate(async () => {
    const { createActor } = await import("/src/simulation/actor.ts");
    const { view } = window.sessionHarness;
    const { simulation } = view;
    const sentinel = simulation.actorById("sentinel")!.worldPosition;
    const ram = simulation.actorById("ram")!.worldPosition;
    view.focus({ x: (sentinel.x + ram.x) / 2, z: (sentinel.z + ram.z) / 2 });
    for (const [id, definitionId, targetId] of [
      ["field-healer", "circle-healer", "sentinel"],
      ["field-artificer", "circle-artificer", "ram"],
    ] as const) {
      const { x, z } = simulation.actorById(targetId)!.worldPosition;
      simulation.spawnActor(
        createActor({
          id,
          definitionId,
          owner: "player",
          worldPosition: { x: x + 1.5, z },
        }),
      );
      simulation.submitCommand(
        { kind: "service", actorId: id, targetId },
        { owner: "player" },
      );
    }
  });
  await expect(page.locator("#game-canvas")).toHaveAttribute(
    "data-models-ready",
    "true",
  );
  await advance(page, 0.3);
  const styles = await page.evaluate(() =>
    ["field-healer", "field-artificer"].map(
      (id) =>
        window.sessionHarness.view.scene.getMeshByName(
          `service-effect-${id}-mark`,
        )?.material?.name,
    ),
  );
  expect(styles).toEqual(["service-healing", "service-construct-repair"]);
  await page.screenshot({ path: info.outputPath("circle-service.png") });
  await advance(page, 40);
  const health = await page.evaluate(() =>
    ["sentinel", "ram"].map(
      (id) => window.sessionHarness.view.simulation.actorById(id)!.health,
    ),
  );
  expect(health).toEqual([undefined, undefined]);
  expect(errors).toEqual([]);
});

test(`Thornspire aims its crown and fires on raiders ${WEBKIT}`, async ({
  page,
}, info) => {
  const errors = collectPageErrors(page, { console: true });
  await opening(page);
  await expect(page.locator("#game-canvas")).toHaveAttribute(
    "data-models-ready",
    "true",
  );
  const crown = () =>
    page.evaluate(() => {
      const node = window.sessionHarness.view.scene.transformNodes.find(
        (each) =>
          each.name.includes("spire") &&
          each.name.endsWith("circle-thornspire-crown"),
      );
      return node && node.rotation.y;
    });
  const rest = await crown();
  expect(rest).toBeDefined();
  await page.evaluate(async () => {
    const { createActor } = await import("/src/simulation/actor.ts");
    const { view } = window.sessionHarness;
    const { simulation } = view;
    view.focus(simulation.actorById("spire")!.worldPosition);
    // West of the spire, away from its placement facing.
    simulation.spawnActor(
      createActor({
        id: "raider",
        definitionId: "arc-trooper",
        owner: "raiders",
        worldPosition: { x: 3.5, z: -5.5 },
      }),
    );
  });
  await advance(page, 2);
  expect(
    await page.evaluate(
      () => window.sessionHarness.view.simulation.actorById("raider")?.health,
    ),
  ).toBeLessThan(100);
  expect(await crown()).not.toBeCloseTo(rest!);
  await page.screenshot({ path: info.outputPath("thornspire-fire.png") });
  expect(errors).toEqual([]);
});

test(`living buildings and the Briar Ram show damage stages at gameplay scale ${WEBKIT}`, async ({
  page,
}, info) => {
  const errors = collectPageErrors(page, { console: true });
  // Moderate at 60% or less, critical at 30%; the opening's Ram is critical.
  await opening(page, { heart: 1000, muster: 160 });
  await expect(page.locator("#game-canvas")).toHaveAttribute(
    "data-models-ready",
    "true",
  );
  const stages = () =>
    page.evaluate(() =>
      Object.fromEntries(
        ["heart", "muster", "ram"].map((id) => {
          const meshes = window.sessionHarness.view.scene.meshes.filter(
            (mesh) => mesh.name.includes(id) && mesh.name.includes("damage-"),
          );
          const shown = (stage: string) =>
            meshes.some(
              (mesh) => mesh.name.includes(stage) && mesh.isEnabled(),
            );
          return [id, [shown("damage-moderate"), shown("damage-critical")]];
        }),
      ),
    );
  await page.evaluate(() => {
    const { view } = window.sessionHarness;
    view.focus(view.simulation.actorById("muster")!.worldPosition);
  });
  await advance(page, 0.5);
  expect(await stages()).toEqual({
    heart: [true, false],
    muster: [true, true],
    ram: [true, true],
  });
  await page.screenshot({ path: info.outputPath("circle-damage.png") });
  const flicker = () =>
    page.evaluate(
      () =>
        window.sessionHarness.view.scene.meshes.find(
          (mesh) =>
            mesh.name.startsWith("actor-ram-") &&
            mesh.name.includes("damage-critical-flicker"),
        )?.visibility,
    );
  expect(await flicker()).toBeLessThan(1);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await advance(page, 0.1);
  await expect.poll(flicker).toBe(1);
  expect((await stages()).ram).toEqual([true, true]);
  expect(errors).toEqual([]);
});
