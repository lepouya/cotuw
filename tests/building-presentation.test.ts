import {
  Color3,
  MeshBuilder,
  NullEngine,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import { expect, test } from "vitest";

import { TerrainMap } from "../src/map";
import { createBarracksDetails } from "../src/render/barracks";
import { createRefineryDetails } from "../src/render/refinery";
import {
  loadModelAsset,
  modelBuildingDetails,
  staticInstance,
} from "../src/render/glb-model";
import { constructionStage } from "../src/render/construction-stage";
import { createTilePlacedActorViewRegistry } from "../src/render/tile-placed-actor-view";
import { createTilePlacedActor } from "../src/simulation/placement";
import { glbDataUrl } from "./helpers/assets";
import { ARC_ACTOR_DEFINITIONS, BASE_CONTENT } from "./helpers/content";

import type { ModelAsset } from "../src/render/glb-model";

const barracks = ARC_ACTOR_DEFINITIONS.find(
  ({ id }) => id === "arc-field-barracks",
)!;

function setup(reducedMotion = () => false) {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const map = new TerrainMap({ width: 12, height: 12, tileSize: 1 });
  const scaffold: ModelAsset = {
    instantiate: (name) => {
      const root = new TransformNode(name, scene);
      MeshBuilder.CreateBox(`${name}-frame`, { size: 1 }, scene).parent = root;
      return staticInstance(root);
    },
    dispose: () => {},
  };
  const appearances = new Map([
    [
      barracks.id,
      {
        height: 0.25,
        color: [0.3, 0.3, 0.3] as [number, number, number],
        createDetails: createBarracksDetails,
        scaffold,
      },
    ],
  ]);
  const views = createTilePlacedActorViewRegistry(
    scene,
    map,
    [barracks],
    appearances,
    { reducedMotion },
  );
  const actor = createTilePlacedActor(
    map,
    barracks,
    {
      actorId: "barracks",
      origin: { x: 4, z: 4 },
    },
    "player",
  );
  return { engine, scene, map, views, appearances, actor };
}

const leaf = (scene: Scene) =>
  scene.getMeshByName("tile-placed-actor-barracks-root-entrance-leaf-1")!;

test("construction progress divides into three equal stages", () => {
  const stage = (completedTicks: number) =>
    constructionStage({ paidCost: 0, completedTicks, totalTicks: 90 });
  expect([0, 29, 30, 59, 60, 89].map(stage)).toEqual([0, 0, 1, 1, 2, 2]);
});

test("blueprints rise through stages inside a scaffold that completion removes", () => {
  const { engine, scene, views, actor } = setup();
  try {
    views.update([actor]);
    const finished = views.topHeight(actor.id)!;
    const roof = scene
      .getMeshByName("tile-placed-actor-barracks-tile-4-4")!
      .getBoundingInfo().boundingBox.maximumWorld.y;
    const scaffold = () =>
      scene.getTransformNodeByName("tile-placed-actor-barracks-root-scaffold");
    const stage = (completedTicks: number) => {
      actor.construction = { paidCost: 0, completedTicks, totalTicks: 90 };
      views.update([actor]);
      return scene.getMeshByName("tile-placed-actor-barracks-root-quarters")!;
    };

    const quarters = stage(0);
    expect(quarters.isEnabled()).toBe(false);
    const foundation = scene.getMeshByName(
      "tile-placed-actor-barracks-tile-4-4",
    )!;
    expect(foundation.isEnabled()).toBe(true);
    expect(foundation.material!.clipPlane).toBeFalsy();
    expect(scaffold()!.scaling.x).toBe(3);
    expect(scaffold()!.scaling.z).toBe(2);
    expect(scaffold()!.scaling.y).toBeCloseTo((finished - roof) / 2);
    expect(
      scene.getMeshByName("tile-placed-actor-barracks-root-scaffold-frame")!
        .isPickable,
    ).toBe(false);

    const framed = stage(30);
    expect(framed.isEnabled()).toBe(true);
    expect(framed.visibility).toBe(0.45);
    expect(framed.material!.clipPlane!.d).toBeCloseTo(
      -(roof + (finished - roof) / 2),
    );
    expect(scaffold()!.scaling.y).toBeCloseTo(finished - roof);

    views.update([actor], new Set([actor.id]));
    const offline = scene.getMeshByName(
      "tile-placed-actor-barracks-root-quarters",
    )!;
    expect(offline.material!.clipPlane!.d).toBeCloseTo(
      -(roof + (finished - roof) / 2),
    );
    expect((offline.material as StandardMaterial).emissiveColor).toEqual(
      new Color3(0, 0, 0),
    );
    views.update([actor], new Set());

    const finishing = stage(60);
    expect(finishing.material!.clipPlane).toBeFalsy();
    expect(scaffold()).not.toBeNull();

    delete actor.construction;
    views.update([actor]);
    expect(scaffold()).toBeNull();
    const built = scene.getMeshByName(
      "tile-placed-actor-barracks-root-quarters",
    )!;
    expect(built.visibility).toBe(1);
    expect(built.material!.clipPlane).toBeFalsy();
    views.dispose();
  } finally {
    engine.dispose();
  }
});

test("a unit exit opens the Barracks doors once, and a blueprint ignores it", () => {
  const { engine, scene, views, actor } = setup();
  try {
    actor.construction = {
      paidCost: 0,
      completedTicks: 80,
      totalTicks: 90,
    };
    views.update([actor]);
    views.play(actor.id, "exit");
    views.animate(0, 1);
    expect(leaf(scene).position.x).toBeCloseTo(0.2);

    delete actor.construction;
    views.update([actor]);
    views.play(actor.id, "exit");
    views.animate(0, 1);
    expect(leaf(scene).position.x).toBeCloseTo(0.58);
    // The Barracks has no delivery motion, so its doors keep moving.
    views.play(actor.id, "delivery");
    views.animate(0, 0);
    expect(leaf(scene).position.x).toBeCloseTo(0.58);
    views.animate(0, 2);
    expect(leaf(scene).position.x).toBeCloseTo(0.2);
    views.dispose();
  } finally {
    engine.dispose();
  }
});

test("reduced motion skips activities and settles one in progress at rest", () => {
  let reduced = false;
  const { engine, scene, views, actor } = setup(() => reduced);
  try {
    views.update([actor]);
    views.play(actor.id, "exit");
    views.animate(0, 1);
    expect(leaf(scene).position.x).toBeCloseTo(0.58);
    reduced = true;
    views.animate(0, 0.1);
    expect(leaf(scene).position.x).toBeCloseTo(0.2);
    views.play(actor.id, "exit");
    views.animate(0, 1);
    expect(leaf(scene).position.x).toBeCloseTo(0.2);
    views.dispose();
  } finally {
    engine.dispose();
  }
});

test("terrain rebuilds retain activity time; disconnection and removal clear it", () => {
  const { engine, scene, map, views, actor } = setup();
  try {
    views.update([actor]);
    views.play(actor.id, "exit");
    views.animate(0, 1);
    const previous = leaf(scene);
    map.setHeight(4, 4, 0.1);
    views.animate(0);
    expect(previous.isDisposed()).toBe(true);
    expect(leaf(scene).position.x).toBeCloseTo(0.58);
    views.animate(0, 1.4);
    expect(leaf(scene).position.x).toBeCloseTo(0.2);

    views.play(actor.id, "exit");
    views.animate(0, 1);
    views.update([actor], new Set([actor.id]));
    views.animate(0, 1);
    expect(leaf(scene).position.x).toBeCloseTo(0.2);
    views.update([actor], new Set());
    views.animate(0, 1);
    expect(leaf(scene).position.x).toBeCloseTo(0.2);

    views.play(actor.id, "exit");
    views.animate(0, 1);
    views.update([]);
    views.update([actor]);
    views.animate(0, 0.1);
    expect(leaf(scene).position.x).toBeCloseTo(0.2);
    views.dispose();
  } finally {
    engine.dispose();
  }
});

test("a loaded model retains the stand-in's activity progress and settles at rest", async () => {
  const { engine, scene, views, appearances, actor } = setup();
  try {
    views.update([actor]);
    views.play(actor.id, "exit");
    views.animate(0, 1);
    const graphics = BASE_CONTENT.presentation[barracks.id]!.building!.glb!;
    const asset = await loadModelAsset(scene, {
      ...graphics,
      url: glbDataUrl(graphics.url),
    });
    appearances.set(barracks.id, {
      ...appearances.get(barracks.id)!,
      createDetails: modelBuildingDetails(asset),
    });
    views.update([actor]);
    views.animate(0);
    const door = scene.getMeshByName(
      "tile-placed-actor-barracks-root-model-barracks-entrance-leaf-1",
    )!;
    expect(Math.abs(door.position.x)).toBeCloseTo(0.58);
    views.animate(0, 1.4);
    expect(Math.abs(door.position.x)).toBeCloseTo(0.2);
    views.dispose();
    asset.dispose();
  } finally {
    engine.dispose();
  }
});

test("Refinery activities raise the garage door, and delivery runs the press", () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  try {
    const root = new TransformNode("refinery", scene);
    const details = createRefineryDetails(
      root,
      { center: Vector3.Zero(), roof: 0, tileSize: 1, facing: 0 },
      (name, configure) => {
        const material = new StandardMaterial(name, scene);
        configure(material);
        return material;
      },
    );
    const door = scene.getMeshByName("refinery-garage-door")!;
    const lamp = scene.getMeshByName("refinery-processing")!;
    const { exit, delivery } = details.activities!;
    exit!.pose(1);
    expect(door.scaling.y).toBeCloseTo(0.15);
    exit!.pose(exit!.seconds);
    expect(door.scaling.y).toBeCloseTo(1);
    delivery!.pose(1.5);
    expect(door.scaling.y).toBeCloseTo(0.15);
    expect(lamp.position.y).toBeGreaterThan(0.85);
    delivery!.pose(delivery!.seconds);
    expect(lamp.position.y).toBeCloseTo(0.72);
    details.dispose();
  } finally {
    engine.dispose();
  }
});

