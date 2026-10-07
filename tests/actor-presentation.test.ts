import { MeshBuilder, NullEngine, Scene, Vector3 } from "@babylonjs/core";
import { expect, test } from "vitest";
import { BASE_CONTENT } from "./helpers/content";
import { glbDataUrl } from "./helpers/assets";
import { loadSkinnedActorAppearance } from "../src/render/skinned-actor-appearance";
import { clipSeconds, loadModelAsset } from "../src/render/glb-model";
import { createRegenerationEffectsView } from "../src/render/regeneration-effects";
import { stableUnit } from "../src/render/actor";
import type { ModelAsset } from "../src/render/glb-model";

async function load(id: string, reducedMotion = () => false) {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const model = BASE_CONTENT.presentation[id]!.model!;
  if (!("glb" in model)) throw new Error("Expected GLB");
  const appearance = await loadSkinnedActorAppearance(
    scene,
    {
      ...model.glb,
      url: glbDataUrl(model.glb.url),
    },
    { reducedMotion },
  );
  const first = appearance.instantiate("first", 0);
  const second = appearance.instantiate("second", 0);
  const step = (seconds: number, distance = 0, turn = 0) => {
    first.animate!({ seconds, distance, turn });
    second.animate!({ seconds, distance: 0, turn: 0 });
    scene.animate();
  };
  const node = (suffix: string, name = "first") =>
    (scene.getTransformNodeByName(`${name}-${suffix}`) ??
      scene.getMeshByName(`${name}-${suffix}`))!;
  return { engine, scene, first, second, step, node };
}

test.each(["arc-trooper", "arc-scout", "wolf", "alpha-wolf", "arc-harvester"])(
  "%s flinches independently, restarts on another hit, and gives death priority",
  async (id) => {
    const { engine, first, step, node } = await load(id);
    try {
      const suffix =
        id.startsWith("arc-") && id !== "arc-harvester"
          ? "spine"
          : id === "arc-harvester"
            ? "harvester"
            : "wolf";
      const component = suffix === "spine" ? "x" : "z";
      const angle = (name = "first") =>
        node(suffix, name).rotationQuaternion![component];
      step(0);
      const rest = angle();
      first.play!("hit");
      step(0.1);
      const flinch = angle();
      expect(Math.abs(flinch - rest)).toBeGreaterThan(0.01);
      expect(angle("second")).toBeCloseTo(rest);
      first.play!("hit");
      step(0.1);
      expect(angle()).toBeCloseTo(flinch);
      step(1);
      expect(angle()).toBeCloseTo(rest);
      first.play!("hit");
      first.die!(1);
      step(0);
      const fallen = angle();
      first.play!("hit");
      first.setAnimationState?.({ working: true });
      step(0.1);
      expect(angle()).toBeCloseTo(fallen);
    } finally {
      engine.dispose();
    }
  },
);

test("collector transitions reverse without jumping and restore a loaded work pose", async () => {
  let reduced = false;
  const { engine, first, second, step, node } = await load(
    "arc-harvester",
    () => reduced,
  );
  try {
    const height = () => node("harvester-drill").position.y;
    first.setAnimationState!({ working: false });
    second.setAnimationState!({ working: true });
    step(0);
    expect(height()).toBeCloseTo(0.65);
    expect(node("harvester-drill", "second").position.y).toBeCloseTo(0.3);
    first.setAnimationState!({ working: true });
    step(0.2);
    const deploying = height();
    expect(deploying).toBeLessThan(0.65);
    expect(deploying).toBeGreaterThan(0.3);
    first.setAnimationState!({ working: false });
    step(0);
    expect(height()).toBeCloseTo(deploying);
    step(0.1);
    expect(height()).toBeGreaterThan(deploying);
    first.setAnimationState!({ working: true });
    step(0.7);
    expect(height()).toBeCloseTo(0.3);
    first.setAnimationState!({ working: true });
    reduced = true;
    step(0.1);
    expect(height()).toBeCloseTo(0.3);
    first.setAnimationState!({ working: false });
    step(0.1);
    expect(height()).toBeCloseTo(0.65);
    expect(node("working-signal").isEnabled()).toBe(false);
    expect(node("idle-signal").isEnabled()).toBe(true);
  } finally {
    engine.dispose();
  }
});

test("unloading tips the hopper once, independently, and reduced motion cancels it", async () => {
  let reduced = false;
  const { engine, first, step, node } = await load(
    "arc-harvester",
    () => reduced,
  );
  try {
    first.setAnimationState!({ working: false });
    first.play!("unload");
    step(0.2);
    expect(node("harvester-hopper").rotationQuaternion!.x).toBeLessThan(-0.1);
    expect(
      node("harvester-hopper", "second").rotationQuaternion!.x,
    ).toBeCloseTo(0);
    reduced = true;
    step(0.1);
    expect(node("harvester-hopper").rotationQuaternion!.x).toBeCloseTo(0);
    reduced = false;
    step(0.1);
    expect(node("harvester-hopper").rotationQuaternion!.x).toBeCloseTo(0);
    first.play!("unload");
    step(1);
    expect(node("harvester-hopper").rotationQuaternion!.x).toBeCloseTo(0);
  } finally {
    engine.dispose();
  }
});

