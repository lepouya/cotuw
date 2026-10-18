import { NullEngine, Scene, VertexBuffer } from "@babylonjs/core";
import { expect, test } from "vitest";
import { TerrainMap } from "../src/map";
import { createRallyPointView } from "../src/render/rally-point";
import { createSupportNetworkView } from "../src/render/support-network";
import { supportsPosition } from "../src/simulation/support";
import type { SupportNetwork } from "../src/simulation/support";

test("rally rings follow sloping terrain and reuse unchanged geometry", () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const map = new TerrainMap({
    width: 20,
    height: 20,
    tileSize: 1,
    createHeight: (x) => x * 0.5,
  });
  const view = createRallyPointView(scene, map);
  view.update({ x: 0, z: 0 });
  const mesh = scene.getMeshByName("rally-point")!;
  const positions = mesh.getVerticesData(VertexBuffer.PositionKind)!;
  // The flag has four vertices; every remaining vertex belongs to the ring.
  for (let i = 12; i < positions.length; i += 3)
    expect(positions[i + 1]).toBeCloseTo(
      map.heightAtWorldPosition(positions[i]!, positions[i + 2]!) + 0.15,
      5,
    );
  view.update({ x: 0, z: 0 });
  expect(scene.getMeshByName("rally-point")).toBe(mesh);
  view.dispose();
  expect(scene.getMeshByName("rally-point")).toBeNull();
  engine.dispose();
});

for (const distance of [20, 15]) {
  test(`gap markers stay outside live coverage with unequal radii at distance ${distance}`, () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const map = new TerrainMap({ width: 100, height: 40, tileSize: 1 });
    const network: SupportNetwork = {
      nodes: [
        {
          actorId: "root",
          center: { x: 0, z: 0 },
          radius: 12,
          complete: true,
          root: true,
          connected: true,
        },
        {
          actorId: "remote",
          center: { x: distance, z: 0 },
          radius: 6,
          complete: true,
          root: false,
          connected: false,
        },
      ],
      links: [],
    };
    const view = createSupportNetworkView(scene, map);
    view.update(network, true);
    const meshes = scene.meshes.filter((mesh) => mesh.name === "support-gap");
    expect(meshes).toHaveLength(2);
    for (const mesh of meshes) {
      const points = mesh.getVerticesData(VertexBuffer.PositionKind)!;
      const center = {
        x: (points[0]! + points[3]!) / 2,
        z: (points[2]! + points[5]!) / 2,
      };
      expect(supportsPosition(network, center, undefined)).toBe(false);
      if (distance === 20) expect(center.x).toBeGreaterThan(12);
    }
    view.update(network, true);
    expect(scene.meshes.filter((mesh) => mesh.name === "support-gap")).toEqual(
      meshes,
    );
    view.dispose();
    engine.dispose();
  });
}
