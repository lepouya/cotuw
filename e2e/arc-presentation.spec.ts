import { expect, test } from "./fixtures";
import { writeFile } from "node:fs/promises";
import {
  forEachProfile,
  MOUSE_PROFILE,
  PHONE_PROFILE,
  DESKTOP_WINDOW_PROFILE,
} from "./profiles";
import { advance, collectPageErrors, withoutApp } from "./page-helpers";
import { WEBKIT } from "./tags";
import type { AudioDevice } from "../src/audio/mixer";

declare global {
  interface Window {
    arcAudio: { calls: string[]; device: AudioDevice };
  }
}

forEachProfile([MOUSE_PROFILE, DESKTOP_WINDOW_PROFILE, PHONE_PROFILE], () => {
  test(`added ARC actors render and sound together during service and combat ${WEBKIT}`, async ({
    page,
  }, info) => {
    const errors = collectPageErrors(page, { console: true });
    await withoutApp(page);
    await page.goto("/");
    await page.evaluate(async () => {
      const { startSidebarSession } = await import("/e2e/sidebar-session.ts");
      const { level, withScenario } = await import("/e2e/missions.ts");
      const { defineScenario } = await import("/src/simulation/scenario.ts");
      const { TerrainGrid } = await import("/src/simulation/terrain.ts");
      const { controlSessionClock } = await import("/e2e/harness.ts");
      const { createAudioMixer } = await import("/src/audio/mixer.ts");
      const map = new TerrainGrid({
        width: 36,
        height: 26,
        tileSize: 1,
        terrainTypeIds: ["plain", "path", "rough", "water"],
      });
      const mission = withScenario(
        level(),
        defineScenario({
          id: "arc-presentation",
          content: level().scenario.content,
          tileSize: 1,
          terrainTypeIds: [...map.terrainTypeIds],
          terrain: map.terrainState(),
          owners: [
            { id: "player", faction: "arc" },
            { id: "enemy", faction: "arc" },
          ],
          playerOwner: "player",
          relationships: [
            { owners: ["player", "enemy"], relationship: "hostile" },
          ],
          stockpiles: [
            { owners: ["player"], resource: "materials", amount: 500 },
            { owners: ["enemy"], resource: "materials", amount: 0 },
          ],
          sites: [],
          loot: [],
          buildings: [
            {
              actorId: "cc",
              definitionId: "arc-command-center-prototype",
              origin: { x: 7, z: 7 },
            },
            {
              actorId: "relay",
              definitionId: "arc-relay-station",
              origin: { x: 15, z: 7 },
            },
            {
              actorId: "sentry",
              definitionId: "arc-sentry-turret",
              origin: { x: 19, z: 10 },
            },
            {
              actorId: "target",
              definitionId: "arc-field-barracks",
              owner: "enemy",
              origin: { x: 26, z: 10 },
            },
          ],
          units: [
            {
              actorId: "demolition",
              definitionId: "arc-demolition-trooper",
              tile: { x: 21, z: 10 },
            },
            {
              actorId: "patient",
              definitionId: "arc-trooper",
              tile: { x: 13, z: 14 },
            },
            {
              actorId: "medic",
              definitionId: "arc-medic",
              tile: { x: 12, z: 14 },
            },
            {
              actorId: "harvester",
              definitionId: "arc-harvester",
              tile: { x: 10, z: 15 },
            },
            {
              actorId: "mechanic",
              definitionId: "arc-mechanic",
              tile: { x: 9, z: 15 },
            },
          ],
        }),
      );
      mission.state.actors.find(({ id }) => id === "patient")!.health = 20;
      mission.state.actors.find(({ id }) => id === "harvester")!.health = 30;
      const device = createAudioMixer();
      window.arcAudio = { device, calls: [] };
      document.addEventListener(
        "pointerdown",
        () => {
          void device.unlock();
        },
        { once: true },
      );
      const { view } = await startSidebarSession(mission, {
        startPaused: true,
        audio: {
          ...device,
          play: (url, options) => {
            const voice = device.play(url, options);
            if (voice) window.arcAudio.calls.push(url);
            return voice;
          },
        },
      });
      view.camera.focusOnTile(18, 12);
      controlSessionClock(view);
    });
    await page.locator("#game-canvas").click({ position: { x: 100, y: 100 } });
    await expect(page.locator("#game-canvas")).toHaveAttribute(
      "data-models-ready",
      "true",
    );
    await expect
      .poll(() =>
        page.evaluate(() =>
          [
            "medical-service",
            "mechanical-service",
            "launcher-launch",
            "launcher-impact",
          ].every((id) =>
            window.arcAudio.device.isLoaded(`assets/audio/${id}.wav`),
          ),
        ),
      )
      .toBe(true);
    await page.evaluate(() => {
      const { view } = window.sessionHarness;
      view.resume();
      for (const actorId of ["demolition", "sentry"])
        view.simulation.submitCommand(
          { kind: "attack", actorId, targetId: "target" },
          { owner: "player" },
        );
    });
    await advance(page, 0.04);
    const shown = await page.evaluate(() => {
      const { scene, simulation } = window.sessionHarness.view;
      const node = (name: string) => scene.getTransformNodeByName(name);
      return {
        relay: !!node("tile-placed-actor-relay-root-model-relay-scanner"),
        sentry: !!node("tile-placed-actor-sentry-root-model-sentry-turret"),
        medic: !!node("service-effect-medic"),
        mechanic: !!node("service-effect-mechanic"),
        streak: !!node("rocket"),
        impact: !!node("rocket-impact"),
        health: simulation.actorById("target")!.health,
        audio: window.arcAudio.calls,
      };
    });
    expect(shown).toMatchObject({
      relay: true,
      sentry: true,
      medic: true,
      mechanic: true,
      streak: true,
      impact: true,
    });
    expect(shown.health).toBeLessThan(800);
    for (const cue of [
      "medical-service",
      "mechanical-service",
      "launcher-launch",
      "launcher-impact",
    ])
      expect(shown.audio).toContain(`assets/audio/${cue}.wav`);
    await page.screenshot({ path: info.outputPath("arc-presentation.png") });
    await writeFile(
      info.outputPath("arc-presentation.json"),
      await page.evaluate(() =>
        window.sessionHarness.view.save({
          name: "ARC presentation",
          savedAt: "2026-11-16T00:00:00Z",
        }),
      ),
    );
    await advance(page, 0.5);
    expect(
      await page.evaluate(
        () =>
          !!window.sessionHarness.view.scene.getTransformNodeByName("rocket"),
      ),
    ).toBe(false);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await advance(page, 2.5);
    await page.screenshot({ path: info.outputPath("arc-reduced-motion.png") });
    expect(errors).toEqual([]);
    await page.evaluate(async () => {
      await window.sessionHarness.view.disposeAsync();
      window.arcAudio.device.dispose();
    });
  });
});
