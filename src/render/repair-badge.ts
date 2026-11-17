import { Color3, MeshBuilder, TransformNode } from "@babylonjs/core";
import { createSymbolMesh, WRENCH_SYMBOL } from "./symbols";

import type { Mesh, Scene } from "@babylonjs/core";
import type { SharedMaterial } from "./tile-placed-actor-view";

/** A camera-facing wrench; paused work adds two bars as well as amber color. */
export function createRepairBadge(
  scene: Scene,
  name: string,
  shared: SharedMaterial,
) {
  const root = new TransformNode(name, scene);
  root.billboardMode = TransformNode.BILLBOARDMODE_ALL;
  // Local screen-up clearance also separates the badge in top-down views.
  const icon = new TransformNode(`${name}-icon`, scene);
  icon.parent = root;
  icon.position.y = 0.85;
  const material = (part: string, color: Color3) =>
    shared(`repair-${part}`, (value) => {
      value.emissiveColor = color;
      value.disableLighting = true;
      value.backFaceCulling = false;
    });
  const background = material("background", new Color3(0.04, 0.09, 0.1));
  const active = material("active", new Color3(0.45, 1, 0.75));
  const paused = material("paused", new Color3(1, 0.72, 0.2));
  const mount = (mesh: Mesh) => {
    mesh.parent = icon;
    mesh.isPickable = false;
    mesh.renderingGroupId = 1;
    return mesh;
  };
  const disc = mount(
    MeshBuilder.CreateDisc(`${name}-background`, { radius: 0.55 }, scene),
  );
  disc.material = background;
  const wrench = mount(
    createSymbolMesh(`${name}-wrench`, WRENCH_SYMBOL, 0.42, 0.13, scene),
  );
  wrench.position.z = -0.01;
  const bars = [-1, 1].map((side) => {
    const bar = mount(
      MeshBuilder.CreatePlane(
        `${name}-pause-${side}`,
        { width: 0.07, height: 0.23 },
        scene,
      ),
    );
    bar.position.set(0.28 + side * 0.065, -0.26, -0.01);
    bar.material = paused;
    return bar;
  });
  return {
    root,
    update: (working: boolean) => {
      wrench.material = working ? active : paused;
      for (const bar of bars) bar.setEnabled(!working);
    },
    dispose: () => root.dispose(),
  };
}
