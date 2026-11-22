import { Color3, MeshBuilder, TransformNode } from "@babylonjs/core";
import { createSymbolMesh, CROSS_SYMBOL } from "./symbols";
import { createBarMaterial } from "./screen-bar";
import { createViewRegistry } from "./view-registry";

import type { Mesh, Scene, StandardMaterial } from "@babylonjs/core";
import type { TerrainMap } from "../map";
import type { WorldPosition } from "../simulation/world";
import type { Symbol2d } from "./symbols";

/** Why a worker keeps its assignment without working. */
export type WorkerBadgeKind = "waiting" | "undeliverable" | "blocked";

export type WorkerBadge = {
  id: string;
  kind: WorkerBadgeKind;
  worldPosition: Readonly<WorldPosition>;
  /** Height of the badge's center above the ground. */
  height: number;
};

const HOURGLASS_SYMBOL: Symbol2d = [
  [
    [-0.55, 0.75],
    [0.55, 0.75],
    [-0.55, -0.75],
    [0.55, -0.75],
    [-0.55, 0.75],
  ],
];
const EXCLAMATION_SYMBOL: Symbol2d = [
  [
    [0, 0.8],
    [0, -0.25],
  ],
  [
    [0, -0.55],
    [0, -0.8],
  ],
];
const X_SYMBOL: Symbol2d = CROSS_SYMBOL.map((line) =>
  line.map(([x, y]) => [x - y, x + y] as const),
);

// Shape as well as color tells the states apart.
const STYLES: Record<WorkerBadgeKind, { symbol: Symbol2d; color: Color3 }> = {
  waiting: { symbol: HOURGLASS_SYMBOL, color: new Color3(0.78, 0.6, 1) },
  undeliverable: { symbol: EXCLAMATION_SYMBOL, color: new Color3(1, 0.4, 0.3) },
  blocked: { symbol: X_SYMBOL, color: new Color3(1, 0.72, 0.2) },
};

/** Camera-facing status badges above workers; static under reduced motion. */
export function createWorkerBadgeView(scene: Scene, map: TerrainMap) {
  const materials = new Map<string, StandardMaterial>();
  const material = (name: string, color: Color3) => {
    let value = materials.get(name);
    if (!value) {
      value = createBarMaterial(scene, `worker-badge-${name}`, color);
      value.backFaceCulling = false;
      materials.set(name, value);
    }
    return value;
  };
  const badges = createViewRegistry({
    keyFor: (entry: WorkerBadge) => entry.kind,
    create: ({ id }, kind) => {
      const name = `worker-badge-${kind}-${id}`;
      const root = new TransformNode(name, scene);
      root.billboardMode = TransformNode.BILLBOARDMODE_ALL;
      const symbolRoot = new TransformNode(`${name}-symbol`, scene);
      symbolRoot.parent = root;
      // Screen-up clearance keeps the badge above health bars at steep angles.
      symbolRoot.position.y = 0.4;
      const mount = (mesh: Mesh) => {
        mesh.parent = symbolRoot;
        mesh.isPickable = false;
        mesh.renderingGroupId = 1;
        return mesh;
      };
      const disc = mount(
        MeshBuilder.CreateDisc(`${name}-background`, { radius: 0.3 }, scene),
      );
      disc.material = material("background", new Color3(0.04, 0.09, 0.1));
      const { symbol, color } = STYLES[kind];
      const icon = mount(
        createSymbolMesh(`${name}-icon`, symbol, 0.2, 0.07, scene),
      );
      icon.position.z = -0.01;
      icon.material = material(kind, color);
      return { root, dispose: () => root.dispose() };
    },
  });
  return {
    update: (entries: readonly WorkerBadge[]) => {
      badges.sync(entries);
      for (const {
        id,
        worldPosition: { x, z },
        height,
      } of entries)
        badges
          .get(id)!
          .root.position.set(x, map.heightAtWorldPosition(x, z) + height, z);
    },
    dispose: () => {
      badges.dispose();
      for (const value of materials.values()) value.dispose();
      materials.clear();
    },
  };
}
