import { MeshBuilder, Vector3 } from "@babylonjs/core";
import { expect, test, vi } from "vitest";

import { testScene } from "./helpers/scene";
import { TerrainMap } from "../src/map";
import {
  COMBAT_EFFECT_LIMIT,
  createCombatEffectsView,
} from "../src/render/combat-effects";

import type { AttackEvent } from "../src/simulation/combat";

const hit: AttackEvent = {
  attackerId: "caster",
  attackerDefinitionId: "circle-sentinel",
  targetId: "wolf",
  from: { x: -2, z: 0 },
  to: { x: 2, z: 0 },
  damage: 10,
  damageType: "arcane",
};

function fixture() {
  const scene = testScene();
  const map = new TerrainMap({ width: 10, height: 10, tileSize: 1 });
  const instances: {
    root: ReturnType<typeof MeshBuilder.CreateBox>;
    dispose: ReturnType<typeof vi.fn>;
    pose: ReturnType<typeof vi.fn>;
  }[] = [];
  const asset = {
    loopSeconds: 0.3,
    dispose: vi.fn(),
    instantiate: vi.fn(() => {
      const root = MeshBuilder.CreateBox("effect", {}, scene);
      const instance = {
        root,
        dispose: vi.fn(() => root.dispose()),
        pose: vi.fn(),
      };
      instances.push(instance);
      return instance;
    }),
  };
  let reduced = false;
  const effects = createCombatEffectsView(
    scene,
    map,
    () => asset,
    () => reduced,
  );
  return {
    scene,
    asset,
    instances,
    effects,
    reduce: () => {
      reduced = true;
    },
  };
}

test("rocket trails use the muzzle anchor and keep impact size independent of range", () => {
  const { effects, instances, reduce } = fixture();
  const from = new Vector3(-1, 2, 0);
  const to = new Vector3(3, 1, 0);
  effects.hit(hit, "rocket", { from, to });
  expect(instances).toHaveLength(2);
  const [impact, trail] = instances;
  expect(impact.root.position.asArray()).toEqual(to.asArray());
  expect(impact.root.scaling.asArray()).toEqual([1, 1, 1]);
  expect(trail.root.position.asArray()).toEqual(from.asArray());
  expect(trail.root.scaling.z).toBeCloseTo(Vector3.Distance(from, to));
  effects.update(0.1);
  expect(impact.pose).toHaveBeenLastCalledWith(0.1);
  reduce();
  effects.update(0.05);
  expect(impact.pose).toHaveBeenLastCalledWith(0);
  effects.update(1);
  expect(instances.every(({ root }) => root.isDisposed())).toBe(true);
});

test("observed rocket impacts do not reveal hidden shooters or unseen targets", () => {
  const { effects, instances } = fixture();
  effects.hit(hit, "rocket", { showFrom: false, showTo: true });
  expect(instances).toHaveLength(1);
  effects.hit(hit, "rocket", { showFrom: true, showTo: false });
  effects.hit(hit, "rocket", { showFrom: false, showTo: false });
  expect(instances).toHaveLength(1);
  for (let index = 0; index < COMBAT_EFFECT_LIMIT; index++)
    effects.hit(hit, "rocket");
  expect(instances.filter(({ root }) => !root.isDisposed())).toHaveLength(
    COMBAT_EFFECT_LIMIT,
  );
  effects.dispose();
  expect(
    instances.every(({ dispose }) => dispose.mock.calls.length === 1),
  ).toBe(true);
});

test.each(["tracer", "bolt", "bite"] as const)(
  "%s effects respect hidden endpoints with models and fallback geometry",
  (style) => {
    const { effects, instances, scene } = fixture();
    const fallback = createCombatEffectsView(
      scene,
      new TerrainMap({ width: 10, height: 10, tileSize: 1 }),
    );
    for (const view of [effects, fallback]) {
      view.hit(hit, style, { showFrom: true, showTo: false });
      view.hit(hit, style, { showFrom: false, showTo: false });
      expect(scene.meshes).toHaveLength(0);
      view.hit(hit, style, { showFrom: false, showTo: true });
      expect(scene.meshes).toHaveLength(style === "bite" ? 1 : 0);
      view.dispose();
    }
    expect(instances).toHaveLength(style === "bite" ? 1 : 0);
  },
);

test("catch-up bursts evict old instances and keep rendering work bounded", () => {
  const { scene, asset, instances, effects } = fixture();
  for (let index = 0; index < COMBAT_EFFECT_LIMIT * 2; index++)
    effects.hit(hit, "bolt");
  expect(scene.meshes).toHaveLength(COMBAT_EFFECT_LIMIT);
  expect(
    instances
      .slice(0, COMBAT_EFFECT_LIMIT)
      .every(({ root }) => root.isDisposed()),
  ).toBe(true);
  expect(instances[instances.length - 1]!.root.isDisposed()).toBe(false);
  effects.update(1);
  expect(scene.meshes).toHaveLength(0);
  expect(
    instances.every(({ dispose }) => dispose.mock.calls.length === 1),
  ).toBe(true);
  expect(asset.dispose).not.toHaveBeenCalled();
});

test("mesh-root assets fade, animate from their clips, and hold under reduced motion", () => {
  const { effects, instances, reduce } = fixture();
  effects.hit(hit, "tracer");
  effects.update(0.1);
  const instance = instances[0]!;
  expect(instance.root.isPickable).toBe(false);
  expect(instance.root.visibility).toBeCloseTo(1 / 3);
  expect(instance.pose).toHaveBeenLastCalledWith(0.1);
  reduce();
  effects.update(0.01);
  expect(instance.pose).toHaveBeenLastCalledWith(0);
  effects.update(1);
  expect(instance.dispose).toHaveBeenCalledOnce();
});

test("disposal releases every instance once even when a cleanup fails", () => {
  const { effects, instances, asset, scene } = fixture();
  effects.hit(hit, "bolt");
  effects.hit(hit, "bolt");
  instances[1]!.dispose.mockImplementation(() => {
    throw new Error("cleanup failed");
  });
  expect(() => effects.dispose()).toThrow("cleanup failed");
  expect(instances[0]!.dispose).toHaveBeenCalledOnce();
  expect(() => effects.dispose()).not.toThrow();
  const count = scene.meshes.length;
  effects.hit(hit, "bolt");
  effects.markTarget(hit.to);
  effects.update(1);
  expect(scene.meshes).toHaveLength(count);
  expect(asset.instantiate).toHaveBeenCalledTimes(2);
});

test("fallback geometry also respects effect limits and disposal", () => {
  const { scene } = fixture();
  const map = new TerrainMap({ width: 10, height: 10, tileSize: 1 });
  const effects = createCombatEffectsView(scene, map);
  for (let index = 0; index < COMBAT_EFFECT_LIMIT * 2; index++)
    effects.markTarget(hit.to);
  expect(scene.meshes).toHaveLength(COMBAT_EFFECT_LIMIT);
  effects.dispose();
  effects.hit(hit, "bolt");
  expect(scene.meshes).toHaveLength(0);
});
