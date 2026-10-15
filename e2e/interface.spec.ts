import { expect, test } from "@playwright/test";
import { TOUCH_PROFILES } from "./profiles";
import { MissionDriver } from "./mission-driver";
import { terrainPoint } from "./prototype-helpers";

import type { Page } from "@playwright/test";

const time = (page: Page) => page.locator("#mission-time");

test("the opening guide pauses, survives saving, and repeats on restart", async ({
  page,
}) => {
  const mission = new MissionDriver(page, false, false);
  await mission.opening(false);
  await expect(page.locator("#explanation-title")).toHaveText(
    "Welcome, Commander",
  );
  await expect(page.locator("#explanation-text")).toContainText(
    "lower sidebar",
  );
  await mission.advance(15);
  await expect(time(page)).toHaveText("0:00");
  await mission.explanation("Welcome, Commander");
  await mission.advance(1);
  await expect(time(page)).toHaveText("0:01");
  await page.keyboard.press("F5");
  await expect(page.locator("#notifications")).toContainText(
    "Quick save complete",
  );
  await page.keyboard.press("F9");
  await expect(page.locator("#game-menu-title")).toHaveText("Mission loaded");
  await mission.press("#inspect-loaded-mission");
  await expect(page.locator("#explanation")).toBeHidden();
  await mission.press("#open-menu");
  await mission.press("#restart-mission");
  await expect(page.locator("#explanation-title")).toHaveText(
    "Welcome, Commander",
  );
});

async function rightClick(page: Page, x: number, z: number) {
  const point = await terrainPoint(page, x, z);
  await page.mouse.click(point.x, point.y, { button: "right" });
}

test("a ten-second stall catches up while rendering is stopped", async ({
  page,
}) => {
  const mission = new MissionDriver(page, false, false);
  await mission.opening();
  await page.keyboard.press("F5");
  await expect(page.locator("#notifications")).toContainText(
    "Quick save complete",
  );
  const initialTick = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("cotuw.save.quicksave")!).state
        .tick as number,
  );
  await page.evaluate(() => {
    window.missionClock += 10_000;
  });

  // Saving reads committed ticks without rendering a frame.
  await expect
    .poll(async () => {
      await page.keyboard.press("F5");
      return page.evaluate(() => {
        const source = localStorage.getItem("cotuw.save.quicksave");
        return source ? JSON.parse(source).state.tick : 0;
      });
    })
    .toBe(initialTick + 600);
  await expect(page.locator("#game-canvas")).not.toHaveAttribute(
    "data-simulation-fault",
    "true",
  );
});

