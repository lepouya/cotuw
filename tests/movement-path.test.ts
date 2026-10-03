import { NullEngine, Scene, VertexBuffer } from "@babylonjs/core";
import { describe, expect, test } from "vitest";

import { TerrainMap } from "../src/map";
import { createMovementPathView } from "../src/render/movement-path";

import type { ActorRenderState } from "../src/simulation/actor";

function movingActor({
  x = -2,
  blocked = false,
  destination = { x: 2, z: 0 },
  reachedTarget = true,
  target = destination,
}: {
  x?: number;
  blocked?: boolean;
  destination?: { x: number; z: number };
  reachedTarget?: boolean;
  target?: { x: number; z: number };
} = {}): ActorRenderState {
  return {
    id: "trooper",
    definitionId: "trooper",
    worldPosition: { x, z: 0 },
    facing: 0,
    occupancyLayer: "surface",
    movement: {
      target,
      destination,
      reachedTarget,
      blocked,
      waypoints: [{ x: 0, z: 0 }, destination],
      waypointIndex: 0,
      navigationVersion: 1,
    },
  };
}

function setup() {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const map = new TerrainMap({
    width: 10,
    height: 10,
    tileSize: 1,
    createHeight: (x) => (x === 5 ? 2 : 0),
  });
  const view = createMovementPathView(scene, map);
  view.setSelectedActors(["trooper"]);
  return { engine, map, scene, view };
}

