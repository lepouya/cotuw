import { expect, test } from "./fixtures";
import { forEachProfile, MOUSE_AND_PHONE_PROFILES } from "./profiles";
import {
  activate,
  advance,
  attachScreenshot,
  expectTerrainReady,
  withoutApp,
} from "./page-helpers";
import { WEBKIT } from "./tags";

import type { Page } from "@playwright/test";
import type { MissionUiState } from "../src/simulation/mission-file";

const TROOPERS = ["trooper-a", "trooper-b", "trooper-far"];
const SCOUT = "scout-a";
const HARVESTERS = ["harvester-a", "harvester-b"];

/**
 * The ARC opening on a controlled clock, with Troopers and a Scout near the
 * Command Center, a Trooper out of view, and two Harvesters without a
 * Refinery.
 */
async function openWithUnits(page: Page, uiState?: MissionUiState) {
  await withoutApp(page);
  await page.goto("/");
  await page.evaluate(
    async ({ uiState, troopers, scout, harvesters }) => {
      const { startSidebarSession } = await import("/e2e/sidebar-session.ts");
      const { level } = await import("/e2e/missions.ts");
      const { controlSessionClock } = await import("/e2e/harness.ts");
      const mission = level();
      const unit = (id: string, definitionId: string, x: number, z: number) =>
        mission.state.actors.push({
          id,
          definitionId,
          owner: "player",
          worldPosition: { x, z },
          facing: 0,
          occupancyLayer: "surface",
        });
      unit(troopers[0]!, "arc-trooper", -36.5, 4.5);
      unit(troopers[1]!, "arc-trooper", -35.5, 6.5);
      unit(troopers[2]!, "arc-trooper", 10.5, 30.5);
      unit(scout, "arc-scout", -34.5, 4.5);
      // Popups would cover the world; this spec is about selection.
      mission.uiState = {
        dismissedPopups: mission.scenario.popups!.map(({ id }) => id),
        ...uiState,
      };
      const { view } = await startSidebarSession(mission);
      controlSessionClock(view);
      for (const [index, id] of harvesters.entries())
        view.simulation.spawnActor({
          id,
          definitionId: "arc-harvester",
          owner: "player",
          worldPosition: { x: -38.5 + index * 2, z: 7.5 },
          facing: 0,
          occupancyLayer: "surface",
        });
    },
    { uiState, troopers: TROOPERS, scout: SCOUT, harvesters: HARVESTERS },
  );
  await expectTerrainReady(page);
  await advance(page, 0.1);
}

const selected = (page: Page) =>
  page.evaluate(
    () =>
      JSON.parse(
        document.querySelector<HTMLCanvasElement>("#game-canvas")!.dataset
          .selectedActors ?? "[]",
      ) as string[],
  );

const focusPoint = (page: Page) =>
  page.evaluate(() => {
    const { x, z } = window.sessionHarness.view.camera.focusPoint;
    return { x, z };
  });

const select = async (page: Page, ids: readonly string[]) => {
  await page.evaluate(
    (ids) => window.sessionHarness.view.selectActors(ids),
    [...ids],
  );
  await advance(page, 0.1);
};

/** An actor's on-screen position, at its body rather than its feet. */
const actorPoint = (page: Page, id: string) =>
  page.evaluate(async (id) => {
    const { gameScene, projectToCanvas, Vector3 } =
      await import("/e2e/harness.ts");
    const scene = gameScene();
    const node = scene.getTransformNodeByName(`actor-${id}-root`)!;
    return projectToCanvas(
      scene,
      document.querySelector<HTMLCanvasElement>("#game-canvas")!,
      node.getAbsolutePosition().add(new Vector3(0, 0.85, 0)),
    );
  }, id);