test("the top bar, popups, alerts, and radial menu drive the opening with a mouse", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const mission = new MissionDriver(page, false, false);
  await mission.opening();
  await expect(page.locator("#objective-summary")).toContainText(
    "Defeat the lone wolf 0/1",
  );
  await expect(page.locator("#materials-counter")).toHaveText("150");

  await mission.advance(10);
  await expect(time(page)).toHaveText("0:10");
  await mission.press('[data-speed="2"]');
  await expect(page.locator('[data-speed="2"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await mission.advance(10);
  await expect(time(page)).toHaveText("0:30");
  await mission.press('[data-speed="0.5"]');
  await mission.advance(10);
  await expect(time(page)).toHaveText("0:35");
  await mission.press('[data-speed="1"]');
  await mission.press("#pause-mission");
  await expect(page.locator("#pause-mission")).toHaveText("▶ Paused");
  await mission.advance(10);
  await expect(time(page)).toHaveText("0:35");
  await mission.press("#pause-mission");
  await expect(page.locator("#pause-mission")).toHaveText("⏸ Pause");

  // The first Refinery placement explains support and pauses until dismissed.
  await mission.press("#tab-buildings");
  await mission.press("#build-refinery");
  await expect(page.locator("#explanation-title")).toHaveText(
    "Support Network",
  );
  const frozen = await time(page).textContent();
  await mission.advance(5);
  await expect(time(page)).toHaveText(frozen!);
  await mission.press("#dismiss-explanation");
  await expect(page.locator("#explanation")).toBeHidden();
  await expect(page.locator("#game-canvas")).toHaveAttribute(
    "data-placement-active",
    "true",
  );
  await mission.ground(12, 49);
  await expect(page.locator("#game-canvas")).toHaveAttribute(
    "data-placement-active",
    "false",
  );
  await mission.advance(9);
  await expect(page.locator("#notifications")).toContainText(
    "Materials Refinery complete",
  );
  await expect(page.locator("#alert-unread")).toHaveText("1");
  await mission.press("#alert-toggle");
  await expect(page.locator("#alert-history")).toContainText(
    "Materials Refinery complete",
  );
  await expect(page.locator("#alert-unread")).toBeHidden();
  await mission.press("#alert-toggle");

  await mission.press("#train-harvester");
  const trainingStarted = await time(page).textContent();
  // A long render stall must pause on the completion tick, not its next frame.
  await mission.advance(30);
  const toSeconds = (text: string) => {
    const [minutes, seconds] = text.split(":").map(Number);
    return minutes * 60 + seconds;
  };
  expect(
    toSeconds((await time(page).textContent())!) - toSeconds(trainingStarted!),
  ).toBeLessThanOrEqual(6);
  await mission.explanation("Harvester Operations");
  await expect(page.locator("#notifications")).toContainText("Harvester ready");

  // A loaded save keeps the dismissal, so the popup does not return.
  await page.keyboard.press("F5");
  await expect(page.locator("#notifications")).toContainText(
    "Quick save complete",
  );
  await page.keyboard.press("F9");
  await expect(page.locator("#game-menu-title")).toHaveText("Mission loaded");
  await mission.press("#resume-mission");
  await mission.advance(2);
  await expect(page.locator("#explanation")).toBeHidden();

  await mission.select("Harvester");
  await rightClick(page, 17, 53);
  const menu = page.locator(".radial-menu");
  await expect(menu.locator(".radial-default")).toContainText("Move");
  await expect(
    menu.locator('[data-context-action="attack-move"]'),
  ).toBeVisible();
  // Windows fires contextmenu on release, over the menu that just opened.
  const nativeMenu = (selector: string) =>
    page
      .locator(selector)
      .evaluate(
        (element) =>
          !element.dispatchEvent(
            new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
          ),
      );
  expect(await nativeMenu(".radial-menu .radial-default")).toBe(true);
  expect(await nativeMenu("#save-name")).toBe(false);
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(page.locator("#game-canvas")).toHaveAttribute(
    "data-selected-actor",
    /.+/,
  );
  await mission.press('[data-camera-action="pan"]');
  await rightClick(page, 17, 53);
  await expect(menu).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await expect(
    menu.locator('[data-context-action="attack-move"]'),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(page.locator('[data-camera-action="pan"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await mission.press('[data-camera-action="pan"]');

  // Dismissing the menu on the world must consume the press.
  await rightClick(page, 17, 53);
  await mission.ground(16, 53);
  await expect(menu).toBeHidden();
  await expect(page.locator("#harvester-details")).toContainText("Idle");

  await mission.press("#pause-mission");
  await rightClick(page, 17, 53);
  await expect(menu.locator('[data-context-action="move"]')).toHaveCount(0);
  await page.keyboard.press("Escape");
  await mission.press("#pause-mission");
  await rightClick(page, 20, 50);
  await expect(menu.locator(".radial-default")).toContainText("Gather");
  await testInfo.attach("radial-menu", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  await mission.press(".radial-menu .radial-default");
  await expect(menu).toBeHidden();
  await mission.advance(2);
  await expect(page.locator("#harvester-details")).toContainText(
    /Travelling to Materials|Gathering/,
  );
  expect(errors).toEqual([]);
});

for (const profile of TOUCH_PROFILES)
  test.describe(profile.name, () => {
    test.use({ viewport: profile.viewport, hasTouch: true });
    test("the top bar and popups work without a keyboard or hover", async ({
      page,
    }, testInfo) => {
      const mission = new MissionDriver(page, true, false);
      await mission.opening();
      for (const selector of [
        "#open-menu",
        "#pause-mission",
        '[data-speed="0.5"]',
        '[data-speed="2"]',
        "#objective-summary",
        "#mission-time",
        "#alert-toggle",
      ])
        await expect(page.locator(selector)).toBeInViewport({ ratio: 1 });
      // Short screens reduce the objective and resource labels to symbols.
      if (profile.viewport.height <= 600) {
        await expect(page.locator("#objective-text")).toBeHidden();
        await expect(page.locator("#objective-summary")).toHaveAccessibleName(
          /Defeat the lone wolf.*Show objectives/,
        );
      } else await expect(page.locator("#objective-text")).toBeVisible();
      await expect(page.locator("#resource-bar")).toHaveAccessibleName(
        "150 Materials",
      );
      await mission.press('[data-speed="2"]');
      await mission.advance(5);
      await expect(time(page)).toHaveText("0:10");
      await mission.press("#pause-mission");
      await mission.advance(5);
      await expect(time(page)).toHaveText("0:10");
      await mission.press("#pause-mission");
      await mission.press("#objective-summary");
      await expect(page.locator("#panel-goals")).toBeVisible();
      await mission.place("refinery", 12, 49, "Support Network");
      await expect(page.locator("#notifications")).toContainText(
        "Materials Refinery complete",
      );
      await mission.press("#alert-toggle");
      await expect(page.locator("#alert-history-panel")).toBeVisible();
      await testInfo.attach(`top-bar-${profile.name}`, {
        body: await page.screenshot(),
        contentType: "image/png",
      });
    });
  });