describe("movement path view", () => {
  test("draws a dotted route and reachable destination on the ground", () => {
    const { engine, map, scene, view } = setup();

    view.update([movingActor()]);

    const route = scene.getMeshByName("movement-path-route")!;
    const destination = scene.getMeshByName("movement-path-destination")!;
    expect(
      route.getVerticesData(VertexBuffer.PositionKind)!.length,
    ).toBeGreaterThan(6);
    expect(route.isPickable).toBe(false);
    expect(destination.isPickable).toBe(false);
    expect(scene.getMeshByName("movement-path-unreachable")).toBeNull();
    const positions = route.getVerticesData(VertexBuffer.PositionKind)!;
    for (let index = 0; index < positions.length; index += 3) {
      expect(positions[index + 1]).toBeCloseTo(
        map.heightAtWorldPosition(positions[index]!, positions[index + 2]!) +
          0.035,
        5,
      );
    }
    expect(
      destination.getBoundingInfo().boundingBox.minimumWorld.y,
    ).toBeGreaterThan(0);

    view.dispose();
    engine.dispose();
  });

  test("marks the requested target when the route ends somewhere else", () => {
    const { engine, scene, view } = setup();

    view.update([
      movingActor({
        destination: { x: 1, z: 0 },
        reachedTarget: false,
        target: { x: 3, z: 0 },
      }),
    ]);

    expect(scene.getMeshByName("movement-path-destination")).not.toBeNull();
    expect(scene.getMeshByName("movement-path-unreachable")).not.toBeNull();
    expect(
      scene.getMeshByName("movement-path-unreachable-cross"),
    ).not.toBeNull();

    view.dispose();
    engine.dispose();
  });

  test("hides passed dashes without rebuilding or moving the rest", () => {
    const { engine, scene, view } = setup();
    view.update([movingActor()]);
    const route = scene.getMeshByName("movement-path-route")!;
    const before = route.getVerticesData(VertexBuffer.PositionKind)!.slice();

    view.update([movingActor({ x: -1 })]);

    expect(scene.getMeshByName("movement-path-route")).toBe(route);
    const after = route.getVerticesData(VertexBuffer.PositionKind)!;
    expect(after).toHaveLength(before.length);
    expect(after).not.toEqual(before);
    // The dash at the destination keeps its ground position.
    expect(Array.from(after.slice(0, 6))).toEqual(
      Array.from(before.slice(0, 6)),
    );

    view.dispose();
    engine.dispose();
  });

  test("rebuilds route geometry after terrain elevation changes", () => {
    const { engine, map, scene, view } = setup();
    const actor = movingActor();
    view.update([actor]);
    const original = scene.getMeshByName("movement-path-route")!;

    for (let z = 0; z <= map.height; z += 1) {
      for (let x = 0; x <= map.width; x += 1) {
        map.setHeight(x, z, 5);
      }
    }
    map.notifyChange(
      { minX: 0, minZ: 0, maxX: map.width - 1, maxZ: map.height - 1 },
      { affectsNavigation: false },
    );
    view.update([actor]);

    const rebuilt = scene.getMeshByName("movement-path-route")!;
    expect(rebuilt).not.toBe(original);
    expect(rebuilt.getVerticesData(VertexBuffer.PositionKind)![1]).toBeCloseTo(
      5.035,
    );

    view.dispose();
    engine.dispose();
  });

  test("keeps rejected-command feedback visible without an active order", () => {
    const { engine, scene, view } = setup();

    view.showRejectedTarget("trooper", { x: 3, z: 0 });
    view.update([{ ...movingActor(), movement: undefined }]);

    expect(scene.getMeshByName("movement-path-unreachable")).not.toBeNull();
    expect(
      scene.getMeshByName("movement-path-unreachable-cross"),
    ).not.toBeNull();

    view.dispose();
    engine.dispose();
  });

  test("keeps rejected-command feedback beside an active order", () => {
    const { engine, scene, view } = setup();
    view.update([movingActor()]);

    view.showRejectedTarget("trooper", { x: 3, z: 3 });
    view.update([movingActor({ x: -1.5 })]);

    expect(scene.getMeshByName("movement-path-route")).not.toBeNull();
    expect(scene.getMeshByName("movement-path-unreachable")).not.toBeNull();

    view.dispose();
    engine.dispose();
  });

  test("shows a persistent blocked marker when an active route is lost", () => {
    const { engine, scene, view } = setup();

    view.update([movingActor({ blocked: true })]);
    view.update([movingActor({ blocked: true })]);

    expect(scene.getMeshByName("movement-path-route")).toBeNull();
    expect(scene.getMeshByName("movement-path-unreachable")).not.toBeNull();

    view.dispose();
    engine.dispose();
  });

  test("tracks multiple selected routes and preserves survivors when selection shrinks", () => {
    const { engine, scene, view } = setup();
    const actors = [
      movingActor(),
      { ...movingActor({ destination: { x: 3, z: 1 } }), id: "scout" },
    ];
    view.setSelectedActors(["trooper", "scout"]);
    view.update(actors);
    expect(
      scene.meshes.filter((mesh) => mesh.name === "movement-path-route"),
    ).toHaveLength(2);
    const survivor = scene.getMeshByName("movement-path-route")!;
    view.showRejectedTarget("scout", { x: 3, z: 3 });
    view.setSelectedActors(["trooper"]);
    view.update(actors);
    expect(
      scene.meshes.filter((mesh) => mesh.name === "movement-path-route"),
    ).toEqual([survivor]);
    expect(scene.getMeshByName("movement-path-unreachable")).toBeNull();
    view.dispose();
    engine.dispose();
  });

  test("a resolved group slot still marks its unreachable group click", () => {
    const { engine, scene, view } = setup();
    const actor = movingActor();
    view.update([
      {
        ...actor,
        movement: { ...actor.movement!, requestedTarget: { x: 3, z: 3 } },
      },
    ]);
    expect(scene.getMeshByName("movement-path-destination")).not.toBeNull();
    expect(
      scene.getMeshByName("movement-path-unreachable-cross"),
    ).not.toBeNull();
    view.dispose();
    engine.dispose();
  });

  test("selected actors sharing a blocked group click share one marker", () => {
    const { engine, scene, view } = setup();
    const actor = movingActor();
    const requested = {
      ...actor,
      movement: { ...actor.movement!, requestedTarget: { x: 3, z: 3 } },
    };
    view.setSelectedActors(["trooper", "scout"]);
    view.showRejectedTarget("scout", { x: 3, z: 3 });
    view.update([requested, { ...requested, id: "scout" }]);
    expect(
      scene.meshes.filter(({ name }) => name === "movement-path-unreachable"),
    ).toHaveLength(1);
    const marker = scene.getMeshByName("movement-path-unreachable")!;
    view.setSelectedActors(["trooper"]);
    expect(scene.getMeshByName("movement-path-unreachable")).toBe(marker);
    view.setSelectedActors([]);
    expect(scene.getMeshByName("movement-path-unreachable")).toBeNull();
    expect(scene.getMeshByName("movement-path-unreachable-cross")).toBeNull();
    view.dispose();
    engine.dispose();
  });

  test("changing a blocked group click preserves the resolved route geometry", () => {
    const { engine, scene, view } = setup();
    const actor = movingActor();
    view.update([
      {
        ...actor,
        movement: { ...actor.movement!, requestedTarget: { x: 3, z: 3 } },
      },
    ]);
    const route = scene.getMeshByName("movement-path-route")!;
    const marker = scene.getMeshByName("movement-path-unreachable")!;
    view.update([
      {
        ...actor,
        movement: { ...actor.movement!, requestedTarget: { x: 4, z: 3 } },
      },
    ]);
    expect(scene.getMeshByName("movement-path-route")).toBe(route);
    expect(marker.isDisposed()).toBe(true);
    expect(scene.getMeshByName("movement-path-unreachable")).not.toBeNull();
    view.dispose();
    engine.dispose();
  });

  test("clears the tracker when selection or movement ends", () => {
    const { engine, scene, view } = setup();
    view.update([movingActor()]);

    view.setSelectedActors([]);

    expect(scene.getMeshByName("movement-path-route")).toBeNull();
    expect(scene.getMeshByName("movement-path-destination")).toBeNull();

    view.setSelectedActors(["trooper"]);
    view.update([{ ...movingActor(), movement: undefined }]);
    expect(scene.getMeshByName("movement-path-route")).toBeNull();

    view.dispose();
    engine.dispose();
  });
});

