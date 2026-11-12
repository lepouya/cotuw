import {
  Color3,
  MeshBuilder,
  StandardMaterial,
  TransformNode,
} from "@babylonjs/core";
import { describe, expect, test } from "vitest";

import { testScene } from "./helpers/scene";
import { glbDataUrl } from "./helpers/assets";
import { TerrainMap } from "../src/map";
import { createWreckView } from "../src/render/wrecks";
import { createMeshAppearance } from "../src/render/actor";
import { createOwnerMaterials } from "../src/render/owner-materials";
import { loadModelAsset, staticInstance } from "../src/render/glb-model";

import type { ActorAppearance } from "../src/render/actor";
import type { Wreck } from "../src/simulation/combat";

const updateWrecks = (
  views: ReturnType<typeof createWreckView>,
  list: Wreck[],
  age: number,
  frameSeconds: number,
) =>
  views.update(
    list,
    () => age,
    60,
    () => true,
    frameSeconds,
  );
const buildingWreck = (actorId: string): Wreck => ({
  actorId,
  definitionId: "building",
  owner: "player",
  tick: 0,
  worldPosition: { x: -0.5, z: -0.5 },
  facing: 0,
  tilePlacement: { origin: { x: 0, z: 0 }, quarterTurns: 0 },
});

describe("remains", () => {
  function setup() {
    const scene = testScene();
    const map = new TerrainMap({ width: 10, height: 10, tileSize: 1 });
    const deaths: number[] = [];
    const tilted: string[] = [];
    const appearance = (die: boolean): ActorAppearance => ({
      bounds: { radius: 0.5, height: 1 },
      instantiate: (name) => ({
        root: new TransformNode(name, scene),
        die: die ? (seconds) => deaths.push(seconds) : undefined,
        freeze: () => tilted.push(name),
        dispose: () => {},
      }),
      dispose: () => {},
    });
    const appearances = new Map([
      ["trooper", appearance(true)],
      ["wolf", appearance(false)],
    ]);
    const wrecks = createWreckView(scene, map, {
      appearanceFor: (id) => appearances.get(id),
      tilesFor: () => [],
    });
    const wreck = (actorId: string, definitionId: string): Wreck => ({
      actorId,
      definitionId,
      owner: "player",
      worldPosition: { x: 0, z: 0 },
      facing: 0,
      tick: 0,
    });
    const update = (list: Wreck[], age: number, frameSeconds: number) =>
      updateWrecks(wrecks, list, age, frameSeconds);
    return { deaths, tilted, update, wreck, appearances, appearance };
  }

  test("play the death clip from destruction in real time", () => {
    const { deaths, update, wreck } = setup();
    const fallen = [wreck("a", "trooper")];

    update(fallen, 0.05, 0.016);
    update(fallen, 0.05, 0.05);
    update(fallen, 0.05, 1);

    expect(deaths).toEqual([0.05, 0.1, 1.1]);
  });

  test("start loaded remains at their age", () => {
    const { deaths, update, wreck } = setup();

    update([wreck("a", "trooper")], 30, 0.016);

    expect(deaths).toEqual([30]);
  });

  test("refresh loaded appearances without restarting a death clip", () => {
    const { deaths, update, wreck, appearances, appearance } = setup();
    const fallen = [wreck("a", "trooper")];
    update(fallen, 0, 0);
    update(fallen, 0, 0.5);
    appearances.set("trooper", appearance(true));
    update(fallen, 0, 0);
    expect(deaths).toEqual([0, 0.5, 0.5]);
  });

  test("lay models without a death clip on their side", () => {
    const { deaths, tilted, update, wreck } = setup();

    update([wreck("w", "wolf")], 0, 0.016);

    expect(deaths).toEqual([]);
    expect(tilted).toEqual(["wreck-w"]);
  });

  test.each([false, true])(
    "seats rubble on the ground and follows terrain edits (generated: %s)",
    async (generated) => {
      const scene = testScene();
      const map = new TerrainMap({
        width: 2,
        height: 2,
        tileSize: 1,
        createHeight: () => 3,
      });
      const asset = generated
        ? await loadModelAsset(scene, {
            url: glbDataUrl("/assets/models/rubble.glb"),
          })
        : undefined;
      const views = createWreckView(scene, map, {
        appearanceFor: () => undefined,
        tilesFor: () => [{ x: 0, z: 0 }],
        rubble: () => asset,
      });
      const wreck = buildingWreck("building");
      const update = () => updateWrecks(views, [wreck], 0, 0);
      const bottom = () =>
        scene
          .getTransformNodeByName("wreck-building")!
          .getHierarchyBoundingVectors(true).min.y;
      update();
      const previous = scene.getTransformNodeByName("wreck-building");
      expect(bottom()).toBeCloseTo(3);
      for (let z = 0; z <= 2; z++)
        for (let x = 0; x <= 2; x++) map.setHeight(x, z, 7);
      map.notifyChange({ minX: 0, minZ: 0, maxX: 1, maxZ: 1 });
      update();
      expect(bottom()).toBeCloseTo(7);
      expect(scene.getTransformNodeByName("wreck-building") === previous).toBe(
        true,
      );
      views.dispose();
      expect(map.onChangedObservable.hasObservers()).toBe(false);
      asset?.dispose();
    },
  );

  test("reseats fallen units after terrain edits without restarting their death", () => {
    const scene = testScene();
    const map = new TerrainMap({ width: 2, height: 2, tileSize: 1 });
    const deaths: number[] = [];
    const appearance: ActorAppearance = {
      bounds: { radius: 0.5, height: 1 },
      instantiate: (name) => ({
        root: MeshBuilder.CreateBox(name, {}, scene),
        die: (age) => deaths.push(age),
        dispose: () => {},
      }),
      dispose: () => {},
    };
    const views = createWreckView(scene, map, {
      appearanceFor: () => appearance,
      tilesFor: () => [],
    });
    const wreck: Wreck = {
      actorId: "unit",
      definitionId: "unit",
      owner: "player",
      tick: 0,
      worldPosition: { x: 0, z: 0 },
      facing: 0,
    };
    const update = (seconds: number) =>
      updateWrecks(views, [wreck], 0, seconds);
    update(0);
    update(0.4);
    for (let z = 0; z <= 2; z++)
      for (let x = 0; x <= 2; x++) map.setHeight(x, z, 3);
    map.notifyChange({ minX: 0, minZ: 0, maxX: 1, maxZ: 1 });
    update(0);
    expect(scene.getTransformNodeByName("wreck-unit")!.position.y).toBe(3);
    expect(deaths).toEqual([0, 0.4, 0.4]);
    views.dispose();
  });
});

