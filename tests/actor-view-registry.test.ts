import {
  MeshBuilder,
  NullEngine,
  Scene,
  StandardMaterial,
} from "@babylonjs/core";
import { describe, expect, test } from "vitest";

import { TerrainMap } from "../src/map";
import {
  createActorViewRegistry,
  interpolatePose,
} from "../src/render/actor-view-registry";

import type { ActorPose } from "../src/render/actor";
import type { ActorRenderState } from "../src/simulation/actor";

function pose(x: number, z: number, facing: number): ActorPose {
  return { worldPosition: { x, z }, facing };
}

function actor(id: string, x = 0, facing = 0): ActorRenderState {
  return {
    id,
    definitionId: "trooper",
    worldPosition: { x, z: 0 },
    facing,
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
  function setup() {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const map = new TerrainMap({ width: 10, height: 10, tileSize: 1 });
    const template = MeshBuilder.CreateBox("template", { size: 1 }, scene);
    template.position.y = 0.5;
    template.material = new StandardMaterial("template-material", scene);
    const views = createActorViewRegistry(
      scene,
      map,
      new Map([["trooper", { mesh: template }]]),
    );
    return { engine, scene, template, views };
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

    expect(views.actorIdForMesh(scene.getMeshByName("actor-odd"))).toBe("odd");

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

  test("creates and removes views as actors come and go", () => {
    const { engine, scene, views } = setup();

    views.update([actor("a"), actor("b")], 1);
    const meshB = scene.getMeshByName("actor-b");
    expect(views.actorIdForMesh(meshB)).toBe("b");

    views.update([actor("a")], 1);
    expect(scene.getMeshByName("actor-b")).toBeNull();
    expect(views.actorIdForMesh(meshB)).toBeUndefined();

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

    views.setSelectedActor("late");
    views.update([actor("late"), actor("other")], 1);
    const ring = () => scene.getMeshByName("actor-late-selection");

    expect(ring()?.isEnabled()).toBe(true);
    expect(scene.getMeshByName("actor-other-selection")).toBeNull();

    views.setSelectedActor(undefined);
    expect(ring()?.isEnabled()).toBe(false);

    views.dispose();
    engine.dispose();
  });
});