test("an aggressive order keeps its diamond destination during an engagement", () => {
  const { engine, scene, view } = setup();
  const actor = { ...movingActor(), attackMove: { target: { x: 2, z: 0 } } };
  view.update([actor]);
  expect(scene.getMeshByName("attack-move-destination")).not.toBeNull();
  expect(scene.getMeshByName("movement-path-destination")).toBeNull();
  view.update([
    {
      ...actor,
      movement: undefined,
      combat: { attack: { targetId: "wolf", lastKnown: { x: 0, z: 0 } } },
    },
  ]);
  expect(scene.getMeshByName("attack-move-destination")).not.toBeNull();
  expect(scene.getMeshByName("movement-path-route")).toBeNull();
  view.update([{ ...movingActor(), movement: undefined }]);
  expect(scene.getMeshByName("attack-move-destination")).toBeNull();
  view.dispose();
  engine.dispose();
});

test("a blocked Attack Move marker clears as soon as the order resumes or stops", () => {
  const { engine, scene, view } = setup();
  const actor: ActorRenderState = {
    ...movingActor(),
    movement: undefined,
    attackMove: {
      target: { x: 2, z: 0 },
      blocked: { at: { x: 2, z: 0 }, navigationVersion: 1 },
    },
  };
  view.update([actor]);
  expect(scene.getMeshByName("movement-path-unreachable")).not.toBeNull();
  view.update([{ ...movingActor(), attackMove: { target: { x: 2, z: 0 } } }]);
  expect(scene.getMeshByName("movement-path-unreachable")).toBeNull();
  view.update([actor]);
  expect(scene.getMeshByName("movement-path-unreachable")).not.toBeNull();
  view.update([{ ...actor, attackMove: undefined }]);
  expect(scene.getMeshByName("movement-path-unreachable")).toBeNull();
  view.dispose();
  engine.dispose();
});
