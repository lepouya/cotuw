import { expect } from "@playwright/test";

import type { Locator, Page, TestInfo } from "@playwright/test";

type ScreenPoint = { x: number; y: number };

/** Records uncaught page errors, plus console errors when requested. */
export function collectPageErrors(page: Page, { console = false } = {}) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  if (console)
    page.on("console", (message) => {
      const { url } = message.location();
      // The app ships no favicon, so the browser's automatic request 404s.
      if (message.type() === "error" && !url.endsWith("/favicon.ico"))
        errors.push(`${message.text()} (${url})`);
    });
  return errors;
}

/** Uses the same input modality throughout a browser flow. */
export async function activate(locator: Locator, touch = false) {
  if (touch) await locator.tap();
  else await locator.click();
}

/** Taps or clicks a screen point in the flow's input modality. */
export async function pressPoint(
  page: Page,
  { x, y }: ScreenPoint,
  touch = false,
) {
  if (touch) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
}

/** Synthetic drags exercise the app's pointer contract on both webviews. */
export async function touchDrag(
  page: Page,
  from: ScreenPoint,
  to: ScreenPoint,
) {
  await page.evaluate(
    ({ from, to }) => {
      const canvas = document.querySelector<HTMLCanvasElement>("#game-canvas")!;
      for (const [type, point] of [
        ["pointerdown", from],
        ["pointermove", to],
        ["pointerup", to],
      ] as const)
        canvas.dispatchEvent(
          new PointerEvent(type, {
            pointerId: 31,
            pointerType: "touch",
            button: 0,
            buttons: type === "pointerup" ? 0 : 1,
            clientX: point.x,
            clientY: point.y,
            bubbles: true,
          }),
        );
    },
    { from, to },
  );
}

export async function expectTerrainReady(page: Page) {
  await expect(page.locator("#game-canvas")).toHaveAttribute(
    "data-terrain-ready",
    "true",
  );
}

export async function attachScreenshot(
  page: Page,
  info: TestInfo,
  name: string,
) {
  await info.attach(name, {
    body: await page.screenshot(),
    contentType: "image/png",
  });
}

/** Holds matching requests until the returned function runs. */
export async function holdRequests(page: Page, url: string) {
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(url, async (route) => {
    await held;
    await route.continue();
  });
  return release;
}

export async function terrainPoint(page: Page, x: number, z: number) {
  return page.evaluate(
    async ({ x, z }) => {
      const { gameScene, Vector3, projectToCanvas, prototypeTerrainMap } =
        await import("/e2e/harness.ts");
      const map = prototypeTerrainMap();
      const point = map.tileCenter(x, z);
      const canvas = document.querySelector<HTMLCanvasElement>("#game-canvas")!;
      return projectToCanvas(
        gameScene(),
        canvas,
        new Vector3(
          point.x,
          map.heightAtWorldPosition(point.x, point.z),
          point.z,
        ),
      );
    },
    { x, z },
  );
}

/** Serves the production HTML and styles without the app, out of the title. */
export async function withoutApp(page: Page) {
  await page.route(
    (url) => url.pathname === "/src/main.ts",
    (route) =>
      route.fulfill({
        contentType: "text/javascript",
        body: 'import "/src/styles.css"; document.body.classList.remove("at-title");',
      }),
  );
}

/** Checks a scenario popup's title, then dismisses it. */
export async function dismissExplanation(
  page: Page,
  title: string,
  touch = false,
) {
  await expect(page.locator("#explanation-title")).toHaveText(title);
  await activate(page.locator("#dismiss-explanation"), touch);
  await expect(page.locator("#explanation")).toBeHidden();
}

/** Chooses the ARC opening from the start menu and acknowledges its guide. */
export async function startOpening(page: Page, touch = false) {
  await activate(page.locator("#new-mission"), touch);
  await activate(page.locator("#choose-arc"), touch);
  await dismissExplanation(page, "Welcome, Commander", touch);
}

/** Starts the authored opening and acknowledges its introductory guide. */
export async function openOpening(page: Page, touch = false) {
  await page.goto("/");
  await startOpening(page, touch);
}

