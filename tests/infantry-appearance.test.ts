import { readFileSync } from "node:fs";

import { NullEngine, Scene } from "@babylonjs/core";
import { describe, expect, test } from "vitest";

import { exportInfantry, INFANTRY_ROLES } from "../scripts/infantry-model";
import { PROTOTYPE_ACTOR_GRAPHICS } from "../src/prototype";
import { loadSkinnedActorAppearance } from "../src/render/skinned-actor-appearance";

import type { AbstractMesh, TransformNode } from "@babylonjs/core";
import type { ActorGraphics } from "../src/render/skinned-actor-appearance";

test.each(INFANTRY_ROLES)("the committed %s GLB is current", async (role) => {
  const committed = readFileSync(`public/assets/actors/arc-${role}.glb`);
  const generated = Buffer.from(await exportInfantry(role));

  expect(
    generated.equals(committed),
    "Regenerate with `npm run assets:infantry`.",
  ).toBe(true);
});

/** Loads through the real glTF loader, from the committed file. */
async function load(graphics: ActorGraphics) {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const data = readFileSync(`public${graphics.url}`).toString("base64");
  const appearance = await loadSkinnedActorAppearance(scene, {
    ...graphics,
    url: `data:model/gltf-binary;base64,${data}`,
  });
  return { engine, scene, appearance };
}

function skinnedMesh(root: TransformNode): AbstractMesh {
  return root.getChildMeshes().find((mesh) => mesh.skeleton)!;
}

describe.each([...PROTOTYPE_ACTOR_GRAPHICS])("%s model", (_id, graphics) => {
  test("gives each instance its own rig and clips", async () => {
    const { engine, scene, appearance } = await load(graphics);
    const first = appearance.instantiate("first", 0);
    const second = appearance.instantiate("second", 0.5);
    const skeleton = skinnedMesh(first.root).skeleton!;

    expect(skeleton).not.toBe(skinnedMesh(second.root).skeleton);
    for (const bone of skeleton.bones) {
      expect(bone.getTransformNode()!.isDescendantOf(first.root)).toBe(true);
    }
    const groups = scene.animationGroups.filter(({ name }) =>
      name.startsWith("first-"),
    );
    expect(groups.map(({ name }) => name).sort()).toEqual(
      [
        graphics.clips.idle,
        graphics.clips.locomotion,
        graphics.clips.turn!.left,
        graphics.clips.turn!.right,
      ]
        .map((name) => `first-${name}`)
        .sort(),
    );
    for (const { targetedAnimations } of groups) {
      for (const { target } of targetedAnimations) {
        expect((target as TransformNode).isDescendantOf(first.root)).toBe(true);
      }
    }

    first.dispose();
    expect(
      scene.animationGroups.some(({ name }) => name.startsWith("first-")),
    ).toBe(false);
    expect(skinnedMesh(second.root).isDisposed()).toBe(false);
    engine.dispose();
  });

  test("faces +Z and blends walking with a lean either way", async () => {
    const { engine, scene, appearance } = await load(graphics);
    const lean = (turn: number) => {
      const instance = appearance.instantiate(`lean${turn}`, 0);
      const node = (joint: string) =>
        scene.getTransformNodeByName(`lean${turn}-${joint}`)!;
      let stride = 0;
      for (let frame = 0; frame < 10; frame++) {
        instance.animate!({ distance: 0.07, turn, seconds: 1 / 60 });
        scene.animate();
        stride = Math.max(
          stride,
          Math.abs(node("left-leg").rotationQuaternion!.x),
        );
      }
      return {
        instance,
        stride,
        spine: node("spine").rotationQuaternion!.y,
      };
    };

    const right = lean(0.05);
    const left = lean(-0.05);
    const { max, min } = right.instance.root.getHierarchyBoundingVectors(true);

    // The rifle reaches forward.
    expect(max.z).toBeGreaterThan(-min.z);
    expect(right.stride).toBeGreaterThan(0.1);
    expect(Math.abs(right.spine)).toBeGreaterThan(0.01);
    expect(Math.sign(left.spine)).toBe(-Math.sign(right.spine));
    engine.dispose();
  });

  test("rejects a model without a named clip", async () => {
    await expect(
      load({ ...graphics, clips: { ...graphics.clips, locomotion: "run" } }),
    ).rejects.toThrow("is missing clip run");
  });

  test("rejects non-finite bounds", async () => {
    await expect(
      load({
        ...graphics,
        bounds: { ...graphics.bounds, radius: Number.POSITIVE_INFINITY },
      }),
    ).rejects.toThrow("needs positive finite bounds");
  });

  test("rejects a clip assigned to more than one role", async () => {
    await expect(
      load({
        ...graphics,
        clips: { ...graphics.clips, locomotion: graphics.clips.idle },
      }),
    ).rejects.toThrow("uses one clip for multiple animation roles");
  });
});
