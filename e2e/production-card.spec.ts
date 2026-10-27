import { expect, test } from "@playwright/test";
import { forEachProfile, PHONE_PROFILE } from "./profiles";
import { WEBKIT } from "./tags";
import { withoutApp } from "./prototype-helpers";
import type { Page } from "@playwright/test";
import type { ProductionCard } from "../src/ui/production-card";
import type { createProductionCards } from "../src/ui/production-card";

declare global {
  interface Window {
    cardFixture: {
      root: HTMLElement;
      card: ProductionCard;
      factory: ReturnType<typeof createProductionCards>;
      parent: AbortController;
      setReason: (reason: string) => void;
      clicks: number;
    };
  }
}

async function setupCard(page: Page) {
  await withoutApp(page);
  await page.goto("/");
  await page.evaluate(async () => {
    const cardsPath: string = "/src/ui/production-card.ts";
    const actionPath: string = "/src/ui/production-action.ts";
    const { createProductionCards } = await import(cardsPath);
    const { setActionAvailability } = await import(actionPath);
    const root = document.createElement("section");
    root.id = "card-review";
    Object.assign(root.style, {
      position: "fixed",
      left: "340px",
      top: `${Math.max(8, innerHeight - 240)}px`,
      width: "180px",
      zIndex: "20",
    });
    document.body.append(root);
    const parent = new AbortController();
    const factory = createProductionCards(root, parent.signal);
    const card = factory.create(
      root,
      { id: "review-unit", label: "Train Runner" },
      { id: "runner", behaviorId: "idle", movement: { speed: 1 } },
      {
        name: "Runner",
        details: "A fast reconnaissance unit",
        cost: "20 Materials",
      },
    );
    window.cardFixture = {
      root,
      card,
      factory,
      parent,
      setReason: (reason) => setActionAvailability(card, reason),
      clicks: 0,
    };
    card.button.addEventListener("click", () => window.cardFixture.clicks++);
    window.cardFixture.setReason("Need 20 Materials.");
  });
}

test.beforeEach(async ({ page }) => setupCard(page));

test("descriptions avoid existing elements and authored button IDs", async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const prefix = "production-description-";
    const lastId = Math.max(
      0,
      ...Array.from(document.querySelectorAll(`[id^="${prefix}"]`), (node) =>
        Number(node.id.slice(prefix.length)),
      ),
    );
    const reserved = document.createElement("span");
    reserved.id = `${prefix}${lastId + 1}`;
    reserved.textContent = "Unrelated description";
    document.body.append(reserved);
    const { root, factory } = window.cardFixture;
    const card = factory.create(
      root,
      { id: `${prefix}${lastId + 2}`, label: "Train Scout" },
      { id: "scout", behaviorId: "idle", movement: { speed: 1 } },
      { name: "Scout", details: "A scouting unit" },
    );
    const descriptionId = card.button.getAttribute("aria-describedby")!;
    return {
      buttonId: card.button.id,
      descriptionId,
      reservedId: reserved.id,
      matches: document.querySelectorAll(`[id="${descriptionId}"]`).length,
    };
  });
  expect(result.descriptionId).not.toBe(result.reservedId);
  expect(result.descriptionId).not.toBe(result.buttonId);
  expect(result.matches).toBe(1);
  await expect(
    page.getByRole("button", { name: "Train Scout" }),
  ).toHaveAccessibleDescription("A scouting unit");
});

test(
  "disabled cards keep accessible focus as availability changes",
  { tag: WEBKIT },
  async ({ page }) => {
    const card = page.locator("#card-review .production-card");
    const button = page.locator("#review-unit");
    await card.focus();
    await expect(card).toHaveAccessibleName("Train Runner");
    await expect(card).toHaveAccessibleDescription(/Need 20 Materials/);
    await card.hover();
    await page.mouse.move(700, 450);
    await expect(page.getByRole("tooltip")).toBeVisible();
    await page.evaluate(() => window.cardFixture.setReason(""));
    await expect(button).toBeFocused();
    await button.press("Enter");
    expect(await page.evaluate(() => window.cardFixture.clicks)).toBe(1);
    await page.evaluate(() =>
      window.cardFixture.setReason("Production queue full."),
    );
    await expect(card).toBeFocused();
    await expect(page.getByRole("tooltip")).toContainText(
      "Production queue full",
    );
  },
);

test("activation hides its tooltip when the action immediately disables itself", async ({
  page,
}) => {
  await page.evaluate(() => {
    const { card, setReason } = window.cardFixture;
    setReason("");
    card.button.addEventListener("click", () => setReason("Order pending."));
  });
  const button = page.locator("#review-unit");
  await button.focus();
  await expect(page.getByRole("tooltip")).toBeVisible();
  await button.press("Enter");
  await expect(button).toBeDisabled();
  await expect(page.locator("#card-review .production-card")).toBeFocused();
  await expect(page.getByRole("tooltip")).toBeHidden();
});

test(
  "tooltip content stays within the viewport and Escape consumes only its own dismissal",
  { tag: WEBKIT },
  async ({ page }) => {
    await page.evaluate(() => window.cardFixture.card.card.focus());
    await page.evaluate(() =>
      window.cardFixture.setReason("Restore the support network. ".repeat(120)),
    );
    await expect(page.getByRole("tooltip")).toBeInViewport({ ratio: 1 });
    const dismissal = await page.evaluate(() => {
      let bubbled = 0;
      const observe = () => bubbled++;
      window.addEventListener("keydown", observe);
      const key = () =>
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        });
      const first = window.cardFixture.card.card.dispatchEvent(key());
      const second = window.cardFixture.card.card.dispatchEvent(key());
      window.removeEventListener("keydown", observe);
      return { first, second, bubbled };
    });
    expect(dismissal).toEqual({ first: false, second: true, bubbled: 1 });
    await expect(page.getByRole("tooltip")).toBeHidden();
    await page.locator("#card-review .production-card").hover();
    await expect(page.getByRole("tooltip")).toBeVisible();
    const bounds = (await page.getByRole("tooltip").boundingBox())!;
    await page.mouse.move(bounds.x + 10, bounds.y + 10);
    await expect(page.getByRole("tooltip")).toBeVisible();
  },
);

for (const end of ["dispose", "abort"] as const) {
  test(`${end} releases the tooltip and all event listeners`, async ({
    page,
  }) => {
    const tooltipCount = await page.locator(".production-tooltip").count();
    await page.locator("#card-review .production-card").focus();
    await page.evaluate((end) => {
      const { factory, parent } = window.cardFixture;
      if (end === "dispose") factory.dispose();
      else parent.abort();
    }, end);
    await expect(page.locator(".production-tooltip")).toHaveCount(
      tooltipCount - 1,
    );
    await page.locator("#card-review .production-card").hover();
    expect(
      await page.evaluate(() =>
        window.cardFixture.card.card.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Escape",
            bubbles: true,
            cancelable: true,
          }),
        ),
      ),
    ).toBe(true);
    await expect(page.getByRole("tooltip")).toHaveCount(0);
  });
}

forEachProfile([PHONE_PROFILE], () => {
  test(
    "touch can inspect an unavailable card without activating it",
    { tag: WEBKIT },
    async ({ page }) => {
      await setupCard(page);
      await page.locator("#card-review .production-card").tap();
      await expect(page.getByRole("tooltip")).toContainText(
        "Need 20 Materials",
      );
      expect(await page.evaluate(() => window.cardFixture.clicks)).toBe(0);
      await page.locator("#tab-goals").tap();
      await expect(page.getByRole("tooltip")).toBeHidden();
    },
  );
});
