import { NullEngine, Scene } from "@babylonjs/core";
import { describe, expect, test } from "vitest";

import { INFANTRY_ROLES } from "../scripts/infantry-model";
import { BASE_CONTENT } from "./helpers/content";
import { glbDataUrl } from "./helpers/assets";
import { loadSkinnedActorAppearance } from "../src/render/skinned-actor-appearance";

import type { AbstractMesh, TransformNode } from "@babylonjs/core";
import type {
  ActorGraphics,
  SkinnedActorOptions,
} from "../src/render/skinned-actor-appearance";

/** Loads through the real glTF loader, from the committed file. */
async function load(graphics: ActorGraphics, options?: SkinnedActorOptions) {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  try {
    const appearance = await loadSkinnedActorAppearance(
      scene,
      { ...graphics, url: glbDataUrl(graphics.url) },
      options,
    );
    return { engine, scene, appearance };
  } catch (error) {
    engine.dispose();
    throw error;
  }
}

/** A joint's height above the actor's ground point. */
function jointHeight(scene: Scene, name: string): number {
  const node = scene.getTransformNodeByName(name)!;
  node.computeWorldMatrix(true);
  return node.getAbsolutePosition().y;
}

function skinnedMesh(root: TransformNode): AbstractMesh {
  return root.getChildMeshes().find((mesh) => mesh.skeleton)!;
}

const glbModels = Object.entries(BASE_CONTENT.presentation).flatMap(
  ([id, { model }]) =>
    INFANTRY_ROLES.some((role) => id === `arc-${role}`) &&
    model &&
    "glb" in model
      ? [[id, model.glb] as const]
      : [],
);

describe.each(glbModels)("%s model", (_id, graphics) => {
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
        graphics.clips.attack,
        graphics.clips.death,
        graphics.clips.hit,
        graphics.clips.aim,
      ]
        .filter((name) => name !== undefined)
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

  test.runIf(graphics.clips.attack)(
    "layers one recoil per shot over the idle pose",
    async () => {
      const { engine, scene, appearance } = await load(graphics);
      const instance = appearance.instantiate("shooter", 0);
      const spine = () =>
        scene.getTransformNodeByName("shooter-spine")!.rotationQuaternion!.x;
      const step = (frames: number) => {
        let kick = 0;
        for (let frame = 0; frame < frames; frame++) {
          instance.animate!({ distance: 0, turn: 0, seconds: 1 / 60 });
          scene.animate();
          kick = Math.min(kick, spine());
        }
        return kick;
      };
      step(2);
      expect(spine()).toBeCloseTo(0);

      instance.play!("attack");
      expect(step(6)).toBeLessThan(-0.02);
      step(30);
      expect(spine()).toBeCloseTo(0);
      engine.dispose();
    },
  );

  test.runIf(graphics.clips.death)(
    "falls once and holds the last pose",
    async () => {
      const { engine, scene, appearance } = await load(graphics);
      const instance = appearance.instantiate("fallen", 0);
      const head = () => jointHeight(scene, "fallen-head");
      instance.die!(0);
      scene.animate();
      const standing = head();
      instance.die!(0.4);
      scene.animate();
      const falling = head();
      instance.die!(5);
      scene.animate();
      const fallen = head();
      instance.die!(60);
      scene.animate();

      expect(falling).toBeLessThan(standing);
      expect(fallen).toBeLessThan(falling);
      expect(fallen).toBeLessThan(0.5);
      expect(fallen).toBeGreaterThan(0);
      expect(jointHeight(scene, "fallen-left-shin")).toBeGreaterThan(0);
      expect(head()).toBeCloseTo(fallen);
      engine.dispose();
    },
  );

  test("reduced motion skips recoil and shows remains already fallen", async () => {
    let reduced = true;
    const { engine, scene, appearance } = await load(graphics, {
      reducedMotion: () => reduced,
    });
    const instance = appearance.instantiate("still", 0);
    instance.play?.("attack");
    instance.animate!({ distance: 0, turn: 0, seconds: 1 / 30 });
    scene.animate();
    expect(
      scene.getTransformNodeByName("still-spine")!.rotationQuaternion!.x,
    ).toBeCloseTo(0);
    if (instance.die) {
      const remains = appearance.instantiate("remains", 0);
      remains.die!(0);
      scene.animate();
      const still = jointHeight(scene, "remains-head");
      reduced = false;
      remains.die!(0.1);
      scene.animate();
      expect(still).toBeCloseTo(jointHeight(scene, "remains-head"));
    }
    engine.dispose();
  });

  test.runIf(graphics.clips.attack)(
    "restarts recoil and cancels it when reduced motion changes",
    async () => {
      let reduced = false;
      const { engine, scene, appearance } = await load(graphics, {
        reducedMotion: () => reduced,
      });
      const instance = appearance.instantiate("shooter", 0);
      const spine = () =>
        scene.getTransformNodeByName("shooter-spine")!.rotationQuaternion!.x;
      const step = (seconds: number) => {
        instance.animate!({ distance: 0, turn: 0, seconds });
        scene.animate();
      };
      step(0);
      instance.play!("attack");
      step(0.05);
      const first = spine();
      expect(first).toBeLessThan(-0.02);
      instance.play!("attack");
      step(0.05);
      expect(spine()).toBeCloseTo(first);
      reduced = true;
      step(0.01);
      expect(spine()).toBeCloseTo(0);
      reduced = false;
      step(0.01);
      expect(spine()).toBeCloseTo(0);
      instance.play!("attack");
      step(1);
      expect(spine()).toBeCloseTo(0);
      engine.dispose();
    },
  );

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
