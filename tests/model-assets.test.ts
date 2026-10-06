import { NullEngine, Scene } from "@babylonjs/core";
import { expect, test } from "vitest";
import { loadModelAsset } from "../src/render/glb-model";
import { loadSkinnedActorAppearance } from "../src/render/skinned-actor-appearance";
import { BASE_CONTENT } from "./helpers/content";
import { glbDataUrl } from "./helpers/assets";

test.each(["wolf", "alpha-wolf", "arc-harvester"])(
  "%s loads its generated clips and holds its death pose",
  async (id) => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    try {
      const model = BASE_CONTENT.presentation[id]!.model!;
      if (!("glb" in model)) throw new Error("Expected generated GLB");
      const appearance = await loadSkinnedActorAppearance(scene, {
        ...model.glb,
        url: glbDataUrl(model.glb.url),
      });
      const first = appearance.instantiate("first", 0);
      const second = appearance.instantiate("second", 0);
      if (id !== "arc-harvester") {
        const rig = (root: typeof first.root) =>
          root.getChildMeshes().find((mesh) => mesh.skeleton)!.skeleton;
        expect(rig(first.root)).not.toBe(rig(second.root));
        const legs = () =>
          scene.getTransformNodeByName("first-wolf-wolf-leg-0")!
            .rotationQuaternion!.x;
        first.animate!({ distance: 0.1, seconds: 0.1, turn: 0 });
        scene.animate();
        expect(Math.abs(legs())).toBeGreaterThan(0.01);
        first.play!("attack");
        first.animate!({ distance: 0, seconds: 0.1, turn: 0 });
        scene.animate();
        const head = scene.getTransformNodeByName(
          "first-wolf-wolf-head-joint",
        )!;
        expect(head.rotationQuaternion!.x).toBeLessThan(-0.1);
      } else {
        first.setWorking!(true);
        second.setWorking!(false);
        first.animate!({ distance: 0, seconds: 0.1, turn: 0 });
        scene.animate();
        const drill = scene.getTransformNodeByName("first-harvester-drill")!;
        expect(drill.position.y).toBeLessThan(0.4);
        expect(scene.getMeshByName("first-working-signal")!.isEnabled()).toBe(
          true,
        );
        expect(scene.getMeshByName("second-working-signal")!.isEnabled()).toBe(
          false,
        );
      }
      first.die!(0);
      scene.animate();
      const height = () => {
        if (id === "arc-harvester")
          return first.root.getHierarchyBoundingVectors(true).max.y;
        const head = scene.getTransformNodeByName(
          "first-wolf-wolf-head-joint",
        )!;
        head.computeWorldMatrix(true);
        return head.getAbsolutePosition().y;
      };
      const standing = height();
      first.die!(1);
      scene.animate();
      const fallen = height();
      expect(fallen).toBeLessThan(standing);
      expect(fallen).toBeGreaterThan(0);
      first.die!(60);
      scene.animate();
      expect(height()).toBeCloseTo(fallen);
      first.dispose();
      second.dispose();
      appearance.dispose();
    } finally {
      engine.dispose();
    }
  },
);

test.each(["command-center", "barracks", "refinery", "salvage"])(
  "%s loads its generated idle clip with independent instances",
  async (kind) => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    try {
      const asset = await loadModelAsset(scene, {
        url: glbDataUrl(`/assets/models/${kind}.glb`),
        idle: "idle",
      });
      const first = asset.instantiate("first");
      const second = asset.instantiate("second");
      const groups = scene.animationGroups.filter(
        ({ name }) => name === "first-idle",
      );
      expect(groups).toHaveLength(1);
      first.pose(1);
      second.pose(0);
      scene.animate();
      expect(groups[0]!.getCurrentFrame()).toBe(
        groups[0]!.targetedAnimations[0]!.animation.framePerSecond,
      );
      first.dispose();
      expect(second.root.isDisposed()).toBe(false);
      second.dispose();
      asset.dispose();
      expect(scene.meshes).toHaveLength(0);
      expect(scene.materials).toHaveLength(0);
    } finally {
      engine.dispose();
    }
  },
);
