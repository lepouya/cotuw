import {
  Color3,
  MeshBuilder,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import { expect, test, vi } from "vitest";

import { testScene } from "./helpers/scene";
import { glbDataUrl } from "./helpers/assets";
import { ARC_ACTOR_DEFINITIONS, BASE_CONTENT } from "./helpers/content";
import { TerrainMap } from "../src/map";
import { createBarracksDetails } from "../src/render/barracks";
import { createRefineryDetails } from "../src/render/refinery";
import { createSentryDetails } from "../src/render/sentry";
import { BUILTIN_BUILDING_DETAILS } from "../src/render/builtin-models";
import {
  createOwnerMaterials,
  isOwnerMaterial,
} from "../src/render/owner-materials";
import {
  loadModelAsset,
  modelBuildingDetails,
  staticInstance,
} from "../src/render/glb-model";
import {
  constructionStage,
  stageGrowth,
} from "../src/render/construction-stage";
import { createTilePlacedActorViewRegistry } from "../src/render/tile-placed-actor-view";
import { createTilePlacedActor } from "../src/simulation/placement";

import type { ModelAsset } from "../src/render/glb-model";
import type { TilePlacedActorAppearance } from "../src/render/tile-placed-actor-view";

const barracks = ARC_ACTOR_DEFINITIONS.find(
  ({ id }) => id === "arc-field-barracks",
)!;

function setup(reducedMotion = () => false) {
  const scene = testScene();
  const map = new TerrainMap({ width: 12, height: 12, tileSize: 1 });
  const scaffold: ModelAsset = {
    instantiate: (name) => {
      const root = new TransformNode(name, scene);
      MeshBuilder.CreateBox(`${name}-frame`, { size: 1 }, scene).parent = root;
      return staticInstance(root);
    },
    dispose: () => {},
  };
  const appearances = new Map<string, TilePlacedActorAppearance>([
    [
      barracks.id,
      {
        height: 0.25,
        color: [0.3, 0.3, 0.3],
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
  return { scene, map, views, appearances, actor };
}

const leaf = (scene: Scene) =>
  scene.getMeshByName("tile-placed-actor-barracks-root-entrance-leaf-1")!;

test("construction progress divides into three equal stages", () => {
  const stage = (completedTicks: number) =>
    constructionStage({ completedTicks, totalTicks: 90 });
  expect([0, 29, 30, 59, 60, 89].map(stage)).toEqual([0, 0, 1, 1, 2, 2]);
});

test("growth layers keep their stage when an actor ID contains growth-roots", () => {
  const scene = testScene();
  const parts = ["roots", "ribs", "canopy"].map((layer) =>
    MeshBuilder.CreateBox(
      `tile-placed-actor-growth-roots-root-model-growth-${layer}`,
      {},
      scene,
    ),
  );
  for (const stage of [0, 1, 2]) {
    stageGrowth(parts, stage);
    expect(parts.map((mesh) => mesh.isEnabled())).toEqual([
      true,
      stage >= 1,
      stage >= 2,
    ]);
  }
});

test("undrawn buildings estimate their top from placement and model height", () => {
  const { views, appearances, actor } = setup();
  // Flat terrain: the roof is the appearance height.
  expect(views.topHeight(actor)).toBeCloseTo(0.25 + 1);
  appearances.set(barracks.id, {
    ...appearances.get(barracks.id)!,
    modelTopHeight: 2,
  });
  expect(views.topHeight(actor)).toBeCloseTo(0.25 + 2);
  views.update([actor]);
  expect(views.topHeight(actor)).not.toBeCloseTo(0.25 + 2);
});

test("blueprints rise through stages inside a scaffold that completion removes", () => {
  const { scene, views, actor } = setup();
  views.update([actor]);
  const finished = views.topHeight(actor)!;
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
});

test("a unit exit opens the Barracks doors once, and a blueprint ignores it", () => {
  const { scene, views, actor } = setup();
  actor.construction = {
    paidCost: 0,
    completedTicks: 80,
    totalTicks: 90,
  };
  views.update([actor]);
  const closed = leaf(scene).position.x;
  views.play(actor.id, "exit");
  views.animate(0, 1);
  expect(leaf(scene).position.x).toBeCloseTo(closed);

  delete actor.construction;
  views.update([actor]);
  views.play(actor.id, "exit");
  views.animate(0, 1);
  const open = leaf(scene).position.x;
  expect(open).toBeGreaterThan(closed);
  // The Barracks has no delivery motion, so its doors keep moving.
  views.play(actor.id, "delivery");
  views.animate(0, 0);
  expect(leaf(scene).position.x).toBeCloseTo(open);
  views.animate(0, 2);
  expect(leaf(scene).position.x).toBeCloseTo(closed);
  views.dispose();
});

test("reduced motion skips activities and settles one in progress at rest", () => {
  let reduced = false;
  const { scene, views, actor } = setup(() => reduced);
  views.update([actor]);
  const closed = leaf(scene).position.x;
  views.play(actor.id, "exit");
  views.animate(0, 1);
  expect(leaf(scene).position.x).toBeGreaterThan(closed);
  reduced = true;
  views.animate(0, 0.1);
  expect(leaf(scene).position.x).toBeCloseTo(closed);
  views.play(actor.id, "exit");
  views.animate(0, 1);
  expect(leaf(scene).position.x).toBeCloseTo(closed);
  views.dispose();
});

test("reduced motion restores building idle motion to rest", () => {
  let reduced = false;
  const { views, appearances, actor } = setup(() => reduced);
  const update = vi.fn();
  appearances.set(barracks.id, {
    ...appearances.get(barracks.id)!,
    createDetails: () => ({ update, dispose: () => {} }),
  });
  views.update([actor]);
  views.animate(1.2, 0.1);
  expect(update).toHaveBeenLastCalledWith(1.2);
  reduced = true;
  views.animate(1.2, 0.1);
  expect(update).toHaveBeenLastCalledWith(0);
  reduced = false;
  views.animate(1.3, 0.1);
  expect(update).toHaveBeenLastCalledWith(1.3);
});

test("terrain rebuilds retain activity time; disconnection and removal clear it", () => {
  const { scene, map, views, actor } = setup();
  views.update([actor]);
  const closed = leaf(scene).position.x;
  views.play(actor.id, "exit");
  views.animate(0, 1);
  const previous = leaf(scene);
  const open = previous.position.x;
  expect(open).toBeGreaterThan(closed);
  map.setHeight(4, 4, 0.1);
  views.animate(0);
  expect(previous.isDisposed()).toBe(true);
  expect(leaf(scene).position.x).toBeCloseTo(open);
  views.animate(0, 1.4);
  expect(leaf(scene).position.x).toBeCloseTo(closed);

  views.play(actor.id, "exit");
  views.animate(0, 1);
  views.update([actor], new Set([actor.id]));
  views.animate(0, 1);
  expect(leaf(scene).position.x).toBeCloseTo(closed);
  views.update([actor], new Set());
  views.animate(0, 1);
  expect(leaf(scene).position.x).toBeCloseTo(closed);

  views.play(actor.id, "exit");
  views.animate(0, 1);
  views.update([]);
  views.update([actor]);
  views.animate(0, 0.1);
  expect(leaf(scene).position.x).toBeCloseTo(closed);
  views.dispose();
});

test("a loaded model retains the stand-in's activity progress and settles at rest", async () => {
  const { scene, views, appearances, actor } = setup();
  views.update([actor]);
  const closed = leaf(scene).position.x;
  views.play(actor.id, "exit");
  views.animate(0, 1);
  const open = leaf(scene).position.x;
  expect(open).toBeGreaterThan(closed);
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
  expect(Math.abs(door.position.x)).toBeCloseTo(open);
  views.animate(0, 1.4);
  expect(Math.abs(door.position.x)).toBeCloseTo(closed);
  views.dispose();
  asset.dispose();
});

test("Refinery activities raise the garage door, and delivery runs the press", () => {
  const scene = testScene();
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
});

test.each(["arc-field-barracks", "arc-materials-refinery"])(
  "the generated %s model plays its activity clips",
  async (id) => {
    const scene = testScene();
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
  },
);

test("activity clips may not key channels that idle keys", async () => {
  const scene = testScene();
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
});

test.each([
  "circle-heartgrove",
  "circle-conservatory",
  "circle-musterhall",
  "circle-construct-nursery",
  "circle-thornspire",
])(
  "%s reveals roots, ribs and canopy with paused growth feedback",
  async (id) => {
    const scene = testScene();
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
        // Crown petals and entrance leaves stay separate to animate.
      ).toBeLessThanOrEqual(
        8 +
          (id === "circle-thornspire" ? 2 : 0) +
          (graphics.glb!.activities?.exit ? 3 : 0),
      );
      for (const layer of ["roots", "ribs", "canopy"])
        expect(part(layer).length).toBeGreaterThan(0);
      expect(part("roots").every((mesh) => mesh.isEnabled())).toBe(true);
      expect(part("ribs").every((mesh) => mesh.isEnabled() === ribs)).toBe(
        true,
      );
      expect(part("canopy").every((mesh) => mesh.isEnabled() === canopy)).toBe(
        true,
      );
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
  },
);

test.each([
  "circle-heartgrove",
  "circle-conservatory",
  "circle-musterhall",
  "circle-construct-nursery",
  "circle-thornspire",
])(
  "%s shows authored damage stages by health and recedes on repair",
  async (id) => {
    const scene = testScene();
    const map = new TerrainMap({ width: 12, height: 12, tileSize: 1 });
    const definition = BASE_CONTENT.actors.find((actor) => actor.id === id)!;
    const graphics = BASE_CONTENT.presentation[id]!.building!;
    const model = await loadModelAsset(scene, {
      ...graphics.glb!,
      url: glbDataUrl(graphics.glb!.url),
    });
    let reduced = false;
    const views = createTilePlacedActorViewRegistry(
      scene,
      map,
      [definition],
      new Map([
        [id, { ...graphics, createDetails: modelBuildingDetails(model) }],
      ]),
      { reducedMotion: () => reduced },
    );
    const actor = createTilePlacedActor(
      map,
      definition,
      { actorId: "hurt-damage-critical", origin: { x: 4, z: 4 } },
      "player",
    );
    const prefix = `tile-placed-actor-${actor.id}-root-`;
    const stage = (name: string) =>
      scene.meshes.filter(
        (mesh) =>
          mesh.name.startsWith(prefix) &&
          mesh.name.slice(prefix.length).includes(name),
      );
    const shown = (name: string) => stage(name).every((m) => m.isEnabled());
    const hidden = (name: string) => stage(name).every((m) => !m.isEnabled());
    const maximum = definition.health!;
    const at = (fraction: number) => {
      views.update([{ ...actor, health: maximum * fraction }]);
      views.animate(1.37, 0.1);
    };
    at(1);
    expect(stage("damage-moderate").length).toBeGreaterThan(0);
    expect(stage("damage-critical-flicker").length).toBeGreaterThan(0);
    expect(hidden("damage-moderate") && hidden("damage-critical")).toBe(true);
    at(0.5);
    expect(shown("damage-moderate") && hidden("damage-critical")).toBe(true);
    at(0.2);
    expect(shown("damage-moderate") && shown("damage-critical")).toBe(true);
    const flicker = stage("damage-critical-flicker")[0]!;
    const levels = new Set<number>();
    for (let frame = 0; frame < 12; frame++) {
      views.animate(frame * 0.05, 0.05);
      levels.add(flicker.visibility);
    }
    expect(levels.size).toBeGreaterThan(1);
    reduced = true;
    views.animate(2, 0.05);
    expect(flicker.visibility).toBe(1);
    // Growing layers would leave broken shapes floating.
    views.update([
      {
        ...actor,
        health: maximum * 0.2,
        construction: {
          totalTicks: 90,
          completedTicks: 80,
          active: true,
        },
      },
    ]);
    expect(hidden("damage-moderate") && hidden("damage-critical")).toBe(true);
    views.update([{ ...actor, health: maximum * 0.7 }]);
    expect(hidden("damage-moderate") && hidden("damage-critical")).toBe(true);
    views.dispose();
  },
);

test.each([
  "circle-heartgrove",
  "circle-musterhall",
  "circle-construct-nursery",
])("%s parts its entrance once for each unit that leaves", async (id) => {
  const scene = testScene();
  const map = new TerrainMap({ width: 12, height: 12, tileSize: 1 });
  const definition = BASE_CONTENT.actors.find((actor) => actor.id === id)!;
  const graphics = BASE_CONTENT.presentation[id]!.building!;
  const model = await loadModelAsset(scene, {
    ...graphics.glb!,
    url: glbDataUrl(graphics.glb!.url),
  });
  const views = createTilePlacedActorViewRegistry(
    scene,
    map,
    [definition],
    new Map([
      [id, { ...graphics, createDetails: modelBuildingDetails(model) }],
    ]),
  );
  const actor = createTilePlacedActor(
    map,
    definition,
    { actorId: "door", origin: { x: 4, z: 4 } },
    "player",
  );
  views.update([actor]);
  const hinge = scene.transformNodes.find(
    (node) => node.name.includes("door") && node.name.includes("hinge-1"),
  )!;
  const glow = scene.meshes.find(
    (mesh) => mesh.name.includes("door") && mesh.name.endsWith("glow"),
  )!;
  const panel = hinge.getChildMeshes()[0]!;
  const forwardPosition = () => {
    panel.computeWorldMatrix(true);
    const { x, z } = panel.getAbsolutePosition();
    return x * Math.sin(actor.facing) + z * Math.cos(actor.facing);
  };
  const rest = hinge.rotationQuaternion!.clone();
  const restPosition = forwardPosition();
  // The rest pose leaves the entrance visibly open.
  expect(Math.abs(rest.toEulerAngles().y)).toBeGreaterThan(0.3);
  expect(glow.scaling.x).toBeLessThan(0.01);
  views.play("door", "exit");
  views.animate(0.6, 0.6);
  expect(hinge.rotationQuaternion!.equalsWithEpsilon(rest, 1e-3)).toBe(false);
  expect(forwardPosition()).toBeGreaterThan(restPosition);
  expect(glow.scaling.x).toBeGreaterThan(0.3);
  views.animate(1.5, 0.9);
  expect(hinge.rotationQuaternion!.equalsWithEpsilon(rest, 1e-3)).toBe(true);
  views.dispose();
});

test("the Thornspire crown follows committed aim and opens to fire", async () => {
  const scene = testScene();
  const map = new TerrainMap({ width: 12, height: 12, tileSize: 1 });
  const id = "circle-thornspire";
  const definition = BASE_CONTENT.actors.find((actor) => actor.id === id)!;
  const graphics = BASE_CONTENT.presentation[id]!.building!;
  const model = await loadModelAsset(scene, {
    ...graphics.glb!,
    url: glbDataUrl(graphics.glb!.url),
  });
  const views = createTilePlacedActorViewRegistry(
    scene,
    map,
    [definition],
    new Map([
      [id, { ...graphics, createDetails: modelBuildingDetails(model) }],
    ]),
  );
  const actor = createTilePlacedActor(
    map,
    definition,
    { actorId: "spire", origin: { x: 4, z: 4 } },
    "player",
  );
  const node = (suffix: string) =>
    scene.transformNodes.find(
      (each) => each.name.includes("spire") && each.name.endsWith(suffix),
    )!;
  views.update([actor]);
  const crown = node("circle-thornspire-crown");
  expect(crown).toBeDefined();
  const heading = () =>
    Vector3.TransformNormal(Vector3.Forward(), crown.computeWorldMatrix(true));
  const before = heading();
  views.update([
    { ...actor, combat: { aimFacing: actor.facing + Math.PI / 2 } },
  ]);
  const after = heading();
  expect(Vector3.Dot(before, after)).toBeCloseTo(0);
  const petal = node("circle-thornspire-petal-0");
  const rest = petal.rotationQuaternion!.clone();
  views.play("spire", "attack");
  views.animate(0.2, 0.2);
  expect(petal.rotationQuaternion!.equalsWithEpsilon(rest, 1e-3)).toBe(false);
  views.dispose();
});

test("the Sentry housing follows committed aim relative to its placement", () => {
  const scene = testScene();
  const map = new TerrainMap({ width: 12, height: 12, tileSize: 1 });
  const sentry = BASE_CONTENT.actors.find(
    ({ id }) => id === "arc-sentry-turret",
  )!;
  const views = createTilePlacedActorViewRegistry(
    scene,
    map,
    [sentry],
    new Map([
      [
        sentry.id,
        {
          height: 0.25,
          color: [0.3, 0.3, 0.3],
          createDetails: createSentryDetails,
        },
      ],
    ]),
  );
  const actor = createTilePlacedActor(
    map,
    sentry,
    { actorId: "sentry", origin: { x: 4, z: 4 }, quarterTurns: 1 },
    "player",
  );
  const turret = () =>
    scene.getTransformNodeByName("tile-placed-actor-sentry-root-turret")!;
  views.update([actor]);
  expect(turret().rotation.y).toBeCloseTo(0);
  views.update([
    { ...actor, combat: { aimFacing: actor.facing + Math.PI / 2 } },
  ]);
  expect(turret().rotation.y).toBeCloseTo(Math.PI / 2);
  views.dispose();
});

test.each(
  BASE_CONTENT.actors.filter(
    ({ id }) => !!BASE_CONTENT.presentation[id]?.building?.details,
  ),
)(
  "$id stand-ins share owner markings without recoloring their body",
  (definition) => {
    const scene = testScene();
    const map = new TerrainMap({ width: 12, height: 12, tileSize: 1 });
    const { details, ...appearance } =
      BASE_CONTENT.presentation[definition.id]!.building!;
    const colors = new Map<string, [number, number, number]>([
      ["west", [0.2, 0.45, 1]],
      ["east", [0.92, 0.18, 0.15]],
    ]);
    const ownerMaterials = createOwnerMaterials(colors);
    const views = createTilePlacedActorViewRegistry(
      scene,
      map,
      [definition],
      new Map([
        [
          definition.id,
          { ...appearance, createDetails: BUILTIN_BUILDING_DETAILS[details!] },
        ],
      ]),
      { ownerMaterials },
    );
    const actors = ["west", "west", "east"].map((owner, index) =>
      createTilePlacedActor(
        map,
        definition,
        { actorId: `building-${index}`, origin: { x: 2 + index * 3, z: 4 } },
        owner,
      ),
    );
    try {
      views.update(actors);
      const meshes = actors.map(({ id }) =>
        scene
          .getTransformNodeByName(`tile-placed-actor-${id}-root`)!
          .getChildMeshes(),
      );
      const markings = meshes.map((parts) =>
        parts.filter(({ material }) => isOwnerMaterial(material?.name ?? "")),
      );
      for (const [index, parts] of markings.entries()) {
        expect(parts.length).toBeGreaterThan(0);
        for (const part of parts)
          expect((part.material as StandardMaterial).diffuseColor).toEqual(
            new Color3(...colors.get(actors[index]!.owner)!),
          );
      }
      expect(markings[0]![0]!.material).toBe(markings[1]![0]!.material);
      expect(markings[0]![0]!.material).not.toBe(markings[2]![0]!.material);
      const bodies = meshes.map((parts) =>
        parts.filter(({ material }) => !isOwnerMaterial(material?.name ?? "")),
      );
      expect(bodies[0]!.length).toBeGreaterThan(0);
      for (const [index, part] of bodies[0]!.entries())
        expect(part.material).toBe(bodies[2]![index]!.material);
    } finally {
      views.dispose();
      ownerMaterials.dispose();
    }
  },
);
