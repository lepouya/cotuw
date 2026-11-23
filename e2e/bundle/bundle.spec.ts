import { expect, test } from "../fixtures";
import { collectPageErrors, expectTerrainReady } from "../page-helpers";

import type { Page, Response } from "@playwright/test";
import type { MissionFile } from "../../src/simulation/mission-file";

// Production bundles expose no test harness, so these flows use only the DOM
// and the canvas status attributes.

const FACTIONS = [
  {
    id: "circle",
    label: "Circle of Repose",
    resource: "150 Lifebloom",
    headquarters: "Heartgrove",
    worker: { buttonId: "train-circle-cultivator", name: /^Cultivator · / },
    dropOff: {
      buttonId: "build-circle-conservatory",
      id: "circle-conservatory",
    },
    music: "circle-frontier.wav",
  },
  {
    id: "arc",
    label: "Anomaly Response Command",
    resource: "150 Materials",
    worker: { buttonId: "train-harvester", name: /^Harvester · / },
    dropOff: { buttonId: "build-refinery", id: "arc-materials-refinery" },
    music: "unquiet-frontier.wav",
  },
] as const;

type Faction = (typeof FACTIONS)[number];

/** Records every failed request, so missing models or audio fail the run. */
function collectFailedRequests(page: Page) {
  const failed: string[] = [];
  page.on("requestfailed", (request) => failed.push(request.url()));
  page.on("response", (response) => {
    if (response.status() >= 400 && !response.url().endsWith("/favicon.ico"))
      failed.push(`${response.status()} ${response.url()}`);
  });
  return failed;
}

async function dismissGuides(page: Page) {
  const guide = page.locator("#explanation");
  while (await guide.isVisible())
    await page.locator("#dismiss-explanation").click();
}

async function awaitReady(page: Page) {
  await expectTerrainReady(page);
  const canvas = page.locator("#game-canvas");
  await expect(canvas).toHaveAttribute("data-models-ready", "true");
  await dismissGuides(page);
}

async function expectAudio(page: Page, music: Promise<Response>) {
  expect((await music).ok()).toBe(true);
  await expect(page.locator("#audio-status")).toHaveAttribute(
    "data-audio-state",
    "ready",
  );
}

const frame = (page: Page) =>
  page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );

/**
 * Visits uncovered canvas points outward from the center of the visible map,
 * where the camera starts on the headquarters, until `found` returns true.
 */
async function sweep(
  page: Page,
  found: (point: { x: number; y: number }) => Promise<boolean>,
) {
  const sidebar = (await page.locator("#game-sidebar").boundingBox())!;
  const topBar = (await page.locator("#top-bar").boundingBox())!;
  const viewport = page.viewportSize()!;
  const left = sidebar.x + sidebar.width;
  const top = topBar.y + topBar.height;
  const center = {
    x: (left + viewport.width) / 2,
    y: (top + viewport.height) / 2,
  };
  if (await found(center)) return;
  for (let ring = 1; ring <= 10; ring++)
    for (let step = 0; step < ring * 8; step++) {
      const angle = (2 * Math.PI * step) / (ring * 8);
      const point = {
        x: center.x + ring * 25 * Math.cos(angle),
        y: center.y + ring * 20 * Math.sin(angle),
      };
      const onCanvas = await page.evaluate(
        ({ x, y }) => document.elementFromPoint(x, y)?.id === "game-canvas",
        point,
      );
      if (onCanvas && (await found(point))) return;
    }
  throw new Error("No matching point near the view center.");
}

/** Clicks near the view center until the starting headquarters is selected. */
async function selectHeadquarters(page: Page, name: string) {
  const details = page.locator("#selection-details");
  await sweep(page, async ({ x, y }) => {
    await page.mouse.click(x, y);
    await frame(page);
    return (await details.textContent())?.includes(name) ?? false;
  });
}

async function placeNearCenter(page: Page, buttonId: string) {
  const canvas = page.locator("#game-canvas");
  const placed = Number(
    await canvas.getAttribute("data-tile-placed-actor-count"),
  );
  await page.locator("#tab-buildings").click();
  await page.locator(`#${buttonId}`).click();
  await dismissGuides(page);
  await sweep(page, async ({ x, y }) => {
    await page.mouse.move(x, y);
    await frame(page);
    if ((await canvas.getAttribute("data-placement-status")) !== "valid")
      return false;
    await page.mouse.click(x, y);
    return true;
  });
  await expect(canvas).toHaveAttribute("data-placement-active", "false");
  await expect
    .poll(async () =>
      Number(await canvas.getAttribute("data-tile-placed-actor-count")),
    )
    .toBeGreaterThan(placed);
  // The guide can pause the simulation when construction completes.
  const queue = page.locator("#construction-queue button");
  await expect(queue).toHaveCount(0);
  await dismissGuides(page);
}

async function trainWorker(page: Page, { buttonId, name }: Faction["worker"]) {
  await page.locator("#tab-units").click();
  const button = page.locator(`#${buttonId}`);
  await expect(button).toBeEnabled({ timeout: 60_000 });
  await button.click();
  const worker = page.locator("#unit-roster").getByRole("button", { name });
  await expect(worker).toBeVisible({ timeout: 60_000 });
  await dismissGuides(page);
  return worker;
}

