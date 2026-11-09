import { expect, test } from "./fixtures";
import { attachScreenshot, collectPageErrors } from "./page-helpers";
import { WEBKIT } from "./tags";

import type { Page } from "@playwright/test";

async function openSkirmish(page: Page, query: string) {
  await page.goto(`/?${query}`);
  const canvas = page.locator("#game-canvas");
  await expect(canvas).toHaveAttribute("data-terrain-ready", "true");
  await canvas.focus();
}

test(
  "development AI links cycle the overlay through AI owners",
  { tag: WEBKIT },
  async ({ page }, info) => {
    const errors = collectPageErrors(page, { console: true });
    await openSkirmish(
      page,
      "skirmish=arc-arc&ai=west:arc-skirmish,east:arc-skirmish",
    );
    const overlay = page.locator("#ai-overlay");
    await expect(overlay).toBeHidden();
    await page.keyboard.press("Escape");
    await expect(page.locator("#game-menu")).toBeVisible();
    await page.keyboard.press("Backquote");
    await expect(overlay).toBeHidden();
    await page.keyboard.press("Escape");
    await page.locator("#game-canvas").focus();
    await page.keyboard.press("Backquote");
    await expect(overlay).toHaveAttribute("data-owner", "west");
    await expect(overlay).toContainText("posture establishing");
    await attachScreenshot(page, info, "ai-overlay");
    await page.keyboard.press("Backquote");
    await expect(overlay).toHaveAttribute("data-owner", "east");
    await page.keyboard.press("Backquote");
    await expect(overlay).toBeHidden();

    // Restart replaces the session's panel rather than adding another.
    await page.keyboard.press("Escape");
    await page.locator("#restart-mission").click();
    await expect(page.locator("#game-menu")).toBeHidden();
    await expect(page.locator("#game-canvas")).toHaveAttribute(
      "data-terrain-ready",
      "true",
    );
    await page.locator("#game-canvas").focus();
    await page.keyboard.press("Backquote");
    await expect(overlay).toHaveCount(1);
    await expect(overlay).toBeVisible();
    expect(errors).toEqual([]);
  },
);

test("ordinary skirmish links have no AI overlay", async ({ page }) => {
  await openSkirmish(page, "skirmish=arc-arc");
  await page.keyboard.press("Backquote");
  await expect(page.locator("#ai-overlay")).toHaveCount(0);
});
