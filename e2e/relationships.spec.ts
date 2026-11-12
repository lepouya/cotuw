import { expect, test } from "./fixtures";
import {
  advance,
  expectTerrainReady,
  selectInSession,
  withoutApp,
} from "./page-helpers";
import { WEBKIT } from "./tags";

import type { Page } from "@playwright/test";
import type { PBRMaterial } from "@babylonjs/core";

declare global {
  interface Window {
    /** Actor IDs in the latest sidebar state. */
    presentedActorIds: string[];
  }
}

/** An alliance ends after one second; ticks use a controlled clock. */
async function openBetrayal(page: Page) {
  await withoutApp(page);
  await page.goto("/");
  await page.evaluate(async () => {
    const { startSidebarSession } = await import("/e2e/sidebar-session.ts");
    const { level, withScenario } = await import("/e2e/missions.ts");
    const { defineScenario } = await import("/src/simulation/scenario.ts");
    const { createNotifications } = await import("/src/ui/notifications.ts");
    const { TerrainGrid } = await import("/src/simulation/terrain.ts");
    const { controlSessionClock } = await import("/e2e/harness.ts");
    const mission = level();
    const map = new TerrainGrid({
      width: 60,
      height: 20,
      tileSize: 1,
      terrainTypeIds: ["plain", "path", "rough", "water"],
    });
    const scenario = defineScenario({
      id: "betrayal",
      tileSize: 1,
      terrainTypeIds: [...map.terrainTypeIds],
      terrain: map.terrainState(),
      owners: [
        { id: "player", faction: "arc" },
        { id: "rival", faction: "arc" },
        { id: "wildlife" },
      ],
      playerOwner: "player",
      relationships: [
        {
          owners: ["player", "rival"],
          relationship: "allied",
          sharesSupport: true,
        },
        { owners: ["rival", "wildlife"], relationship: "hostile" },
      ],
      events: [
        {
          id: "betrayal",
          trigger: { kind: "time", seconds: 1 },
          actions: [
            {
              kind: "set-relationship",
              owners: ["player", "rival"],
              relationship: "hostile",
            },
          ],
        },
      ],
      buildings: [
        {
          actorId: "rival-cc",
          definitionId: "arc-command-center-prototype",
          origin: { x: 20, z: 8 },
          owner: "rival",
        },
        {
          actorId: "outpost",
          definitionId: "arc-field-barracks",
          origin: { x: 26, z: 8 },
          owner: "player",
        },
        {
          actorId: "far-cc",
          definitionId: "arc-command-center-prototype",
          origin: { x: 48, z: 8 },
          owner: "rival",
        },
        {
          actorId: "far-barracks",
          definitionId: "arc-field-barracks",
          origin: { x: 52, z: 8 },
          owner: "rival",
        },
        {
          actorId: "hidden-outpost",
          definitionId: "arc-field-barracks",
          origin: { x: 4, z: 2 },
          owner: "rival",
        },
      ],
      units: [
        {
          actorId: "watcher",
          definitionId: "arc-scout",
          tile: { x: 24, z: 14 },
          owner: "player",
        },
        {
          actorId: "visitor",
          definitionId: "arc-scout",
          tile: { x: 26, z: 14 },
          owner: "rival",
        },
        {
          actorId: "far-scout",
          definitionId: "arc-scout",
          tile: { x: 55, z: 15 },
          owner: "rival",
        },
        {
          actorId: "far-wolf",
          definitionId: "wolf",
          tile: { x: 56, z: 15 },
          owner: "wildlife",
        },
      ],
      stockpiles: ["player", "rival"].map((owner) => ({
        resource: "materials" as const,
        owners: [owner],
        amount: 100,
      })),
      sites: [],
      loot: [],
    });
    const notifications = createNotifications(
      document.querySelector<HTMLElement>("#mission-alerts")!,
    );
    const { view } = await startSidebarSession(
      withScenario(mission, scenario),
      {
        onStateChanged: (state) => {
          window.presentedActorIds = state.actors.map(({ id }) => id);
        },
        onAlerts: (alerts) => {
          for (const alert of alerts) notifications.alert(alert, "");
        },
      },
    );
    controlSessionClock(view);
  });
  await expectTerrainReady(page);
}

/** The visitor's selection marker: a ring, or segments when hostile. */
const marker = (page: Page) =>
  page.evaluate(() => {
    const { scene } = window.sessionHarness.view;
    if (scene.getMeshByName("actor-visitor-selection-0")?.isEnabled())
      return "segments";
    return scene.getMeshByName("actor-visitor-selection")?.isEnabled()
      ? "ring"
      : "none";
  });

/** Live support areas and radius outlines drawn for the player. */
const coverage = (page: Page) =>
  page.evaluate(() => {
    const named = (name: string) =>
      window.sessionHarness.view.scene.meshes.filter(
        (mesh) => mesh.name === name,
      ).length;
    return { areas: named("support-area"), radii: named("support-radius") };
  });

