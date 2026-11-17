import { expect, test } from "./fixtures";
import { forEachProfile, MOUSE_AND_PHONE_PROFILES } from "./profiles";
import { WEBKIT } from "./tags";
import {
  activate,
  advance,
  collectPageErrors,
  expectTerrainReady,
  selectInSession,
  withoutApp,
} from "./page-helpers";
import type { Page } from "@playwright/test";

async function repairBadge(page: Page, id: string) {
  return page.evaluate(async (id) => {
    const { gameScene, Vector3 } = await import("/e2e/harness.ts");
    const scene = gameScene();
    const wrench = scene.getMeshByName(`repair-badge-${id}-wrench`);
    if (!wrench) return undefined;
    const viewport = scene.activeCamera!.viewport.toGlobal(
      scene.getEngine().getRenderWidth(),
      scene.getEngine().getRenderHeight(),
    );
    const screenY = (name: string) => {
      const mesh = scene.getMeshByName(name)!;
      return mesh
        .getBoundingInfo()
        .boundingBox.vectors.map(
          (point) =>
            Vector3.Project(
              point,
              mesh.getWorldMatrix(),
              scene.getTransformMatrix(),
              viewport,
            ).y,
        );
    };
    return {
      visible:
        wrench.isEnabled() && wrench.isVisible && wrench.getTotalVertices() > 0,
      paused: scene.getMeshByName(`repair-badge-${id}-pause-1`)!.isEnabled(),
      clearsHealthBar:
        Math.max(...screenY(`repair-badge-${id}-background`)) <
        Math.min(...screenY(`health-bar-${id}-frame`)),
    };
  }, id);
}

async function startRepair(page: Page, materials: number) {
  await withoutApp(page);
  await page.goto("/");
  const opening = await page.evaluate(async (materials) => {
    const { startSidebarSession } = await import("/e2e/sidebar-session.ts");
    const { level } = await import("/e2e/missions.ts");
    const { controlSessionClock } = await import("/e2e/harness.ts");
    const { createNotifications } = await import("/src/ui/notifications.ts");
    const mission = level();
    const headquarters = mission.state.actors.find(
      (actor) => actor.definitionId === "arc-command-center-prototype",
    )!;
    const definition = mission.definitions.find(
      (definition) => definition.id === headquarters.definitionId,
    )!;
    headquarters.health = definition.health! * 0.8;
    mission.state.economy!.stockpiles[0].amount = materials;
    const notifications = createNotifications(
      document.querySelector<HTMLElement>("#mission-alerts")!,
    );
    const { view } = await startSidebarSession(mission, {
      onAlerts: (alerts) =>
        alerts.forEach((alert) => notifications.alert(alert, "")),
    });
    controlSessionClock(view);
    return {
      id: headquarters.id,
      health: headquarters.health,
      maximum: definition.health!,
    };
  }, materials);
  await expectTerrainReady(page);
  await selectInSession(page, opening.id);
  return opening;
}

