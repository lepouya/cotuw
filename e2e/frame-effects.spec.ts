import { expect, test } from "@playwright/test";
import { WEBKIT } from "./tags";

test(
  "frame effects follow their actor, play once, hold still, and release frames",
  { tag: WEBKIT },
  async ({ page }) => {
    await page.goto("/?level=sandbox");
    const result = await page.evaluate(async () => {
      const path: string = "/e2e/harness.ts";
      const {
        createTestView,
        createFrameEffectsView,
        currentContentPack,
        TransformNode,
      } = (await import(path)) as typeof import("./harness");
      const content = currentContentPack("base");
      const flash = content.presentation["arc-trooper"]!.frameEffects!.attack!;
      const { scene } = createTestView({
        map: { width: 4, height: 4, tileSize: 1 },
      });
      let still = false;
      const effects = createFrameEffectsView(
        scene,
        content.clips!,
        () => still,
      );
      const actor = new TransformNode("actor", scene);
      actor.position.set(1, 0, 1);
      actor.rotation.y = Math.PI / 2;
      const initialTextures = scene.textures.length;
      const shown = () =>
        scene.meshes.filter(({ name }) => name === "frame-effect");
      const frame = () => shown()[0]?.material?.name;
      effects.prepare({ attack: flash });
      // Image decoding is asynchronous in both browser engines.
      const deadline = performance.now() + 5000;
      while (
        !scene.textures.some((texture) => texture.name === `${flash.url}#0`)
      ) {
        if (performance.now() > deadline)
          throw new Error("Muzzle flash did not load.");
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve()),
        );
      }
      effects.play(flash, actor);
      const firstVisible = shown()[0]?.isVisible;
      const mesh = shown()[0]!;
      for (const node of [actor, mesh.parent!, mesh])
        node.computeWorldMatrix(true);
      const { x, y, z } = mesh.getAbsolutePosition();
      actor.scaling.setAll(2);
      effects.update(0);
      mesh.computeWorldMatrix(true);
      const scaledSize = [mesh.absoluteScaling.x, mesh.absoluteScaling.y];
      // Five 0.03-second steps pass the clip's 0.13 seconds.
      const played = [frame()];
      for (let step = 0; step < 5; step++) {
        effects.update(0.03);
        played.push(frame());
      }
      const ended = shown().length;

      still = true;
      effects.play(flash, actor);
      const held = new Set<string | undefined>();
      for (let step = 0; step < 4; step++) {
        effects.update(0.03);
        held.add(frame());
      }
      still = false;
      effects.play(flash, actor);
      actor.dispose();
      effects.update(0.01);
      const orphaned = shown().length;

      effects.dispose();
      effects.dispose();
      const released = scene.textures.length === initialTextures;
      effects.play(flash, new TransformNode("late-actor", scene));
      const afterDisposal = shown().length;
      scene.dispose();
      return {
        firstVisible,
        scaledSize,
        afterDisposal,
        anchor: [x, y, z].map((value) => Math.round(value * 100) / 100),
        distinct: new Set(played.filter(Boolean)).size,
        ended,
        held: held.size,
        orphaned,
        released,
      };
    });

    // The anchor turns with the actor: model +Z faces world +X here.
    expect(result.anchor).toEqual([2.15, 1.15, 0.88]);
    for (const size of result.scaledSize) expect(size).toBeCloseTo(1, 6);
    expect(result.firstVisible).toBe(true);
    expect(result.afterDisposal).toBe(0);
    expect(result.distinct).toBeGreaterThan(2);
    expect(result.ended).toBe(0);
    expect(result.held).toBe(1);
    expect(result.orphaned).toBe(0);
    expect(result.released).toBe(true);
  },
);
