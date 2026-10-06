import {
  MeshBuilder,
  NullEngine,
  Scene,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import { expect, test } from "vitest";

import { TerrainMap } from "../src/map";
import { createAmbientBirdsView } from "../src/render/ambient-birds";
import {
  createDamageEffectsView,
  damageSeverity,
} from "../src/render/damage-effects";

import type { ModelAsset } from "../src/render/glb-model";
import type { DamagedActor } from "../src/render/damage-effects";

/** Box props whose pose records the time they were posed at. */
function boxProp(scene: Scene, posed: number[] = []): ModelAsset {
  return {
    instantiate: (name) => {
      const root = new TransformNode(name, scene);
      MeshBuilder.CreateBox(`${name}-box`, { size: 1 }, scene).parent = root;
      return {
        root,
        pose: (seconds) => posed.push(seconds),
        dispose: () => root.dispose(false, true),
      };
    },
    dispose: () => {},
  };
}

const damaged = (
  severity: DamagedActor["severity"],
  style: DamagedActor["style"] = "mechanical",
): DamagedActor => ({
  id: "target",
  style,
  severity,
  position: new Vector3(2, 1, 3),
  height: 2,
  radius: 1,
});

const shown = (scene: Scene, prefix: string) =>
  scene.transformNodes.filter(
    (node) => node.name.startsWith(prefix) && node.isEnabled(),
  );

test("damage shows below 60% health and turns critical at 30%", () => {
  expect([1, 0.61, 0.6, 0.31, 0.3, 0].map(damageSeverity)).toEqual([
    undefined,
    undefined,
    "moderate",
    "moderate",
    "critical",
    "critical",
  ]);
});

test("moderate smoke pulses and rises; critical damage adds denser smoke and fire", () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  try {
    const flames: number[] = [];
    const smoke = boxProp(scene);
    const fire = boxProp(scene, flames);
    const effects = createDamageEffectsView(scene, (prop) =>
      prop === "fire" ? fire : smoke,
    );
    const counts: number[] = [];
    for (let frame = 0; frame < 40; frame++) {
      effects.update([damaged("moderate")], 0.1);
      counts.push(shown(scene, "damage-target-smoke").length);
    }
    expect(Math.min(...counts)).toBe(0);
    expect(Math.max(...counts)).toBeGreaterThan(0);
    expect(scene.getTransformNodeByName("damage-target-fire")).toBeNull();
    const puff = shown(scene, "damage-target-smoke")[0]!;
    const height = puff.position.y;
    effects.update([damaged("moderate")], 0.1);
    expect(puff.position.y).toBeGreaterThan(height);
    expect(puff.position.y).toBeGreaterThanOrEqual(1.8);

    effects.update([damaged("critical")], 0.1);
    const critical = shown(scene, "damage-target-smoke").length;
    expect(critical).toBeGreaterThan(Math.max(...counts));
    expect(
      scene.getTransformNodeByName("damage-target-fire")!.position.y,
    ).toBeCloseTo(1.7);
    expect(flames.length).toBeGreaterThan(0);
    expect(scene.getTransformNodeByName("damage-target")!.position).toEqual(
      new Vector3(2, 1, 3),
    );

    effects.update([], 0.1);
    expect(scene.getTransformNodeByName("damage-target")).toBeNull();
    effects.dispose();
  } finally {
    engine.dispose();
  }
});

test("wound drops fall toward the ground and hold still when motion is reduced", () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  try {
    let reduced = false;
    const wound = boxProp(scene);
    const effects = createDamageEffectsView(
      scene,
      () => wound,
      () => reduced,
    );
    const heights = () =>
      shown(scene, "damage-target-wound").map((node) => node.position.y);
    effects.update([damaged("critical", "biological")], 0);
    expect(heights().length).toBeGreaterThan(0);
    const before = heights();
    effects.update([damaged("critical", "biological")], 0.05);
    expect(Math.min(...heights())).toBeLessThan(Math.min(...before));
    expect(Math.max(...heights())).toBeLessThanOrEqual(1.1);
    reduced = true;
    const held = heights();
    effects.update([damaged("critical", "biological")], 0.05);
    expect(heights()).toEqual(held);
    expect(scene.getTransformNodeByName("damage-target-fire")).toBeNull();
    effects.dispose();
  } finally {
    engine.dispose();
  }
});

