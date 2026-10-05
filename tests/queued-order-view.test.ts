import { NullEngine, Scene, VertexBuffer } from "@babylonjs/core";
import { expect, test } from "vitest";
import { TerrainMap } from "../src/map";
import { createQueuedOrderView } from "../src/render/queued-orders";
import type { ActorRenderState } from "../src/simulation/actor";

test("queue previews reuse geometry, follow terrain edits, and release observers", () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const map = new TerrainMap({ width: 10, height: 10, tileSize: 1 });
  const view = createQueuedOrderView(scene, map, (order) =>
    "target" in order ? order.target : undefined,
  );
  const actors: ActorRenderState[] = [
    {
      id: "a",
      definitionId: "scout",
      occupancyLayer: "surface",
      facing: 0,
      worldPosition: { x: -2, z: 0 },
      orders: [
        { kind: "move", target: { x: 2, z: 0 } },
        { kind: "attack", targetId: "hidden" },
      ],
    },
  ];
  try {
    view.update(actors);
    const first = scene.getMeshByName("queued-orders")!;
    expect(first.isPickable).toBe(false);
    view.update(actors);
    expect(scene.getMeshByName("queued-orders")).toBe(first);
    for (let z = 0; z <= map.height; z++)
      for (let x = 0; x <= map.width; x++) map.setHeight(x, z, 2);
    view.update(actors);
    const next = scene.getMeshByName("queued-orders")!;
    expect(next).not.toBe(first);
    expect(first.isDisposed()).toBe(true);
    const positions = next.getVerticesData(VertexBuffer.PositionKind)!;
    expect(
      positions.filter((_, index) => index % 3 === 1).every((y) => y > 2),
    ).toBe(true);
    view.dispose();
    view.dispose();
    expect(map.onChangedObservable.hasObservers()).toBe(false);
    view.update(actors);
    expect(scene.getMeshByName("queued-orders")).toBeNull();
  } finally {
    scene.dispose();
    engine.dispose();
  }
});