forEachProfile(MOUSE_AND_PHONE_PROFILES, ({ touch }) => {
  test(`contextual repair pays, pauses with the mission, and cancels ${WEBKIT}`, async ({
    page,
  }, info) => {
    const errors = collectPageErrors(page);
    const opening = await startRepair(page, 100);
    const repair = page.locator("#repair-actions button");
    await expect(repair).toHaveText(/Repair \(up to \d+ Materials\)/);
    await activate(repair, touch);
    await advance(page, 2);
    await expect(repair).toHaveText("Cancel repair");
    const details = page.locator("#repair-details");
    await expect(details).toContainText("Repairing");
    await expect(details).toContainText("Your payment priority 1");
    await expect(details).toContainText("Materials/s");
    expect(await repairBadge(page, opening.id)).toEqual({
      visible: true,
      paused: false,
      clearsHealthBar: true,
    });
    const afterRepair = await page.evaluate((id) => {
      const sim = window.sessionHarness.view.simulation;
      return {
        health: sim.actorById(id)!.health!,
        balance: sim.economy!.stockpiles[0].amount,
      };
    }, opening.id);
    expect(afterRepair.health).toBeGreaterThan(opening.health);
    expect(afterRepair.balance).toBeLessThan(100);
    await page.evaluate(() => window.sessionHarness.view.pause());
    await expect(repair).toBeDisabled();
    await advance(page, 3);
    expect(
      await page.evaluate(
        (id) => window.sessionHarness.view.simulation.actorById(id)!.health,
        opening.id,
      ),
    ).toBe(afterRepair.health);
    await page.screenshot({ path: info.outputPath("repair-controls.png") });
    await page.evaluate(() =>
      window.sessionHarness.view.camera.setPreset("top-down"),
    );
    await advance(page, 0.4);
    expect(await repairBadge(page, opening.id)).toEqual({
      visible: true,
      paused: false,
      clearsHealthBar: true,
    });
    await page.screenshot({ path: info.outputPath("repair-top-down.png") });
    await page.evaluate(() => window.sessionHarness.view.resume());
    await activate(repair, touch);
    await advance(page, 0.1);
    const stopped = await page.evaluate(
      (id) => window.sessionHarness.view.simulation.actorById(id)!.health,
      opening.id,
    );
    await expect(repair).toHaveText(/Repair/);
    await expect(details).toBeHidden();
    expect(await repairBadge(page, opening.id)).toBeUndefined();
    await advance(page, 2);
    expect(
      await page.evaluate(
        (id) => window.sessionHarness.view.simulation.actorById(id)!.health,
        opening.id,
      ),
    ).toBe(stopped);
    await activate(repair, touch);
    await advance(page, 25);
    await expect(repair).toHaveCount(0);
    expect(await repairBadge(page, opening.id)).toBeUndefined();
    await expect(page.locator("#selection-health")).toHaveText(
      `Health ${opening.maximum} / ${opening.maximum}`,
    );
    expect(errors).toEqual([]);
  });

  test(`unaffordable repair explains its pause without repeated alerts ${WEBKIT}`, async ({
    page,
  }, info) => {
    const errors = collectPageErrors(page);
    const opening = await startRepair(page, 0);
    const repair = page.locator("#repair-actions button");
    await expect(repair).toBeEnabled();
    await activate(repair, touch);
    await advance(page, 2);
    await expect(page.locator("#repair-details")).toContainText(
      "Insufficient resources · Paused",
    );
    expect(await repairBadge(page, opening.id)).toEqual({
      visible: true,
      paused: true,
      clearsHealthBar: true,
    });
    await page.screenshot({ path: info.outputPath("repair-paused.png") });
    const alerts = page
      .locator("#alert-history li")
      .filter({ hasText: "awaiting repair resources" });
    await expect(alerts).toHaveCount(1);
    await advance(page, 4);
    await expect(alerts).toHaveCount(1);
    expect(
      await page.evaluate(
        (id) => window.sessionHarness.view.simulation.actorById(id)!.health,
        opening.id,
      ),
    ).toBe(opening.health);
    await activate(repair, touch);
    await advance(page, 0.1);
    await expect(page.locator("#repair-details")).toBeHidden();
    expect(await repairBadge(page, opening.id)).toBeUndefined();
    expect(errors).toEqual([]);
  });
});

test("repair priorities rank the player's jobs separately for each resource", async ({
  page,
}) => {
  await withoutApp(page);
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { createSidebar } = await import("/src/ui/sidebar.ts");
    const { createEconomyControls } =
      await import("/src/ui/economy-controls.ts");
    const { currentContentPack } = await import("/src/content/packs.ts");
    const { createActor } = await import("/src/simulation/actor.ts");
    const pack = currentContentPack("base");
    const actors = [
      "arc-field-barracks",
      "circle-musterhall",
      "arc-field-barracks",
    ].map((definitionId, index) => {
      const definition = pack.actors.find(
        (entry) => entry.id === definitionId,
      )!;
      return {
        ...createActor({
          id: `repair-${index}`,
          definitionId,
          owner: "player",
          worldPosition: { x: 0, z: 0 },
        }),
        tilePlacement: { origin: { x: index * 4, z: 0 }, quarterTurns: 0 },
        headquartersId: "root",
        health: definition.health! * 0.9,
        repair: {
          missingHealth: definition.health! * 0.1,
          completedSteps: 0,
          paidCost: 0,
          priority: index + 1,
          queuedTick: 0,
        },
      };
    });
    const sidebar = createSidebar(
      document.querySelector<HTMLElement>("#game-sidebar")!,
      {
        definitions: pack.actors,
        presentations: new Map(Object.entries(pack.presentation)),
        playerOwner: "player",
        playerFaction: "arc",
        economy: true,
        goals: [],
        selectActor: () => {},
      },
    );
    const controls = createEconomyControls(
      sidebar.controls.economy!,
      {
        tickSeconds: 1 / 60,
        submitCommand: () => 0,
      },
      {
        definitions: pack.actors,
        names: new Map(),
        owner: "player",
        faction: "arc",
        ownActors: () => actors,
        selectedActorId: () => "repair-2",
        enabled: () => true,
        focus: () => {},
        offlineIds: () => new Set(),
        positionForTile: () => ({ x: 0, z: 0 }),
        economy: () => ({
          stockpiles: [
            { resource: "materials", owners: ["player"], amount: 100 },
            { resource: "lifebloom", owners: ["player"], amount: 100 },
          ],
          deposited: [],
          harvesters: [],
          sites: [],
          loot: [],
          production: [],
        }),
      },
    );
    controls.refresh();
    const queue = [
      ...document.querySelectorAll<HTMLElement>("#construction-queue button"),
    ].map((node) => node.textContent);
    const selected = document.querySelector("#repair-details")!.textContent;
    controls.dispose();
    sidebar.dispose();
    return { queue, selected };
  });
  expect(result.queue[0]).toContain("Your payment priority 1");
  expect(result.queue[1]).toContain("Your payment priority 1");
  expect(result.queue[1]).toContain("Lifebloom paid");
  expect(result.queue[2]).toContain("Your payment priority 2");
  expect(result.selected).toContain("Your payment priority 2");
});