test.each(["arc-field-barracks", "arc-materials-refinery"])(
  "the generated %s model plays its activity clips",
  async (id) => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    try {
      const graphics = BASE_CONTENT.presentation[id]!.building!.glb!;
      const asset = await loadModelAsset(scene, {
        ...graphics,
        url: glbDataUrl(graphics.url),
      });
      const instance = asset.instantiate("model");
      const door =
        id === "arc-field-barracks"
          ? scene.getMeshByName("model-barracks-entrance-leaf-1")
          : scene.getMeshByName("model-refinery-garage-door");
      expect(door).toBeTruthy();
      const exit = instance.activities!.exit!;
      expect(exit.seconds).toBeCloseTo(2.4);
      const rest = door!.position.clone();
      exit.pose(1);
      expect(door!.position.equalsWithEpsilon(rest, 1e-4)).toBe(false);
      exit.pose(exit.seconds);
      expect(door!.position.equalsWithEpsilon(rest, 1e-4)).toBe(true);
      instance.dispose();
      asset.dispose();
    } finally {
      engine.dispose();
    }
  },
);

test("activity clips may not key channels that idle keys", async () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  try {
    const url = "/assets/models/barracks.glb";
    await expect(
      loadModelAsset(scene, {
        url: glbDataUrl(url),
        idle: "idle",
        activities: { exit: "idle" },
      }),
    ).rejects.toThrow("clip idle keys a channel that idle keys");
    await expect(
      loadModelAsset(scene, {
        url,
        activities: { wave: "exit" } as never,
      }),
    ).rejects.toThrow("activity clips named by activity kind");
  } finally {
    engine.dispose();
  }
});