export async function placeBuilding(
  page: Page,
  buttonId: string,
  x: number,
  z: number,
  {
    explanation,
    touch = false,
  }: {
    /** The popup title that starting this placement shows. */
    explanation?: string;
    touch?: boolean;
  } = {},
) {
  const canvas = page.locator("#game-canvas");
  const count = Number(
    await canvas.getAttribute("data-tile-placed-actor-count"),
  );
  await activate(page.locator("#tab-buildings"), touch);
  await activate(page.locator(`#${buttonId}`), touch);
  if (explanation) await dismissExplanation(page, explanation, touch);
  const point = await terrainPoint(page, x, z);
  if (touch) await page.touchscreen.tap(point.x, point.y);
  else await page.mouse.move(point.x, point.y);
  await expect(canvas).toHaveAttribute("data-placement-status", "valid");
  if (touch) await page.locator("#confirm-building").tap();
  else await page.mouse.click(point.x, point.y);
  await expect(canvas).toHaveAttribute("data-placement-active", "false");
  await expect(canvas).toHaveAttribute(
    "data-tile-placed-actor-count",
    String(count + 1),
  );
}

export async function trainTestUnits(
  page: Page,
  units = ["trooper", "scout"],
  touch = false,
) {
  await expectTerrainReady(page);
  await placeBuilding(page, "build-barracks", 49, 39, { touch });
  await activate(page.locator("#tab-units"), touch);
  for (const [index, unit] of units.entries()) {
    const button = page.locator(`#train-${unit}`);
    await expect(button).toBeEnabled();
    await activate(button, touch);
    await expect(page.locator("#unit-roster button")).toHaveCount(index + 1);
    await expect
      .poll(() =>
        page.evaluate(async (id) => {
          const { gameScene } = await import("/e2e/harness.ts");
          return !!gameScene().getTransformNodeByName(
            `actor-trained-unit-${id}-root`,
          );
        }, index + 1),
      )
      .toBe(true);
  }
}

/** Opens the sandbox with one trained trooper selected. */
export async function openWithTrooper(page: Page, touch = false) {
  await page.goto("/?level=sandbox");
  await trainTestUnits(page, ["trooper"], touch);
  await activate(page.locator("#unit-roster button").first(), touch);
  await expect(page.locator("#game-canvas")).toHaveAttribute(
    "data-selected-actors",
    '["trained-unit-1"]',
  );
}

/** Imports a mission file through the game menu's Load panel. */
export async function importMission(
  page: Page,
  source: string,
  name = "mission.json",
) {
  if (!(await page.locator("#game-menu").isVisible()))
    await page.locator("#open-menu").click();
  if (await page.locator("#load-panel").isHidden())
    await page.locator("#load-mission").click();
  const chooser = page.waitForEvent("filechooser");
  await page.locator("#import-mission").click();
  await (
    await chooser
  ).setFiles({
    name,
    mimeType: "application/json",
    buffer: Buffer.from(source),
  });
}

export async function quickSave(page: Page) {
  await page.keyboard.press("F5");
  await expect(page.locator("#notifications")).toContainText(
    "Quick save complete",
  );
}

/**
 * Runs real tick callbacks for a session under `controlSessionClock`, one
 * frame per simulated second, then renders.
 */
export async function advance(page: Page, seconds: number) {
  await page.evaluate((seconds) => {
    const harness = window.sessionHarness;
    const { scene } = harness.view;
    for (let i = 0; i < Math.ceil(seconds); i++) {
      harness.now += 1000 * Math.min(1, seconds - i);
      scene.onBeforeAnimationsObservable.notifyObservers(scene);
      scene.onBeforeRenderObservable.notifyObservers(scene);
    }
    scene.render();
  }, seconds);
}

/** Selects an actor in a session under `controlSessionClock`. */
export async function selectInSession(page: Page, id: string) {
  await page.evaluate((id) => window.sessionHarness.view.selectActor(id), id);
  await advance(page, 0.1);
}