test(
  "number keys assign, add, recall, and focus groups that drop lost members",
  { tag: WEBKIT },
  async ({ page }) => {
    await openWithUnits(page);
    await select(page, TROOPERS.slice(0, 2));
    // Control is the modifier on every platform, including Mac.
    await page.keyboard.press("Control+Shift+Digit1");
    await select(page, [SCOUT]);
    await page.keyboard.press("Shift+Digit1");
    await page.keyboard.press("Control+Shift+Digit2");
    await select(page, []);
    const camera = await focusPoint(page);
    await page.keyboard.press("Digit1");
    await advance(page, 1);
    expect(await selected(page)).toEqual([SCOUT, ...TROOPERS.slice(0, 2)]);
    expect(await focusPoint(page)).toEqual(camera);
    await page.evaluate(() => (window.sessionHarness.now += 1000));
    await page.keyboard.press("Digit2");
    await page.keyboard.press("Digit2");
    await advance(page, 1);
    expect(await selected(page)).toEqual([SCOUT]);
    expect(await focusPoint(page)).not.toEqual(camera);
    // Groups yield Control chords without Shift to the host.
    await page.keyboard.press("Control+Digit1");
    expect(await selected(page)).toEqual([SCOUT]);
    const saved = await page.evaluate(async (lostId) => {
      const { loadMission } = await import("/src/mission-loading.ts");
      const { view } = window.sessionHarness;
      view.simulation.removeActor(lostId);
      // Save before another frame can update the controls.
      return loadMission(
        view.save({
          name: "Groups",
          savedAt: "2026-11-16T12:00:00Z",
        }),
      ).uiState?.controlGroups;
    }, TROOPERS[0]!);
    expect(saved).toEqual({ "1": [SCOUT, TROOPERS[1]], "2": [SCOUT] });
    await advance(page, 0.1);
    await page.keyboard.press("Digit1");
    expect(await selected(page)).toEqual([SCOUT, TROOPERS[1]]);
  },
);

test("loading restores surviving owned group members only", async ({
  page,
}) => {
  await openWithUnits(page, {
    controlGroups: {
      "1": ["trooper-a", "missing-unit"],
      // Buildings and other owners' actors cannot belong to a group.
      "2": ["starting-command-center", "lone-wolf"],
    },
  });
  await page.locator("#toggle-control-groups").click();
  await expect(page.locator("#control-group-1")).toHaveAccessibleName(
    "Group 1, 1 unit",
  );
  await expect(page.locator("#control-group-2")).toBeDisabled();
  await page.keyboard.press("Digit1");
  await advance(page, 0.1);
  expect(await selected(page)).toEqual(["trooper-a"]);
});

