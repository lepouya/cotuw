import { groundPoint, groundRing, groundCross } from "./ground-marker";
import {
  Color3,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  Vector3,
  VertexData,
} from "@babylonjs/core";
import { clampToBounds } from "../simulation/world";
import type { Scene } from "@babylonjs/core";
import type { TerrainMap } from "../map";
import type { SupportView } from "../simulation/support";
import type { WorldPosition } from "../simulation/world";

const SEGMENTS = 96;
const BANDS = 12;
const DASH_LENGTH = 0.35;

/** Splits a polyline into dashes of equal world length. */
function dashes(points: readonly Vector3[]): Vector3[][] {
  const result: Vector3[][] = [];
  let travelled = 0;
  for (let i = 1; i < points.length; i++) {
    const start = points[i - 1]!;
    const end = points[i]!;
    const length = Vector3.Distance(start, end);
    let offset = 0;
    while (offset < length) {
      const band = Math.floor((travelled + offset) / DASH_LENGTH + 1e-6);
      const next = Math.min(length, (band + 1) * DASH_LENGTH - travelled);
      if (band % 2 === 0)
        result.push([
          Vector3.Lerp(start, end, offset / length),
          Vector3.Lerp(start, end, next / length),
        ]);
      offset = next;
    }
    travelled += length;
  }
  return result;
}

/** Network geometry is rebuilt only when topology, terrain, or visibility changes. */
export function createSupportNetworkView(scene: Scene, map: TerrainMap) {
  let key = "";
  let meshes: Mesh[] = [];
  const activeColor = new Color3(0.22, 0.82, 0.95);
  const offlineColor = new Color3(1, 0.65, 0.16);
  const area = new StandardMaterial("support-coverage", scene);
  area.diffuseColor = activeColor;
  area.emissiveColor = activeColor;
  area.alpha = 0.07;
  area.backFaceCulling = false;
  area.disableLighting = true;
  const observer = map.onChangedObservable.add(() => {
    key = "";
  });
  // Coverage geometry stops at the map edge.
  const ground = (point: Readonly<WorldPosition>, offset = 0.12) =>
    groundPoint(map, clampToBounds(point, map.worldBounds), offset);
  const line = (
    name: string,
    points: Vector3[],
    active: boolean,
    dashed = !active,
  ) => {
    const mesh = dashed
      ? MeshBuilder.CreateLineSystem(name, { lines: dashes(points) }, scene)
      : MeshBuilder.CreateLines(name, { points }, scene);
    mesh.color = active ? activeColor : offlineColor;
    mesh.isPickable = false;
    meshes.push(mesh);
  };
  const connect = (
    a: Readonly<WorldPosition>,
    b: Readonly<WorldPosition>,
    active: boolean,
  ) => {
    const steps = Math.max(1, Math.ceil(Math.hypot(a.x - b.x, a.z - b.z) * 2));
    line(
      "support-connection",
      Array.from({ length: steps + 1 }, (_, i) =>
        ground({
          x: a.x + ((b.x - a.x) * i) / steps,
          z: a.z + ((b.z - a.z) * i) / steps,
        }),
      ),
      active,
    );
  };
  return {
    update: (network: SupportView | undefined, visible: boolean) => {
      const next = visible && network ? JSON.stringify(network) : "hidden";
      if (next === key) return;
      key = next;
      for (const mesh of meshes) mesh.dispose();
      meshes = [];
      if (!visible || !network) return;
      const nodes = new Map(network.nodes.map((node) => [node.actorId, node]));
      for (const node of network.nodes) {
        if (!node.complete) continue;
        const circle = groundRing(node.center, node.radius, SEGMENTS, ground);
        line("support-radius", circle, node.connected);
        if (!node.connected) continue;
        const positions: number[] = [],
          indices: number[] = [];
        const columns = SEGMENTS + 1;
        // Radial bands follow hills instead of cutting a flat disc through them.
        for (let band = 0; band <= BANDS; band++)
          groundRing(
            node.center,
            (node.radius * band) / BANDS,
            SEGMENTS,
            (point) => ground(point, 0.08),
          ).forEach((point, i) => {
            positions.push(point.x, point.y, point.z);
            if (!band || !i) return;
            const index = band * columns + i;
            indices.push(
              index,
              index - 1,
              index - columns,
              index - 1,
              index - columns - 1,
              index - columns,
            );
          });
        const mesh = new Mesh("support-area", scene);
        const data = new VertexData();
        data.positions = positions;
        data.indices = indices;
        data.normals = [];
        VertexData.ComputeNormals(positions, indices, data.normals);
        data.applyToMesh(mesh);
        mesh.material = area;
        mesh.isPickable = false;
        meshes.push(mesh);
      }
      for (const edge of network.links)
        connect(
          nodes.get(edge.from)!.center,
          nodes.get(edge.to)!.center,
          edge.active,
        );
      for (const node of network.nodes.filter((node) => !node.connected)) {
        const clearance = (other: SupportView["nodes"][number]) =>
          Math.hypot(
            other.center.x - node.center.x,
            other.center.z - node.center.z,
          ) - other.radius;
        const nearest = network.nodes
          .filter((other) => other.complete && other.connected)
          .sort((a, b) => clearance(a) - clearance(b))[0];
        if (!nearest) continue;
        connect(node.center, nearest.center, false);
        const distance = Math.hypot(
          nearest.center.x - node.center.x,
          nearest.center.z - node.center.z,
        );
        const gapDistance = clearance(nearest);
        // Keep the marker outside every live area, including unequal radii.
        const travel =
          node.complete && gapDistance > node.radius
            ? (gapDistance + node.radius) / 2
            : gapDistance / 2;
        const gap = {
          x:
            node.center.x +
            ((nearest.center.x - node.center.x) * travel) / distance,
          z:
            node.center.z +
            ((nearest.center.z - node.center.z) * travel) / distance,
        };
        for (const points of groundCross(gap, 0.3, ground))
          line("support-gap", points, false, false);
      }
    },
    dispose: () => {
      for (const mesh of meshes) mesh.dispose();
      area.dispose();
      map.onChangedObservable.remove(observer);
    },
  };
}