test("building debris collapses onto its footprint unless motion is reduced", () => {
  const scene = testScene();
  const map = new TerrainMap({
    width: 2,
    height: 2,
    tileSize: 1,
    createHeight: () => 2,
  });
  let reduced = false;
  const views = createWreckView(scene, map, {
    appearanceFor: () => undefined,
    tilesFor: () => [{ x: 0, z: 0 }],
    reducedMotion: () => reduced,
    topHeightFor: () => 5,
  });
  const wreck = buildingWreck("building");
  const extent = () =>
    scene
      .getTransformNodeByName("wreck-building")!
      .getHierarchyBoundingVectors(true);
  const update = (age: number, frameSeconds: number) =>
    updateWrecks(views, [wreck], age, frameSeconds);
  update(0, 0);
  const standing = extent().max.y;
  expect(standing).toBeCloseTo(5);
  expect(extent().min.y).toBeCloseTo(2);
  update(0.4, 0.4);
  expect(extent().max.y).toBeLessThan(standing);
  update(1, 0.6);
  const settled = extent().max.y;
  expect(extent().min.y).toBeCloseTo(2);
  update(5, 4);
  expect(extent().max.y).toBeCloseTo(settled);

  updateWrecks(views, [], 0, 0);
  reduced = true;
  update(0, 0);
  expect(extent().max.y).toBeCloseTo(settled);
  reduced = false;
  update(0.1, 0.1);
  expect(extent().max.y).toBeCloseTo(settled);
  views.dispose();
});

test("flat replacement rubble cannot produce non-finite collapse transforms", () => {
  const scene = testScene();
  const map = new TerrainMap({ width: 2, height: 2, tileSize: 1 });
  const rubble = {
    instantiate: (name: string) =>
      staticInstance(MeshBuilder.CreateGround(name, {}, scene)),
    dispose: () => {},
  };
  const views = createWreckView(scene, map, {
    appearanceFor: () => undefined,
    tilesFor: () => [{ x: 0, z: 0 }],
    rubble: () => rubble,
    topHeightFor: () => 5,
  });
  updateWrecks(views, [buildingWreck("flat")], 0, 0);
  const chunk = scene.getMeshByName("wreck-flat-0-0")!;
  expect(chunk.scaling.asArray().every(Number.isFinite)).toBe(true);
  expect(chunk.position.asArray().every(Number.isFinite)).toBe(true);
  views.dispose();
});

test("fallen units keep their owner's colors", () => {
  const scene = testScene();
  const map = new TerrainMap({ width: 10, height: 10, tileSize: 1 });
  const template = MeshBuilder.CreateBox("template", {}, scene);
  template.material = new StandardMaterial("trooper-owner", scene);
  const appearance = createMeshAppearance(template, {
    radius: 0.5,
    height: 1,
  });
  const ownerMaterials = createOwnerMaterials(new Map([["east", [1, 0, 0]]]));
  const views = createWreckView(scene, map, {
    appearanceFor: () => appearance,
    tilesFor: () => [],
    ownerMaterials,
  });
  updateWrecks(
    views,
    [
      {
        actorId: "fallen",
        definitionId: "trooper",
        owner: "east",
        tick: 0,
        worldPosition: { x: 0, z: 0 },
        facing: 0,
      },
    ],
    0,
    0,
  );
  const [marking] = scene
    .getTransformNodeByName("wreck-fallen")!
    .getChildMeshes();
  expect((marking!.material as StandardMaterial).diffuseColor).toEqual(
    new Color3(1, 0, 0),
  );
  views.dispose();
  ownerMaterials.dispose();
  appearance.dispose();
});