async function buildOpening(page: Page, faction: Faction) {
  await page.locator('[data-speed="4"]').click();
  if ("headquarters" in faction) {
    await selectHeadquarters(page, faction.headquarters);
    const worker = await trainWorker(page, faction.worker);
    await worker.click();
    await placeNearCenter(page, faction.dropOff.buttonId);
  } else {
    await placeNearCenter(page, faction.dropOff.buttonId);
    await trainWorker(page, faction.worker);
  }
}

async function openMenu(page: Page) {
  await dismissGuides(page);
  await page.locator("#open-menu").click();
  await expect(page.locator("#game-menu")).toBeVisible();
}

/** Exports and stores a named save, then loads it back. */
async function saveExportAndLoad(page: Page, name: string) {
  await openMenu(page);
  const stock = await page.locator("#materials-counter").textContent();
  await page.locator("#save-mission").click();
  await page.locator("#save-name").fill(name);
  const download = page.waitForEvent("download");
  await page.locator("#export-mission").click();
  let source = "";
  for await (const chunk of await (await download).createReadStream())
    source += chunk;
  const saved: MissionFile = JSON.parse(source);
  expect(saved.save?.name).toBe(name);
  await page.locator("#confirm-save").click();
  await page.locator("#load-mission").click();
  const entry = page.locator("#save-entries li", { hasText: name });
  await entry.getByRole("button", { name: "Load", exact: true }).click();
  await expect(page.locator("#game-menu-title")).toHaveText("Mission loaded");
  await expect(page.locator("#materials-counter")).toHaveText(stock!);
  await page.locator("#resume-mission").click();
  return saved;
}

async function restart(page: Page) {
  await openMenu(page);
  await page.locator("#restart-mission").click();
  await awaitReady(page);
}

async function returnToTitle(page: Page) {
  await openMenu(page);
  await page.locator("#exit-mission").click();
  await expect(page.locator("#new-mission")).toBeVisible();
}

function expectCompletedOpening(saved: MissionFile, faction: Faction) {
  const dropOff = saved.state.actors.find(
    (actor) =>
      actor.owner === saved.state.playerOwner &&
      actor.definitionId === faction.dropOff.id,
  );
  expect(dropOff).toBeDefined();
  expect(dropOff?.construction).toBeUndefined();
}

for (const faction of FACTIONS) {
  test(`the ${faction.id} introduction starts, saves, and restarts`, async ({
    page,
  }) => {
    const errors = collectPageErrors(page, { console: true });
    const failed = collectFailedRequests(page);
    await page.goto("./");
    const music = page.waitForResponse(`**/assets/audio/${faction.music}`);
    await page.locator("#new-mission").click();
    await page.locator(`#choose-${faction.id}`).click();
    await expect(page.locator("#explanation")).toBeVisible();
    await awaitReady(page);
    await expectAudio(page, music);
    await expect(page.locator("#faction-label")).toHaveText(faction.label);
    await expect(page.locator("#resource-bar")).toHaveAttribute(
      "aria-label",
      faction.resource,
    );
    await buildOpening(page, faction);
    const saved = await saveExportAndLoad(page, `Smoke ${faction.id}`);
    expectCompletedOpening(saved, faction);
    await restart(page);
    await expect(page.locator("#unit-roster button")).toHaveCount(0);
    await returnToTitle(page);
    expect(errors).toEqual([]);
    expect(failed).toEqual([]);
  });

  test(`the ${faction.id} skirmish link builds both bases and restarts`, async ({
    page,
  }) => {
    const errors = collectPageErrors(page, { console: true });
    const failed = collectFailedRequests(page);
    const canvas = page.locator("#game-canvas");
    const overlay = page.locator("#ai-overlay");
    const expectLaunch = async () => {
      await expect(page.locator("#faction-label")).toHaveText(faction.label);
      await expect(canvas).toHaveAttribute("data-difficulty", "normal");
      await canvas.focus();
      await page.keyboard.press("Backquote");
      await expect(overlay.getByRole("heading", { level: 2 })).toHaveText(
        "AI east · arc-skirmish",
      );
    };
    await page.goto(
      `./?skirmish=${faction.id}-arc&player=west&difficulty=normal&ai=east:arc-skirmish`,
    );
    await awaitReady(page);
    await expectLaunch();
    await buildOpening(page, faction);
    await expect(overlay).toContainText("place-actor ok", { timeout: 120_000 });
    const saved = await saveExportAndLoad(page, "Smoke skirmish");
    expectCompletedOpening(saved, faction);
    expect(saved.state.playerOwner).toBe("west");
    expect(saved.scenario.ai).toEqual([
      { owner: "east", profileId: "arc-skirmish" },
    ]);
    await restart(page);
    await expectLaunch();
    await returnToTitle(page);
    expect(errors).toEqual([]);
    expect(failed).toEqual([]);
  });
}
