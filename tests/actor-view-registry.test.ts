import {
  MeshBuilder,
  NullEngine,
  Ray,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import { describe, expect, test } from "vitest";

import { TerrainMap } from "../src/map";
import { createMeshAppearance, stableUnit } from "../src/render/actor";
import {
  createActorViewRegistry,
  interpolatePose,
} from "../src/render/actor-view-registry";
import { withFrameEffects } from "../src/render/frame-effects";

import type { ActorAppearance, ActorPose } from "../src/render/actor";
import type { ActorMotion } from "../src/render/actor-gait";
import type { ActorRenderState } from "../src/simulation/actor";
import type { FrameEffect } from "../src/render/frame-effects";

function pose(x: number, z: number, facing: number): ActorPose {
  return { worldPosition: { x, z }, facing };
}

function actor(id: string, x = 0, facing = 0): ActorRenderState {
  return {
    id,
    definitionId: "trooper",
    worldPosition: { x, z: 0 },
    facing,
    occupancyLayer: "surface",
  };
}

describe("interpolatePose", () => {
  test("blends position between ticks", () => {
    const result = interpolatePose(
      pose(0, 0, 0),
      pose(4, -2, 0),
      0.25,
      pose(0, 0, 0),
    );

    expect(result.worldPosition).toEqual({ x: 1, z: -0.5 });
  });

  test("turns the short way across the angle wrap", () => {
    const result = interpolatePose(
      pose(0, 0, Math.PI - 0.1),
      pose(0, 0, -Math.PI + 0.1),
      0.5,
      pose(0, 0, 0),
    );

    expect(result.facing).toBeCloseTo(Math.PI);
  });

  test("copies the current pose without a previous one", () => {
    expect(
      interpolatePose(undefined, pose(3, 4, 1), 0.5, pose(0, 0, 0)),
    ).toEqual(pose(3, 4, 1));
  });
});

describe("actor view registry", () => {
  function setup(appearance?: (scene: Scene) => ActorAppearance) {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const map = new TerrainMap({ width: 10, height: 10, tileSize: 1 });
    const template = MeshBuilder.CreateBox("template", { size: 1 }, scene);
    template.position.y = 0.5;
    template.material = new StandardMaterial("template-material", scene);
    const appearances = new Map([
      [
        "trooper",
        appearance?.(scene) ??
          createMeshAppearance(template, { radius: 0.5, height: 1 }),
      ],
    ]);
    const views = createActorViewRegistry(scene, map, appearances);
    return { appearances, engine, scene, template, views };
  }

  test("clones the appearance mesh and hides the template", () => {
    const { engine, scene, template, views } = setup();

    views.update([actor("a")], 1);
    const clone = scene.getMeshByName("actor-a")!;

    expect(template.isEnabled()).toBe(false);
    expect(clone.isEnabled()).toBe(true);
    expect(clone.material).toBe(template.material);
    expect(clone.position.y).toBe(0.5);

    views.dispose();
    // Clones share the template's material, which the caller still owns.
    expect(scene.materials).toContain(template.material);
    engine.dispose();
  });

  test("falls back to a stand-in for an unknown definition", () => {
    const { engine, scene, views } = setup();

    views.update([{ ...actor("odd"), definitionId: "unknown" }], 1);

    expect(views.actorIdForMesh(scene.getMeshByName("actor-odd-pick"))).toBe(
      "odd",
    );

    views.dispose();
    engine.dispose();
  });

  test("rebuilds a view when its ID returns as another kind of actor", () => {
    const { engine, scene, template, views } = setup();

    views.update([actor("a", 0)], 1);
    views.capturePreviousPoses([actor("a", 0)]);
    views.update([{ ...actor("a", 4), definitionId: "unknown" }], 0.5);
    const mesh = scene.getMeshByName("actor-a")!;

    expect(mesh.material).not.toBe(template.material);
    // No pose carries over from the actor that held the ID before.
    expect(scene.getTransformNodeByName("actor-a-root")!.position.x).toBe(4);

    views.dispose();
    engine.dispose();
  });

  test("late model loads preserve the current movement interpolation", () => {
    const { appearances, engine, scene, views } = setup();
    views.update([actor("a")], 1);
    views.capturePreviousPoses([actor("a")]);
    views.update([actor("a", 4)], 0.25);
    expect(views.groundPosition("a")!.x).toBe(1);
    const loaded = MeshBuilder.CreateBox("loaded", {}, scene);
    appearances.set(
      "trooper",
      createMeshAppearance(loaded, { radius: 0.4, height: 1 }),
    );
    views.update([actor("a", 4)], 0.25);
    expect(views.groundPosition("a")!.x).toBe(1);
    views.update([actor("a", 4)], 0.5);
    expect(views.groundPosition("a")!.x).toBe(2);
    views.dispose();
    engine.dispose();
  });

  test("a loaded model starts at its drawn pose without inventing motion", () => {
    const motions: ActorMotion[] = [];
    const { appearances, engine, scene, views } = setup();
    try {
      views.update([actor("a")], 1);
      views.capturePreviousPoses([actor("a")]);
      appearances.set("trooper", {
        bounds: { radius: 0.5, height: 1 },
        instantiate: (name) => {
          const root = new TransformNode(name, scene);
          return {
            root,
            animate: (motion) => motions.push({ ...motion }),
            dispose: () => root.dispose(),
          };
        },
        dispose: () => {},
      });
      views.update([actor("a", 4)], 0.25, 0.1);
      expect(views.groundPosition("a")!.x).toBe(1);
      expect(motions[motions.length - 1]).toEqual({
        distance: 0,
        turn: 0,
        seconds: 0,
      });
      views.update([actor("a", 4)], 0.5, 0.1);
      expect(motions[motions.length - 1]).toEqual({
        distance: 1,
        turn: 0,
        seconds: 0.1,
      });
    } finally {
      views.dispose();
      engine.dispose();
    }
  });

  test("capturing a tick forgets actors removed before they were drawn", () => {
    const { engine, views } = setup();
    try {
      views.capturePreviousPoses([actor("hidden")]);
      views.capturePreviousPoses([]);
      views.update([actor("hidden", 4)], 0.5);
      expect(views.groundPosition("hidden")!.x).toBe(4);
    } finally {
      views.dispose();
      engine.dispose();
    }
  });

  test("rebuilds a view when its appearance finishes loading", () => {
    const { appearances, engine, scene, views } = setup();
    views.update([actor("a")], 1);
    views.setSelectedActors(["a"]);
    const standIn = scene.getMeshByName("actor-a")!;

    const loaded = MeshBuilder.CreateSphere("loaded", {}, scene);
    loaded.material = new StandardMaterial("loaded-material", scene);
    const loadedAppearance = createMeshAppearance(loaded, {
      radius: 0.4,
      height: 1.2,
    });
    appearances.set("trooper", loadedAppearance);
    views.update([actor("a")], 1);

    expect(standIn.isDisposed()).toBe(true);
    expect(scene.getMeshByName("actor-a")!.material).toBe(loaded.material);
    expect(scene.getMeshByName("actor-a-selection")!.isEnabled()).toBe(true);

    views.dispose();
    loadedAppearance.dispose();
    engine.dispose();
  });

  test("creates and removes views as actors come and go", () => {
    const { engine, scene, views } = setup();

    views.update([actor("a"), actor("b")], 1);
    const pickB = scene.getMeshByName("actor-b-pick");
    expect(views.actorIdForMesh(pickB)).toBe("b");

    views.update([actor("a")], 1);
    expect(scene.getMeshByName("actor-b")).toBeNull();
    expect(views.actorIdForMesh(pickB)).toBeUndefined();

    views.dispose();
    engine.dispose();
  });

  test("draws between the captured and current poses", () => {
    const { engine, scene, views } = setup();

    views.update([actor("a", 0)], 1);
    views.capturePreviousPoses([actor("a", 0)]);
    views.update([actor("a", 2)], 0.5);

    expect(scene.getTransformNodeByName("actor-a-root")!.position.x).toBe(1);

    views.dispose();
    engine.dispose();
  });

  test("rings the selected actor, including views created later", () => {
    const { engine, scene, views } = setup();

    views.setSelectedActors(["late"]);
    views.update([actor("late"), actor("other")], 1);
    const ring = () => scene.getMeshByName("actor-late-selection");

    expect(ring()?.isEnabled()).toBe(true);
    expect(scene.getMeshByName("actor-other-selection")).toBeNull();

    views.setSelectedActors([]);
    expect(ring()?.isEnabled()).toBe(false);

    views.dispose();
    engine.dispose();
  });

  test("picks the visible mesh and an invisible proxy sized by the bounds", () => {
    const { engine, scene, views } = setup();

    views.update([actor("a")], 1);
    views.setSelectedActors(["a"]);
    const pick = scene.getMeshByName("actor-a-pick")!;
    const ring = scene.getMeshByName("actor-a-selection")!;

    expect(views.actorIdForMesh(scene.getMeshByName("actor-a"))).toBe("a");
    expect(scene.getMeshByName("actor-a")!.isPickable).toBe(true);
    expect(pick.isVisible).toBe(false);
    expect(pick.getBoundingInfo().boundingBox.extendSize.y).toBeCloseTo(0.5);
    expect(ring.getBoundingInfo().boundingBox.extendSize.x).toBeCloseTo(
      0.5 + 0.15 + 0.03,
    );

    views.dispose();
    engine.dispose();
  });

  test("picks model geometry outside the proxy", () => {
    const { engine, scene, views } = setup((scene) => {
      const mesh = MeshBuilder.CreateBox(
        "extended-model",
        { size: 0.2 },
        scene,
      );
      mesh.position.set(0, 0.5, 1);
      return createMeshAppearance(mesh, { radius: 0.5, height: 1 });
    });
    views.update([actor("a")], 1);

    const ray = new Ray(new Vector3(0, 0.5, 2), new Vector3(0, 0, -1));
    const hit = scene.pickWithRay(
      ray,
      (mesh) => views.actorIdForMesh(mesh) !== undefined,
    );

    expect(hit?.pickedMesh?.name).toBe("actor-a");
    views.dispose();
    engine.dispose();
  });

  test("animates from the rendered motion, turning the short way", () => {
    const motions: ActorMotion[] = [];
    const disposed: string[] = [];
    const { engine, views } = setup((scene) => ({
      bounds: { radius: 0.5, height: 1 },
      instantiate: (name) => ({
        root: new TransformNode(name, scene),
        animate: (motion) => motions.push({ ...motion }),
        dispose: () => disposed.push(name),
      }),
      dispose: () => {},
    }));

    views.update([actor("a", 0, Math.PI - 0.1)], 1);
    views.update([actor("a", 3, -Math.PI + 0.1)], 1);

    const motion = motions[motions.length - 1];
    expect(motion.distance).toBeCloseTo(3);
    expect(motion.turn).toBeCloseTo(0.2);

    views.update([], 1);
    expect(disposed).toEqual(["actor-a"]);
    views.dispose();
    engine.dispose();
  });

  test("plays triggers on drawn actors with their frame effects", () => {
    const played: string[] = [];
    const effect: FrameEffect = {
      clip: "flash",
      url: "/flash.png",
      size: 1,
      anchor: [0, 1, 1],
    };
    const { engine, scene, views } = setup((scene) =>
      withFrameEffects(
        {
          bounds: { radius: 0.5, height: 1 },
          instantiate: (name) => ({
            root: new TransformNode(name, scene),
            play: (trigger) => played.push(trigger),
            dispose: () => {},
          }),
          dispose: () => {},
        },
        { attack: effect },
        {
          play: (shown, node) => {
            played.push(`${shown.clip} on ${node.name}`);
          },
        },
      ),
    );
    views.update([actor("a")], 1);

    views.play("a", "attack");
    views.play("hidden", "attack");
    views.update([actor("a")], 1);

    expect(played).toEqual(["attack", "flash on actor-a"]);
    expect(scene.getTransformNodeByName("actor-a")!.parent!.name).toBe(
      "actor-a-root",
    );
    views.dispose();
    engine.dispose();
  });

  test("triggers use the current pose and skip hidden actors without replay", () => {
    const played: [string, number][] = [];
    const { engine, views } = setup((scene) => ({
      bounds: { radius: 0.5, height: 1 },
      instantiate: (name) => {
        const root = new TransformNode(name, scene);
        return {
          root,
          play: () =>
            played.push([name, (root.parent as TransformNode).position.x]),
          dispose: () => root.dispose(),
        };
      },
      dispose: () => {},
    }));
    views.update([actor("old")], 1);
    views.play("old", "attack");
    views.play("new", "attack");
    views.play("new", "attack");
    views.update([actor("new", 4)], 1);
    expect(played).toEqual([["actor-new", 4]]);
    views.update([actor("old"), actor("new", 4)], 1);
    expect(played).toHaveLength(1);
    views.dispose();
    engine.dispose();
  });
});

test("stable unit values stay in range and differ between IDs", () => {
  const values = ["a", "b", "prototype-trooper"].map(stableUnit);

  expect(values.every((value) => value >= 0 && value < 1)).toBe(true);
  expect(new Set(values).size).toBe(values.length);
  expect(stableUnit("a")).toBe(values[0]);
});
