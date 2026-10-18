import { expect, test } from "@playwright/test";
import {
  DESKTOP_WINDOW_PROFILE,
  forEachProfile,
  MOUSE_PROFILE,
  PROFILES,
} from "./profiles";
import {
  activate,
  collectPageErrors,
  dismissExplanation,
  importMission,
} from "./prototype-helpers";
import { QUICK, WEBKIT } from "./tags";

forEachProfile([...PROFILES, DESKTOP_WINDOW_PROFILE], (profile) => {
  test(
    "options, load, exit, and new mission work before a session exists",
    { tag: profile === MOUSE_PROFILE ? [QUICK, WEBKIT] : WEBKIT },
    async ({ page }, info) => {
      const errors = collectPageErrors(page, { console: true });
      const models: string[] = [];
      page.on("request", (request) => {
        if (request.url().endsWith(".glb")) models.push(request.url());
      });
      const press = (id: string) =>
        activate(page.locator(`#${id}`), profile.touch);
      await page.goto("/");
      await expect(page.locator("#new-mission")).toBeFocused();
      await expect(page.locator("#game-version")).toHaveText(
        /^Prototype demo · v\d+\.\d+\.\d+$/,
      );
      await expect(page.locator(".game-shell")).toBeHidden();
      await expect(page.locator("#save-mission")).toBeHidden();
      await expect(page.locator("#restart-mission")).toBeHidden();
      await info.attach(`title-${profile.name}`, {
        body: await page.screenshot(),
        contentType: "image/png",
      });

      await press("open-options");
      await expect(page.locator("#game-menu-title")).toHaveText("Options");
      const slider = page.locator("#audio-master-volume");
      await expect(slider).toHaveValue("50");
      await slider.scrollIntoViewIfNeeded();
      const box = (await slider.boundingBox())!;
      const point = { x: box.x + box.width / 4, y: box.y + box.height / 2 };
      if (profile.touch) await page.touchscreen.tap(point.x, point.y);
      else await page.mouse.click(point.x, point.y);
      const volume = await slider.inputValue();
      expect(Number(volume)).toBeLessThan(40);
      await press("audio-sound-mute");
      await press("cancel-options");
      await press("load-mission");
      await expect(page.locator("#save-entries")).toHaveText(
        "No saved missions yet.",
      );
      await press("cancel-load");
      await press("quit-game");
      await expect(page.locator("#game-menu-title")).toHaveText(
        "Thanks for playing",
      );
      await expect(page.locator("#game-menu-description")).toContainText(
        "close this browser tab",
      );
      await press("return-to-title");
      expect(models).toEqual([]);

      await press("new-mission");
      await dismissExplanation(page, "Welcome, Commander", profile.touch);
      await expect(page.locator("#game-canvas")).toHaveAttribute(
        "data-models-ready",
        "true",
      );
      await expect(page.locator("#materials-counter")).toHaveText("150");
      await expect(page.locator(".game-shell")).toBeVisible();
      await press("open-menu");
      await expect(slider).toHaveValue(volume);
      await expect(page.locator("#audio-sound-mute")).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await press("exit-mission");
      await expect(page.locator("#new-mission")).toBeFocused();
      await expect(page.locator(".game-shell")).toBeHidden();
      expect(
        await page.evaluate(async () => {
          const path: string = "/e2e/harness.ts";
          const { EngineStore } = await import(path);
          return EngineStore.Instances.length;
        }),
      ).toBe(0);
      expect(errors).toEqual([]);
    },
  );
});

test(
  "the starting screen rejects invalid imports and loads an existing save paused",
  { tag: WEBKIT },
  async ({ page }) => {
    await page.goto("/");
    await importMission(page, '{"version":0}');
    await expect(page.locator("#game-menu-status")).toContainText(
      "not a mission file",
    );
    await expect(page.locator(".game-shell")).toBeHidden();
    await page.evaluate(async () => {
      const path: string = "/e2e/missions.ts";
      const { level, missionSource } = await import(path);
      const mission = level();
      mission.state.tick = 60;
      mission.state.economy.materials = 77;
      localStorage.setItem(
        "cotuw.save.manual-title",
        missionSource(mission, mission.state, {
          name: "Frontier foothold",
          savedAt: "2026-10-15T12:00:00.000Z",
        }),
      );
    });
    await page.locator("#cancel-load").click();
    await page.locator("#load-mission").click();
    const entry = page
      .locator("#save-entries li")
      .filter({ hasText: "Frontier foothold" });
    await entry.getByRole("button", { name: "Load", exact: true }).click();
    await expect(page.locator("#game-menu-title")).toHaveText("Mission loaded");
    await expect(page.locator("#materials-counter")).toHaveText("77");
    await expect(page.locator("#mission-time")).toHaveText("0:01");
    await page.locator("#inspect-loaded-mission").click();
    await expect(page.locator("#pause-mission")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.locator("#open-menu").click();
    await page.locator("#exit-mission").click();
    await page.locator("#new-mission").click();
    await dismissExplanation(page, "Welcome, Commander");
    await expect(page.locator("#materials-counter")).toHaveText("150");
  },
);

test(
  "keyboard navigation returns from Options and Load without dismissing the title screen",
  { tag: WEBKIT },
  async ({ page, browserName }) => {
    // WebKit follows macOS's option-tab convention for buttons.
    const tab = browserName === "webkit" ? "Alt+Tab" : "Tab";
    await page.goto("/");
    await expect(page.locator("#new-mission")).toBeFocused();
    await page.keyboard.press(tab);
    await expect(page.locator("#load-mission")).toBeFocused();
    await page.keyboard.press(tab);
    await expect(page.locator("#open-options")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#audio-master-volume")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.locator("#new-mission")).toBeFocused();
    await page.keyboard.press(tab);
    await page.keyboard.press("Enter");
    await expect(page.locator("#import-mission")).toBeFocused();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await expect(page.locator("#new-mission")).toBeFocused();
    await expect(page.locator("#game-menu")).toBeVisible();
    await expect(page.locator(".game-shell")).toBeHidden();
  },
);