test("effects wait for their props and appear once they load", () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  try {
    let loaded: ModelAsset | undefined;
    const effects = createDamageEffectsView(scene, () => loaded);
    effects.update([damaged("critical")], 0.1);
    expect(shown(scene, "damage-target-").length).toBe(0);
    loaded = boxProp(scene);
    effects.update([damaged("critical")], 0.1);
    expect(shown(scene, "damage-target-smoke").length).toBeGreaterThan(0);
    const previous = scene.getTransformNodeByName("damage-target")!;
    const before = shown(scene, "damage-target-smoke")[0]!.position.y;
    loaded = boxProp(scene);
    effects.update([damaged("critical")], 0);
    expect(previous.isDisposed()).toBe(true);
    expect(shown(scene, "damage-target-smoke")[0]!.position.y).toBeCloseTo(
      before,
    );
    effects.dispose();
    expect(scene.getTransformNodeByName("damage-target")).toBeNull();
  } finally {
    engine.dispose();
  }
});

test.each(["mechanical", "biological"] as const)(
  "reduced motion keeps a visible %s cue even when frozen during a burst gap",
  (style) => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    try {
      let reduced = false;
      const prop = boxProp(scene);
      const effects = createDamageEffectsView(
        scene,
        () => prop,
        () => reduced,
      );
      const prefix = `damage-target-${style === "mechanical" ? "smoke" : "wound"}`;
      const actor = damaged("moderate", style);
      for (let frame = 0; frame < 100; frame++) {
        effects.update([actor], 0.1);
        if (shown(scene, prefix).length === 0) break;
      }
      expect(shown(scene, prefix)).toHaveLength(0);
      reduced = true;
      effects.update([actor], 0);
      expect(shown(scene, prefix)).toHaveLength(1);
      const held = shown(scene, prefix)[0]!.position.clone();
      effects.update([actor], 1);
      expect(shown(scene, prefix)[0]!.position).toEqual(held);
      effects.dispose();
    } finally {
      engine.dispose();
    }
  },
);

test("bird loops clear narrow ridges, refresh edited terrain, and tolerate off-map loops", () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  try {
    const map = new TerrainMap({ width: 100, height: 100, tileSize: 1 });
    // A narrow peak between coarse angular samples must still set clearance.
    map.setHeight(87, 58, 20);
    const asset = boxProp(scene);
    const birds = createAmbientBirdsView(
      map,
      [
        {
          center: { x: 0, z: 0 },
          radius: 40,
          altitude: 2,
          count: 1,
          lapSeconds: 10,
        },
        {
          center: { x: 1000, z: 1000 },
          radius: 2,
          altitude: 1,
          count: 1,
          lapSeconds: 5,
        },
      ],
      { bird: () => asset, explored: () => true },
    );
    birds.update(0);
    const leader = scene.getTransformNodeByName("bird-0-0")!;
    expect(leader.position.y).toBe(22);
    expect(scene.getTransformNodeByName("bird-1-0")!.isEnabled()).toBe(false);
    map.setHeight(87, 58, 30);
    birds.update(0);
    expect(leader.position.y).toBe(32);
    birds.dispose();
  } finally {
    engine.dispose();
  }
});

test("birds circle their flock above the terrain and hide over unexplored tiles", () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  try {
    const map = new TerrainMap({
      width: 20,
      height: 20,
      tileSize: 1,
      createHeight: (x) => (x >= 13 ? 3 : 0),
    });
    let reduced = false;
    let explored = true;
    let bird: ModelAsset | undefined;
    const posed: number[] = [];
    const flock = {
      center: { x: 0, z: 0 },
      radius: 4,
      altitude: 2,
      count: 3,
      lapSeconds: 10,
    };
    const birds = createAmbientBirdsView(map, [flock], {
      bird: () => bird,
      explored: () => explored,
      reducedMotion: () => reduced,
    });
    birds.update(0.1);
    expect(scene.transformNodes.length).toBe(0);
    bird = boxProp(scene, posed);
    birds.update(0.1);
    const leader = scene.getTransformNodeByName("bird-0-0")!;
    expect(scene.getTransformNodeByName("bird-0-2")).not.toBeNull();
    const distance = Math.hypot(leader.position.x, leader.position.z);
    expect(distance).toBeGreaterThanOrEqual(3.6);
    expect(distance).toBeLessThanOrEqual(4.4);
    // The loop crosses the raised edge, so the whole flock clears it.
    expect(leader.position.y).toBeGreaterThan(3 + 2 - 0.7);
    const start = leader.position.clone();
    birds.update(1);
    expect(leader.position.equals(start)).toBe(false);
    expect(posed.length).toBeGreaterThan(0);
    reduced = true;
    const held = leader.position.clone();
    birds.update(1);
    expect(leader.position).toEqual(held);
    explored = false;
    birds.update(1);
    expect(leader.isEnabled()).toBe(false);
    birds.dispose();
    expect(leader.isDisposed()).toBe(true);
  } finally {
    engine.dispose();
  }
});
