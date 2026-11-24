import { expect } from "@playwright/test";
import {
  activate,
  expectTerrainReady,
  launchIntroduction,
  minimapPoint,
  pressPoint,
  terrainPoint,
} from "./page-helpers";

import type { Locator, Page } from "@playwright/test";

declare global {
  interface Window {
    missionClock: number;
    missionStartedAt: number;
    missionVictoryAt: number | null;
  }
}

/** Runs the production mission through its mouse or touch controls. */
export class MissionDriver {
  readonly touch: boolean;
  readonly realTime: boolean;

  constructor(
    readonly page: Page,
    { touch = false, realTime = false } = {},
  ) {
    this.touch = touch;
    this.realTime = realTime;
  }

  /** Opens a page whose clock advances only through `advance`, unless real. */
  private async goto(url: string) {
    await this.page.addInitScript((realTime) => {
      window.missionClock = 0;
      if (realTime) return;
      Object.defineProperty(performance, "now", {
        configurable: true,
        value: () => window.missionClock,
      });
    }, this.realTime);
    await this.page.goto(url);
  }

  /** Opens an explicit level link and renders only through `advance`. */
  async level(id: string) {
    await this.goto(`/?level=${id}`);
    await expectTerrainReady(this.page);
    await this.stopRendering();
  }

  private async stopRendering() {
    if (this.realTime) return;
    await this.page.evaluate(async () => {
      const { EngineStore } = await import("/e2e/harness.ts");
      EngineStore.Instances[0].stopRenderLoop();
    });
  }

  async opening({
    dismissGuide = true,
    faction = "arc",
  }: { dismissGuide?: boolean; faction?: "arc" | "circle" } = {}) {
    await this.goto("/");
    await launchIntroduction(this.page, faction, this.touch);
    await expectTerrainReady(this.page);
    if (dismissGuide)
      await this.explanation(
        faction === "arc" ? "Welcome, Commander" : "Welcome, Guide",
      );
    await this.stopRendering();
    await this.page.evaluate(() => {
      window.missionStartedAt = performance.now();
      window.missionVictoryAt = null;
      const canvas = document.querySelector<HTMLCanvasElement>("#game-canvas")!;
      const observer = new MutationObserver(() => {
        if (canvas.dataset.missionResult !== "victory") return;
        window.missionVictoryAt = performance.now();
        observer.disconnect();
      });
      observer.observe(canvas, {
        attributes: true,
        attributeFilter: ["data-mission-result"],
      });
    });
  }

  async advance(seconds: number) {
    if (this.realTime) await this.page.waitForTimeout(seconds * 1000);
    else
      await this.page.evaluate(async (seconds) => {
        const { EngineStore } = await import("/e2e/harness.ts");
        const engine = EngineStore.Instances[0];
        const scene = engine.scenes[0];
        const frameDelta = engine.getDeltaTime;
        try {
          for (let remaining = seconds; remaining > 0; remaining -= 1) {
            const milliseconds = 1000 * Math.min(1, remaining);
            window.missionClock += milliseconds;
            engine.getDeltaTime = () => milliseconds;
            scene.onBeforeAnimationsObservable.notifyObservers(scene);
            scene.onBeforeRenderObservable.notifyObservers(scene);
            // Record result changes at this frame, not the whole batch's end.
            await Promise.resolve();
          }
        } finally {
          engine.getDeltaTime = frameDelta;
        }
        scene.render();
      }, seconds);
    await expect(this.page.locator("#game-canvas")).not.toHaveAttribute(
      "data-simulation-fault",
      "true",
    );
  }

  private async step(locator: Locator) {
    await activate(locator, this.touch);
    await this.advance(0.05);
  }

  async press(selector: string) {
    await this.step(this.page.locator(selector));
  }

  async focus(x: number, z: number) {
    await pressPoint(
      this.page,
      await minimapPoint(this.page, x, z),
      this.touch,
    );
    await this.advance(0.4);
  }

  async ground(x: number, z: number) {
    const point = await terrainPoint(this.page, x, z);
    const bounds = (await this.page.locator("#game-canvas").boundingBox())!;
    expect(point.x).toBeGreaterThan(bounds.x);
    expect(point.x).toBeLessThan(bounds.x + bounds.width);
    expect(point.y).toBeGreaterThan(bounds.y);
    expect(point.y).toBeLessThan(bounds.y + bounds.height);
    const hit = await this.page.evaluate(async (point) => {
      const { gameScene, pickTerrainTile, prototypeTerrainMap } =
        await import("/e2e/harness.ts");
      const canvas = document.querySelector<HTMLCanvasElement>("#game-canvas")!;
      return pickTerrainTile(gameScene(), canvas, prototypeTerrainMap(), point);
    }, point);
    expect(
      hit,
      "Destination must be visible past foreground mountains",
    ).toEqual({ x, z });
    await pressPoint(this.page, point, this.touch);
    await this.advance(0.05);
  }

  /** Checks a scenario popup's title, then dismisses it. */
  async explanation(title: string) {
    await expect(this.page.locator("#explanation-title")).toHaveText(title);
    await this.press("#dismiss-explanation");
    await expect(this.page.locator("#explanation")).toBeHidden();
  }

  async place(
    type: string,
    x: number,
    z: number,
    guides: { placement?: string; completion?: string } = {},
  ) {
    await this.press("#tab-buildings");
    await this.press(`#build-${type}`);
    if (guides.placement) await this.explanation(guides.placement);
    await this.ground(x, z);
    if (this.touch) await this.press("#confirm-building");
    await expect(this.page.locator("#game-canvas")).toHaveAttribute(
      "data-placement-active",
      "false",
    );
    await this.advance(8);
    if (guides.completion) await this.awaitExplanation(guides.completion);
  }

  /** Advances until a scenario popup appears, then dismisses it. */
  async awaitExplanation(title: string, limit = 30) {
    const guide = this.page.locator("#explanation");
    await this.advanceUntil(() => guide.isVisible(), {
      interval: 1,
      limit,
      description: `the "${title}" guide to appear`,
    });
    await this.explanation(title);
  }

  private async advanceUntil(
    ready: () => Promise<boolean>,
    {
      interval,
      limit,
      description,
    }: { interval: number; limit: number; description: string },
  ) {
    let elapsed = 0;
    while (!(await ready())) {
      if (elapsed >= limit)
        throw new Error(`Waited ${limit} seconds for ${description}.`);
      const seconds = Math.min(interval, limit - elapsed);
      await this.advance(seconds);
      elapsed += seconds;
    }
  }

  async waitForStockpile(minimum: number) {
    const balance = this.page.locator("#materials-counter");
    await this.advanceUntil(
      async () => Number(await balance.textContent()) >= minimum,
      { interval: 10, limit: 300, description: `a stockpile of ${minimum}` },
    );
  }

  rosterUnits(name: string) {
    const roster = this.page.locator("#unit-roster");
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return roster.getByRole("button", {
      name: new RegExp(`^${escapedName} · \\d+$`),
    });
  }

  /** Selects the roster's unit of that name at `index`, in roster order. */
  async select(name: string, index = 0) {
    await this.press("#tab-units");
    await this.step(this.rosterUnits(name).nth(index));
  }

  async selectAll(name: string) {
    await this.select(name);
    await this.step(
      this.page.getByRole("button", {
        name: `Select every ${name} across the map`,
        exact: true,
      }),
    );
  }

  async elapsedSeconds() {
    return this.page.evaluate(() => {
      if (window.missionVictoryAt === null)
        throw new Error("Victory was not recorded.");
      return (window.missionVictoryAt - window.missionStartedAt) / 1000;
    });
  }
}