test.each(["circle-heartgrove", "circle-conservatory", "circle-musterhall"])(
  "%s reveals roots, ribs and canopy with paused growth feedback",
  async (id) => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const map = new TerrainMap({ width: 12, height: 12, tileSize: 1 });
    const definition = BASE_CONTENT.actors.find((actor) => actor.id === id)!;
    const graphics = BASE_CONTENT.presentation[id]!.building!;
    const model = await loadModelAsset(scene, {
      ...graphics.glb!,
      url: glbDataUrl(graphics.glb!.url),
    });
    const appearances = new Map([
      [id, { ...graphics, createDetails: modelBuildingDetails(model) }],
    ]);
    const views = createTilePlacedActorViewRegistry(
      scene,
      map,
      [definition],
      appearances,
    );
    const actor = createTilePlacedActor(
      map,
      definition,
      {
        actorId: "growing",
        origin: { x: 3, z: 3 },
      },
      "player",
    );
    try {
      for (const [ticks, ribs, canopy] of [
        [0, false, false],
        [30, true, false],
        [60, true, true],
      ] as const) {
        actor.construction = {
          paidCost: 100,
          totalTicks: 90,
          completedTicks: ticks,
          active: true,
        };
        views.update([actor]);
        const part = (layer: string) =>
          scene.meshes.filter(
            (mesh) =>
              mesh.name.includes(`growth-${layer}`) &&
              mesh.name.includes("growing"),
          );
        expect(
          scene.meshes.filter(
            (mesh) =>
              mesh.name.includes("growing") && mesh.name.includes("growth-"),
          ).length,
        ).toBeLessThanOrEqual(8);
        for (const layer of ["roots", "ribs", "canopy"])
          expect(part(layer).length).toBeGreaterThan(0);
        expect(part("roots").every((mesh) => mesh.isEnabled())).toBe(true);
        expect(part("ribs").every((mesh) => mesh.isEnabled() === ribs)).toBe(
          true,
        );
        expect(
          part("canopy").every((mesh) => mesh.isEnabled() === canopy),
        ).toBe(true);
        expect(
          scene.transformNodes.some(
            (node) =>
              node.name.includes("growing") && node.name.endsWith("-scaffold"),
          ),
        ).toBe(false);
      }
      actor.construction!.active = false;
      views.update([actor]);
      views.animate(0.5, 0.1);
      const paused = scene.materials.find((material) =>
        material.name.endsWith("construction-paused"),
      ) as StandardMaterial;
      expect(paused.emissiveColor.r).toBeCloseTo(paused.emissiveColor.b);
      delete actor.construction;
      views.update([actor]);
      expect(
        scene.meshes
          .filter(
            (mesh) =>
              mesh.name.includes("growing") &&
              mesh.name.includes("growth-canopy"),
          )
          .every((mesh) => mesh.isEnabled()),
      ).toBe(true);
    } finally {
      views.dispose();
      model.dispose();
      engine.dispose();
    }
  },
);