test(
  "same-faction owners keep matching model and minimap colors across betrayal",
  { tag: WEBKIT },
  async ({ page }) => {
    await openBetrayal(page);
    await expect(page.locator("#game-canvas")).toHaveAttribute(
      "data-models-ready",
      "true",
    );
    const colors = () =>
      page.evaluate(async () => {
        const { currentContentPack } = await import("/src/content/packs.ts");
        const { ownerColors } = await import("/src/content/content-pack.ts");
        const { minimapProjection } = await import("/src/render/minimap.ts");
        const { TerrainGrid } = await import("/src/simulation/terrain.ts");
        const { scene, simulation } = window.sessionHarness.view;
        const { width, height } = simulation.snapshot().terrain!;
        const map = new TerrainGrid({ width, height, tileSize: 1 });
        const palette = ownerColors(
          simulation.owners,
          currentContentPack("base").view,
        );
        const minimap = document.querySelector<HTMLCanvasElement>("#minimap")!;
        const projection = minimapProjection(
          map,
          minimap.clientWidth,
          minimap.clientHeight,
        );
        const ratio = minimap.width / minimap.clientWidth;
        return ["watcher", "visitor", "outpost", "rival-cc"].map((id) => {
          const actor = simulation.actorById(id)!;
          const prefix = actor.tilePlacement ? "tile-placed-actor" : "actor";
          const mesh = scene
            .getTransformNodeByName(`${prefix}-${id}-root`)!
            .getChildMeshes()
            .find((mesh) => mesh.material?.name.endsWith("-owner"))!;
          const model = (mesh.material as PBRMaterial).albedoColor
            .toGammaSpace()
            .asArray()
            .map((value) => Math.round(value * 255));
          const point = projection.toMinimap(actor.worldPosition);
          const pixel = Array.from(
            minimap
              .getContext("2d")!
              .getImageData(
                Math.round(point.x * ratio),
                Math.round(point.y * ratio),
                1,
                1,
              ).data,
          );
          return {
            id,
            model,
            pixel,
            expected: palette
              .get(actor.owner)!
              .map((value) => Math.round(value * 255)),
          };
        });
      });
    const before = await colors();
    for (const { model, pixel, expected } of before) {
      expect(model).toEqual(expected);
      expect(pixel).toEqual([...expected, 255]);
    }
    expect(before[0].model).not.toEqual(before[1].model);
    await advance(page, 2);
    for (const [index, current] of (await colors()).entries()) {
      expect(current.pixel).toEqual(before[index].pixel);
      if (current.id === "outpost") {
        // Losing allied support dims the outpost while preserving its hue.
        expect(current.model[2]).toBeLessThan(before[index].model[2]);
        expect(current.model[2]).toBeGreaterThan(current.model[0] * 3);
      } else expect(current.model).toEqual(before[index].model);
    }
  },
);

test(
  "a relationship event updates hostile markers, shared coverage, and owner alerts",
  { tag: WEBKIT },
  async ({ page }) => {
    await openBetrayal(page);
    const networkStatus = page.locator(
      "#panel-selection [data-network-status]",
    );
    await advance(page, 0.1);
    await selectInSession(page, "visitor");
    expect(await marker(page)).toBe("ring");
    await expect(page.locator("#selection-info")).toContainText("Allied");
    await selectInSession(page, "outpost");
    expect(await coverage(page)).toEqual({ areas: 4, radii: 4 });
    await expect(networkStatus).toContainText("Connected");

    await advance(page, 2);
    expect(await coverage(page)).toEqual({ areas: 0, radii: 1 });
    await expect(networkStatus).toContainText("Disconnected");
    await selectInSession(page, "visitor");
    expect(await marker(page)).toBe("segments");
    await expect(page.locator("#selection-info")).toContainText("Hostile");

    // Rival training and losses beyond the player's vision raise nothing.
    await page.evaluate(() => {
      window.sessionHarness.view.simulation.submitCommand(
        {
          kind: "train-unit",
          actorId: "far-recruit",
          producerId: "far-barracks",
          definitionId: "arc-trooper",
        },
        { owner: "rival" },
      );
    });
    await advance(page, 12);
    const hidden = await page.evaluate(() => {
      const { simulation } = window.sessionHarness.view;
      return {
        recruited: !!simulation.actorById("far-recruit"),
        scoutLost: !simulation.actorById("far-scout"),
        seen: ["far-recruit", "far-barracks", "far-wolf"].filter((id) => {
          const actor = simulation.actorById(id);
          return !!actor && simulation.detects("player", actor);
        }),
        presented: window.presentedActorIds.filter(
          (id) => id.startsWith("far-") || id === "hidden-outpost",
        ),
      };
    });

    expect(hidden).toEqual({
      recruited: true,
      scoutLost: true,
      seen: [],
      presented: [],
    });
    await expect(page.locator("#alert-history li")).toHaveText([
      "⚠ 1 building disconnected",
    ]);
  },
);