forEachProfile(MOUSE_AND_PHONE_PROFILES, (profile) => {
  const touch = profile.touch;
  test(
    "the Groups panel assigns, adds, recalls, and clears groups",
    { tag: WEBKIT },
    async ({ page }, testInfo) => {
      await openWithUnits(page);
      await activate(page.locator("#toggle-control-groups"), touch);
      await expect(page.locator("#control-groups")).toBeVisible();
      expect(
        await page
          .locator(".group-slots button")
          .evaluateAll((buttons) => buttons.map((button) => button.id)),
      ).toEqual(
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map((slot) => `control-group-${slot}`),
      );
      for (const panel of [".production-pane", ".selection-pane"])
        expect(
          (await page.locator(panel).boundingBox())!.height,
        ).toBeGreaterThan(60);
      await expect(page.locator("#control-group-assign")).toBeDisabled();
      await select(page, TROOPERS.slice(0, 2));
      await activate(page.locator("#control-group-assign"), touch);
      await expect(page.locator("#control-group-status")).toHaveText(
        "Choose a group to hold the 2 units selected.",
      );
      await activate(page.locator("#control-group-3"), touch);
      await expect(page.locator("#control-group-status")).toHaveText(
        "Group 3 holds 2 units.",
      );
      await select(page, [SCOUT]);
      await activate(page.locator("#control-group-add"), touch);
      await activate(page.locator("#control-group-3"), touch);
      await expect(page.locator("#control-group-3")).toHaveAccessibleName(
        "Group 3, 3 units",
      );
      await select(page, []);
      await activate(page.locator("#control-group-3"), touch);
      await advance(page, 0.1);
      expect(await selected(page)).toEqual([SCOUT, ...TROOPERS.slice(0, 2)]);
      await attachScreenshot(page, testInfo, `groups-panel-${profile.name}`);
      await activate(page.locator("#control-group-clear"), touch);
      await activate(page.locator("#toggle-control-groups"), touch);
      await select(page, []);
      await page.keyboard.press("Digit3");
      expect(await selected(page)).toEqual([SCOUT, ...TROOPERS.slice(0, 2)]);
      await activate(page.locator("#toggle-control-groups"), touch);
      await activate(page.locator("#control-group-clear"), touch);
      await activate(page.locator("#control-group-3"), touch);
      await expect(page.locator("#control-group-3")).toBeDisabled();
      await expect(page.locator("#control-group-clear")).toBeDisabled();
      // The compact Groups overlay covers the refinery card while open.
      const build = page.locator("#build-refinery");
      if (touch) await build.press("Enter");
      else await build.click();
      await expect(page.locator("#control-groups")).toBeHidden();
      await expect(page.locator("#toggle-control-groups")).toBeDisabled();
      await expect(page.locator("#placement-actions")).toBeVisible();
      await activate(page.locator("#cancel-building"), touch);
      await expect(page.locator("#toggle-control-groups")).toBeEnabled();
    },
  );

  test(
    "idle-worker controls cycle, focus, and select all idle workers",
    { tag: WEBKIT },
    async ({ page }) => {
      await openWithUnits(page);
      await expect(page.locator("#idle-workers")).toHaveText(
        "Idle workers (2)",
      );
      const camera = await focusPoint(page);
      await activate(page.locator("#idle-workers"), touch);
      await advance(page, 1);
      expect(await selected(page)).toEqual([HARVESTERS[0]]);
      expect(await focusPoint(page)).not.toEqual(camera);
      await activate(page.locator("#idle-workers"), touch);
      // Lets the focus glide finish before Select all is measured.
      await advance(page, 1);
      expect(await selected(page)).toEqual([HARVESTERS[1]]);
      await select(page, []);
      const before = await focusPoint(page);
      await activate(page.locator("#select-idle-workers"), touch);
      await advance(page, 1);
      expect(await selected(page)).toEqual(HARVESTERS);
      expect(await focusPoint(page)).toEqual(before);
      const typeLabel = page.locator(
        '.selection-type[data-definition-id="arc-harvester"] span',
      );
      expect(
        await typeLabel.evaluate(
          (label) => label.scrollWidth <= label.clientWidth,
        ),
      ).toBe(true);
      // A pending order makes a worker busy.
      await page.evaluate(
        (id) =>
          window.sessionHarness.view.simulation.submitCommand(
            { kind: "move", actorId: id, target: { x: -30.5, z: 9.5 } },
            { owner: "player" },
          ),
        HARVESTERS[0]!,
      );
      await advance(page, 0.1);
      await expect(page.locator("#idle-workers")).toHaveText(
        "Idle workers (1)",
      );
      if (touch) return;
      await select(page, []);
      await page.keyboard.press("Period");
      await advance(page, 0.1);
      expect(await selected(page)).toEqual([HARVESTERS[1]]);
      await select(page, []);
      await page.keyboard.press("Shift+Period");
      await advance(page, 0.1);
      expect(await selected(page)).toEqual([HARVESTERS[1]]);
    },
  );

  test(
    "matching-unit actions select a type in view or across the map",
    { tag: WEBKIT },
    async ({ page }) => {
      await openWithUnits(page);
      await select(page, [TROOPERS[0]!, SCOUT]);
      const trooperRow = page.locator(
        '.selection-type[data-definition-id="arc-trooper"]',
      );
      await expect(trooperRow).toContainText("Trooper × 1");
      await expect(
        page.locator('.selection-type[data-definition-id="arc-scout"]'),
      ).toContainText("Scout × 1");
      await activate(
        trooperRow.getByRole("button", {
          name: "Select every Trooper in view",
        }),
        touch,
      );
      await advance(page, 0.1);
      expect(await selected(page)).toEqual(TROOPERS.slice(0, 2));
      await activate(
        trooperRow.getByRole("button", {
          name: "Select every Trooper across the map",
        }),
        touch,
      );
      await advance(page, 0.1);
      expect(await selected(page)).toEqual(TROOPERS);
      // Add units mode keeps the other selected types.
      await select(page, [SCOUT, TROOPERS[0]!]);
      const removedAction = await trooperRow
        .locator("button")
        .first()
        .elementHandle();
      await select(page, [SCOUT]);
      await removedAction!.evaluate((button: HTMLButtonElement) =>
        button.click(),
      );
      expect(await selected(page)).toEqual([SCOUT]);
      await removedAction!.dispose();
      await select(page, [SCOUT, TROOPERS[0]!]);
      await activate(page.locator("#add-selection"), touch);
      await activate(
        trooperRow.getByRole("button", {
          name: "Select every Trooper in view",
        }),
        touch,
      );
      await advance(page, 0.1);
      expect(await selected(page)).toEqual([SCOUT, ...TROOPERS.slice(0, 2)]);
      await activate(page.locator("#add-selection"), touch);
      if (touch) return;
      await select(page, []);
      const trooper = await actorPoint(page, TROOPERS[0]!);
      await page.mouse.dblclick(trooper.x, trooper.y);
      await advance(page, 0.1);
      expect(await selected(page)).toEqual(TROOPERS.slice(0, 2));
      const scout = await actorPoint(page, SCOUT);
      await page.keyboard.down("Shift");
      await page.mouse.dblclick(scout.x, scout.y);
      await page.keyboard.up("Shift");
      await advance(page, 0.1);
      expect(await selected(page)).toEqual([SCOUT, ...TROOPERS.slice(0, 2)]);
    },
  );
});
