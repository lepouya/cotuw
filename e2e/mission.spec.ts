import { expect, test } from "@playwright/test";
import { MissionDriver } from "./mission-driver";
import { MOUSE_PROFILE, TOUCH_PROFILES } from "./profiles";

const realTime = process.env.COTUW_REALTIME_PLAYTHROUGH === "1";

// Tablet runs the same controls with more room; the compact checks cover it.
for (const profile of [MOUSE_PROFILE, TOUCH_PROFILES[0]]) {
  test.describe(profile.name, () => {
    test.use({ viewport: profile.viewport, hasTouch: profile.touch });
    test(`complete M0 mission from the authored opening with ${profile.name}`, async ({
      page,
    }, testInfo) => {
      if (realTime) test.setTimeout(20 * 60 * 1000);
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const mission = new MissionDriver(page, profile.touch, realTime);
      await mission.opening();
      for (let i = 0; i < 3; i++)
        await mission.press('[data-camera-action="tilt-up"]');
      await expect(page.locator("#materials-counter")).toHaveText("150");
      await expect(page.locator("#game-canvas")).toHaveAttribute(
        "data-tile-placed-actor-count",
        "1",
      );
      await mission.place("refinery", 12, 49, "Support Network");
      await mission.press("#train-harvester");
      await mission.advance(6);
      await mission.explanation("Harvester Operations");
      await mission.select("Harvester");
      await mission.press(
        '#gather-sites [data-economy-action="gather:near-materials-1"]',
      );
      await mission.materials(100);
      await mission.place("barracks", 16, 54);
      await mission.materials(45);
      await mission.press("#train-scout");
      await mission.press("#train-trooper");
      await mission.advance(7);
      await mission.explanation("Scouting & Combat");

      await mission.select("Scout");
      await mission.focus(24, 42);
      await mission.ground(24, 42);
      await mission.advance(5);
      await mission.focus(34, 36);
      await mission.ground(34, 36);
      await mission.advance(5);
      await expect(page.locator("#game-canvas")).toHaveAttribute(
        "data-move-status",
        "accepted",
      );

      await mission.select("Trooper");
      await mission.focus(40, 34);
      await mission.ground(40, 34);
      await mission.advance(15);
      await mission.focus(46, 32);
      await mission.press("#attack-move");
      await mission.ground(52, 32);
      await mission.advance(25);
      await mission.press("#tab-goals");
      await expect(page.locator('[data-goal-id="lone-wolf"]')).toContainText(
        "(1/1)",
      );
      await expect(page.locator('[data-goal-id="wolf-den"]')).toContainText(
        "(0/5)",
      );
      await expect(page.locator("#game-menu")).not.toBeVisible();

      await mission.select("Trooper");
      for (const id of ["salvage-2", "salvage-3"]) {
        await mission.press("#tab-units");
        await mission.press(`[data-economy-action="loot:${id}"]`);
        await mission.advance(5);
        await expect(
          page.locator(`[data-economy-action="loot:${id}"]`),
        ).toHaveCount(0);
      }
      await testInfo.attach(`crossing-${profile.name}`, {
        body: await page.screenshot(),
        contentType: "image/png",
      });

      await mission.focus(16, 54);
      await mission.press("#tab-units");
      await mission.ground(16, 54);
      await mission.materials(125);
      const training = page.locator("#train-trooper");
      await training.scrollIntoViewIfNeeded();
      // Allow fractional scroll rounding while keeping the touch target clear.
      await expect(training).toBeInViewport({ ratio: 0.99 });
      for (let i = 0; i < 5; i++) await mission.press("#train-trooper");
      await mission.advance(20);
      await expect(
        page.locator("#unit-roster button").filter({ hasText: "Trooper" }),
      ).toHaveCount(6);
      await mission.select("Scout");
      await mission.focus(57, 35);
      await mission.ground(57, 35);
      await mission.advance(8);
      await mission.focus(70, 34);
      await mission.ground(70, 34);
      await mission.advance(5);
      await mission.focus(77, 36);
      await mission.ground(77, 36);
      await mission.advance(3);

      await mission.selectTroopers();
      await mission.focus(77, 35);
      await mission.ground(77, 35);
      await mission.advance(30);
      await mission.focus(78, 29);
      await mission.press("#attack-move");
      await mission.ground(78, 21);
      await mission.advance(30);
      await expect(page.locator("#game-menu-title")).toHaveText("Victory");
      await expect(page.locator("#game-canvas")).toHaveAttribute(
        "data-mission-result",
        "victory",
      );
      const elapsedSeconds = await mission.elapsedSeconds();
      await testInfo.attach("playthrough", {
        body: JSON.stringify({
          elapsedSeconds,
          strategy:
            "One Harvester, one Scout, six Troopers, 50 recovery Materials",
        }),
        contentType: "application/json",
      });
      await testInfo.attach(`victory-${profile.name}`, {
        body: await page.screenshot(),
        contentType: "image/png",
      });
      await mission.press("#resume-mission");
      await expect(page.locator("#game-menu")).not.toBeVisible();
      await mission.press("#tab-goals");
      await expect(
        page.locator("#mission-objectives .goal-complete"),
      ).toHaveCount(2);
      await mission.focus(16, 54);
      await mission.press("#tab-units");
      await mission.ground(16, 54);
      await mission.materials(25);
      const units = await page.locator("#unit-roster button").count();
      await mission.press("#train-trooper");
      await mission.advance(4);
      await expect(page.locator("#unit-roster button")).toHaveCount(units + 1);
      expect(errors).toEqual([]);
    });
  });
}
