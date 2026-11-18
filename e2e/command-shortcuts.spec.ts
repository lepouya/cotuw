import { expect, test } from "./fixtures";
import {
  dismissExplanation,
  expectTerrainReady,
  terrainPoint,
} from "./page-helpers";
import { WEBKIT } from "./tags";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "keyboard", { value: undefined });
  });
});

test(
  "shortcuts follow the visible production panel and yield during placement",
  { tag: WEBKIT },
  async ({ page }) => {
    await page.goto("/?level=sandbox");
    await expectTerrainReady(page);
    const canvas = page.locator("#game-canvas");
    await page.locator("#tab-goals").click();
    await page.keyboard.press("KeyW");
    await expect(canvas).toHaveAttribute("data-placement-active", "false");
    await page.keyboard.press("KeyB");
    await expect(page.locator("#tab-buildings")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.locator("#build-barracks")).toHaveAttribute(
      "aria-keyshortcuts",
      "W",
    );
    const field = page.locator("#shortcut-test-input");
    await page.evaluate(() => {
      const input = document.createElement("input");
      input.id = "shortcut-test-input";
      document.body.append(input);
      input.focus();
    });
    await page.keyboard.press("KeyW");
    await expect(field).toHaveValue("w");
    await expect(canvas).toHaveAttribute("data-placement-active", "false");
    await field.evaluate((input) => input.remove());
    await page.keyboard.press("KeyW");
    await expect(canvas).toHaveAttribute("data-placement-active", "true");
    await page.keyboard.press("KeyR");
    await expect(canvas).toHaveAttribute("data-placement-rotation", "1");
    await page.keyboard.press("KeyQ");
    await expect(page.locator("#placement-status")).toContainText(
      "Field Barracks",
    );
    await page.keyboard.press("Escape");
    await expect(canvas).toHaveAttribute("data-placement-active", "false");
    await page.keyboard.press("KeyW");
    const point = await terrainPoint(page, 49, 39);
    await page.mouse.click(point.x, point.y);
    await expect(canvas).toHaveAttribute("data-placement-active", "false");
    await expect(page.locator("#tab-units")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.locator("#train-trooper")).toHaveAttribute(
      "aria-keyshortcuts",
      "Q",
    );
    await page.keyboard.press("KeyQ");
    await expect(page.locator("#unit-roster button")).toHaveCount(1);
    await expect(page.locator("#unit-roster button").first()).toContainText(
      "Trooper",
    );
  },
);

test(
  "Circle's first construction slot explains an unavailable Cultivator",
  { tag: WEBKIT },
  async ({ page }) => {
    await page.goto("/?level=circle-wolf-den");
    await dismissExplanation(page, "Welcome, Guide");
    await page.keyboard.press("KeyB");
    await expect(page.locator("#build-circle-conservatory")).toHaveAttribute(
      "aria-keyshortcuts",
      "Q",
    );
    await page.keyboard.press("KeyQ");
    await expect(page.getByRole("tooltip")).toContainText(
      "Select a Cultivator to tend construction",
    );
    await expect(page.locator("#game-canvas")).toHaveAttribute(
      "data-placement-active",
      "false",
    );
  },
);

test(
  "Options saves live bindings, reports conflicts, and yields host chords",
  { tag: WEBKIT },
  async ({ page }) => {
    await page.goto("/");
    await page.locator("#open-options").click();
    const layout = page.getByLabel("Keyboard layout");
    const rebind = page.getByRole("button", { name: /^Rebind Open Buildings/ });
    const status = page.locator(".keyboard-status");
    await layout.selectOption("azerty");
    await expect(
      page.getByRole("button", { name: "Rebind Attack Move (Q)" }),
    ).toBeVisible();
    await rebind.click();
    await page.keyboard.press("KeyS");
    await expect(status).toHaveText("Already used by Stop.");
    const defaultPrevented = await rebind.evaluate((button) => {
      const event = new KeyboardEvent("keydown", {
        code: "KeyR",
        key: "r",
        metaKey: true,
        bubbles: true,
        cancelable: true,
      });
      button.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(defaultPrevented).toBe(false);
    await expect(status).toContainText("reserved");
    const gameOwnsF5 = await rebind.evaluate((button) => {
      const event = new KeyboardEvent("keydown", {
        code: "F5",
        key: "F5",
        bubbles: true,
        cancelable: true,
      });
      button.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(gameOwnsF5).toBe(true);
    await page.keyboard.press("Escape");
    await expect(layout).toBeVisible();
    await expect(rebind).toHaveText("B");
    await rebind.click();
    await page.keyboard.press("KeyV");
    await expect(rebind).toHaveText("V");
    await page.goto("/?level=sandbox");
    await expectTerrainReady(page);
    await page.locator("#tab-units").click();
    await page.keyboard.press("KeyB");
    await expect(page.locator("#tab-units")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await page.keyboard.press("KeyV");
    await expect(page.locator("#tab-buildings")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.locator("#build-command-center")).toHaveAttribute(
      "aria-keyshortcuts",
      "A",
    );
    await page.locator("#open-menu").click();
    await page.locator("#open-options").click();
    await expect(layout).toHaveValue("azerty");
    await page.keyboard.press("KeyA");
    await expect(layout).toBeVisible();
    await layout.selectOption("qwertz");
    await rebind.click();
    await page.keyboard.press("BracketRight");
    await expect(rebind).toHaveText("+");
    await expect(page.locator("#tab-buildings")).toHaveAttribute(
      "aria-keyshortcuts",
      "Plus",
    );
    await page.getByRole("button", { name: "Reset keyboard defaults" }).click();
    await expect(layout).toHaveValue("auto");
    await page.locator("#cancel-options").click();
    await page.locator("#resume-mission").click();
    await expect(page.locator("#tab-buildings")).toHaveAttribute(
      "aria-keyshortcuts",
      "B",
    );
    await expect(page.locator("#build-command-center")).toHaveAttribute(
      "aria-keyshortcuts",
      "Q",
    );
  },
);