test("Trooper aim holds between shots and clears when its target is lost", async () => {
  const { engine, first, step, node } = await load("arc-trooper");
  try {
    first.setAnimationState!({ aiming: true });
    step(0.1);
    const held = node("left-forearm").rotationQuaternion!.x;
    expect(held).toBeLessThan(-0.1);
    first.play!("attack");
    step(0.1);
    expect(node("left-forearm").rotationQuaternion!.x).toBeCloseTo(held);
    first.setAnimationState!({ aiming: false });
    step(0.5);
    expect(node("left-forearm").rotationQuaternion!.x).toBeCloseTo(0);
  } finally {
    engine.dispose();
  }
});

test.each(["wolf", "alpha-wolf"])(
  "%s runs in a bound and leans through turns",
  async (id) => {
    const { engine, first, step, node } = await load(id);
    try {
      first.setAnimationState!({ running: true });
      step(0.1, 0.2, 0.1);
      expect(node("wolf").position.y).toBeGreaterThan(0.01);
      const lean = node("wolf").rotationQuaternion!.z;
      expect(Math.abs(lean)).toBeGreaterThan(0.005);
      expect(node("wolf-wolf-leg-0").rotationQuaternion!.x).toBeCloseTo(
        node("wolf-wolf-leg-1").rotationQuaternion!.x,
      );
      first.setAnimationState!({ running: false });
      step(0.1, 0.2, -0.2);
      expect(node("wolf").position.y).toBeCloseTo(0);
      expect(Math.sign(node("wolf").rotationQuaternion!.z)).toBe(
        -Math.sign(lean),
      );
    } finally {
      engine.dispose();
    }
  },
);

test("generated one-shots preserve durations between sampling frames", async () => {
  const { engine, scene } = await load("wolf");
  try {
    for (const [clip, seconds] of [
      ["hit", 0.35],
      ["bite", 0.4],
    ] as const) {
      const group = scene.animationGroups.find(
        ({ name }) => name === `first-${clip}`,
      )!;
      expect(clipSeconds(group)).toBeCloseTo(seconds);
    }
  } finally {
    engine.dispose();
  }
});

test("regeneration uses the asset's loop and preserves time across replacement", () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const poses: number[] = [];
  const makeAsset = (): ModelAsset => ({
    loopSeconds: 4,
    instantiate: (name) => {
      const root = MeshBuilder.CreateBox(name, {}, scene);
      return {
        root,
        pose: (seconds) => poses.push(seconds),
        dispose: () => root.dispose(),
      };
    },
    dispose: () => {},
  });
  let asset = makeAsset();
  let reduced = false;
  const effects = createRegenerationEffectsView(
    scene,
    () => asset,
    () => reduced,
  );
  const actor = { id: "wolf", position: Vector3.Zero(), radius: 0.5 };
  const phase = stableUnit(actor.id) * asset.loopSeconds!;
  try {
    effects.update([actor], 0.2);
    const original = scene.getMeshByName("regeneration-wolf-model")!;
    expect(original.isPickable).toBe(false);
    expect(poses[poses.length - 1]).toBeCloseTo(phase + 0.2);
    reduced = true;
    asset = makeAsset();
    effects.update([actor], 0.1);
    expect(original.isDisposed()).toBe(true);
    expect(poses[poses.length - 1]).toBeCloseTo(phase + 0.2);
    reduced = false;
    effects.update([actor], 0.1);
    expect(poses[poses.length - 1]).toBeCloseTo(phase + 0.3);
    effects.update([], 0);
    effects.update([actor], 0);
    expect(poses[poses.length - 1]).toBeCloseTo(phase);
  } finally {
    effects.dispose();
    engine.dispose();
  }
});

test("regeneration survives asset loading, freezes, and cleans up on concealment or healing end", async () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  try {
    const graphics = BASE_CONTENT.props!.regeneration!;
    const asset = await loadModelAsset(scene, {
      ...graphics,
      url: glbDataUrl(graphics.url),
    });
    let loaded: typeof asset | undefined;
    let reduced = false;
    const effects = createRegenerationEffectsView(
      scene,
      () => loaded,
      () => reduced,
    );
    const actor = { id: "wolf", position: new Vector3(1, 2, 3), radius: 0.625 };
    effects.update([actor], 0);
    loaded = asset;
    effects.update([actor], 0);
    const root = scene.getTransformNodeByName("regeneration-wolf")!;
    const mark = scene.getTransformNodeByName(
      "regeneration-wolf-model-healing-mark-0",
    )!;
    scene.animate();
    expect(root.position).toEqual(actor.position);
    expect(root.scaling.x).toBe(1.25);
    expect(root.getChildMeshes().every((mesh) => !mesh.isPickable)).toBe(true);
    const height = mark.position.y;
    effects.update([actor], 0.1);
    scene.animate();
    expect(mark.position.y).not.toBe(height);
    reduced = true;
    const held = mark.position.y;
    effects.update([actor], 0.1);
    scene.animate();
    expect(mark.position.y).toBeCloseTo(held);
    effects.update([], 0);
    expect(root.isDisposed()).toBe(true);
    expect(scene.getTransformNodeByName("regeneration-wolf")).toBeNull();
    effects.update([actor], 0);
    effects.dispose();
    expect(scene.getTransformNodeByName("regeneration-wolf")).toBeNull();
    asset.dispose();
  } finally {
    engine.dispose();
  }
});
