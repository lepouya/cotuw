import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { activate, terrainPoint } from "./prototype-helpers";

declare global {
  interface Window {
    missionClock: number;
    missionStartedAt: number;
    missionVictoryAt: number | null;
  }
}

/** Runs the production mission through its mouse or touch controls. */
export class MissionDriver {
  constructor(
    readonly page: Page,
    readonly touch: boolean,
    readonly realTime: boolean,
  ) {}

  async opening() {
    await this.page.addInitScript((realTime) => {
      window.missionClock = 0;
      if (realTime) return;
      Object.defineProperty(performance, "now", {
        configurable: true,
        value: () => window.missionClock,
      });
    }, this.realTime);
    await this.page.goto("/");
    await expect(this.page.locator("#game-canvas")).toHaveAttribute(
      "data-terrain-ready",
      "true",
    );
    await this.page.evaluate(async (realTime) => {
      if (!realTime) {
        const path: string = "/e2e/harness.ts";
        const { EngineStore } = await import(path);
        EngineStore.Instances[0].stopRenderLoop();
      }
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
    }, this.realTime);
  }

  async advance(seconds: number) {
    if (this.realTime) await this.page.waitForTimeout(seconds * 1000);
    else
      await this.page.evaluate(async (seconds) => {
        const path: string = "/e2e/harness.ts";
        const { EngineStore } = await import(path);
        const engine = EngineStore.Instances[0];
        const scene = engine.scenes[0];
        const frameDelta = engine.getDeltaTime;
        try {
          for (let remaining = seconds; remaining > 0; remaining -= 1) {
            const milliseconds = 1000 * Math.min(1, remaining);
            window.missionClock += milliseconds;
            engine.getDeltaTime = () => milliseconds;
            scene.onBeforeRenderObservable.notifyObservers(scene);
            // Record result changes at this frame rather than the whole batch's end.
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

  private async activate(locator: Locator) {
    await activate(locator, this.touch);
    await this.advance(0.05);
  }

  private async point(point: { x: number; y: number }) {
    if (this.touch) await this.page.touchscreen.tap(point.x, point.y);
    else await this.page.mouse.click(point.x, point.y);
  }

  async press(selector: string) {
    await this.activate(this.page.locator(selector));
  }

  async focus(x: number, z: number) {
    const point = await this.page.evaluate(
      async ({ x, z }) => {
        const path: string = "/e2e/harness.ts";
        const { minimapProjection, prototypeTerrainMap } = await import(path);
        const map = prototypeTerrainMap();
        const canvas = document.querySelector<HTMLCanvasElement>("#minimap")!;
        const bounds = canvas.getBoundingClientRect();
        const point = minimapProjection(
          map,
          bounds.width,
          bounds.height,
        ).toMinimap(map.tileCenter(x, z));
        return { x: bounds.left + point.x, y: bounds.top + point.y };
      },
      { x, z },
    );
    await this.point(point);
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
      const path: string = "/e2e/harness.ts";
      const terrainPath: string = "/src/render/terrain-mesh.ts";
      const { EngineStore, prototypeTerrainMap } = await import(path);
      const { isTerrainPickMesh } = await import(terrainPath);
      const canvas = document.querySelector<HTMLCanvasElement>("#game-canvas")!;
      const bounds = canvas.getBoundingClientRect();
      const picked = EngineStore.Instances[0].scenes[0].pick(
        point.x - bounds.left,
        point.y - bounds.top,
        isTerrainPickMesh,
      )?.pickedPoint;
      return (
        picked && prototypeTerrainMap().tileAtWorldPosition(picked.x, picked.z)
      );
    }, point);
    expect(
      hit,
      "Destination must be visible past foreground mountains",
    ).toEqual({ x, z });
    await this.point(point);
    await this.advance(0.05);
  }

  /** Checks a scenario popup's title, then dismisses it. */
  async explanation(title: string) {
    await expect(this.page.locator("#explanation-title")).toHaveText(title);
    await this.press("#dismiss-explanation");
    await expect(this.page.locator("#explanation")).toBeHidden();
  }

  async place(type: string, x: number, z: number, explanation?: string) {
    await this.press("#tab-buildings");
    await this.press(`#build-${type}`);
    if (explanation) await this.explanation(explanation);
    await this.ground(x, z);
    if (this.touch) await this.press("#confirm-building");
    await expect(this.page.locator("#game-canvas")).toHaveAttribute(
      "data-placement-active",
      "false",
    );
    await this.advance(8);
  }

  async materials(minimum: number) {
    for (let elapsed = 0; elapsed <= 300; elapsed += 10) {
      if (
        Number(await this.page.locator("#materials-counter").textContent()) >=
        minimum
      )
        return;
      if (elapsed < 300) await this.advance(10);
    }
    throw new Error(
      `Gathering did not deliver ${minimum} Materials within five minutes.`,
    );
  }

  async select(name: string) {
    await this.press("#tab-units");
    await this.activate(
      this.page
        .locator("#unit-roster button")
        .filter({ hasText: name })
        .first(),
    );
  }

  async selectTroopers() {
    await this.select("Trooper");
    await this.press("#add-selection");
    await this.press("#tab-units");
    const troopers = this.page
      .locator("#unit-roster button")
      .filter({ hasText: "Trooper" });
    const count = await troopers.count();
    for (let i = 1; i < count; i++) {
      await this.activate(troopers.nth(i));
      await this.press("#tab-units");
    }
    await this.press("#add-selection");
  }

  async elapsedSeconds() {
    return this.page.evaluate(() => {
      if (window.missionVictoryAt === null)
        throw new Error("Victory was not recorded.");
      return (window.missionVictoryAt - window.missionStartedAt) / 1000;
    });
  }
}
