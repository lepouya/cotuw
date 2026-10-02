import {
  Color3,
  MeshBuilder,
  StandardMaterial,
  TransformNode,
} from "@babylonjs/core";

import type { TilePlacedActorDetailsFactory } from "./tile-placed-actor-view";

/** Prototype ARC architecture with renderer-only mechanical idle motion. */
export const createCommandCenterDetails: TilePlacedActorDetailsFactory = (
  root,
  { center, roof, tileSize, facing },
  sharedMaterial,
) => {
  const scene = root.getScene();
  const assembly = new TransformNode(`${root.name}-assembly`, scene);
  assembly.parent = root;
  assembly.position.set(center.x, roof, center.z);
  assembly.rotation.y = facing;
  assembly.scaling.setAll(tileSize);
  const material = (name: string, color: number[], glow = false) =>
    sharedMaterial(name, (result) => {
      result.diffuseColor = Color3.FromArray(color);
      result.specularColor = new Color3(0.15, 0.2, 0.22);
      if (glow) result.emissiveColor = result.diffuseColor.scale(0.75);
    });
  const armor = material("armor", [0.22, 0.32, 0.34]);
  const trim = material("trim", [0.55, 0.64, 0.61]);
  const dark = material("equipment", [0.08, 0.13, 0.16]);
  const orange = material("markings", [0.94, 0.46, 0.12]);
  const glass = material("windows", [0.12, 0.78, 0.85], true);
  const box = (
    name: string,
    width: number,
    height: number,
    depth: number,
    x: number,
    y: number,
    z: number,
    surface: StandardMaterial,
  ) => {
    const mesh = MeshBuilder.CreateBox(
      `${root.name}-${name}`,
      { width, height, depth },
      scene,
    );
    mesh.parent = assembly;
    mesh.position.set(x, y, z);
    mesh.material = surface;
    return mesh;
  };
  box("lower-deck", 1.88, 0.12, 1.88, 0, 0.06, 0, trim);
  box("command-cabin", 1.38, 0.8, 1.2, 0, 0.52, -0.12, armor);
  box("roof", 1.5, 0.12, 1.32, 0, 0.98, -0.12, trim);
  box("front-windows", 1.18, 0.23, 0.025, 0, 0.67, 0.495, glass);
  box("left-windows", 0.025, 0.23, 0.8, -0.695, 0.67, -0.12, glass);
  box("right-windows", 0.025, 0.23, 0.8, 0.695, 0.67, -0.12, glass);
  box("door", 0.36, 0.45, 0.035, 0, 0.345, 0.51, dark);
  box("entry-canopy", 0.65, 0.09, 0.4, 0, 0.55, 0.68, orange);
  box("entry-step", 0.64, 0.08, 0.32, 0, 0.16, 0.76, dark);
  for (const x of [-0.83, 0.83]) {
    box(`buttress-${x}`, 0.18, 0.58, 1.45, x, 0.35, -0.12, armor);
    box(`stripe-${x}`, 0.19, 0.08, 0.55, x, 0.59, 0.25, orange);
  }
  box("roof-equipment", 0.52, 0.18, 0.65, 0.43, 1.12, -0.13, dark);
  const fan = box("fan", 0.45, 0.025, 0.08, 0.43, 1.23, -0.13, trim);
  const fanCross = box("fan-cross", 0.08, 0.025, 0.45, 0, 0, 0, trim);
  fanCross.parent = fan;
  box("mast", 0.065, 0.55, 0.065, -0.38, 1.31, -0.24, trim);
  const radar = new TransformNode(`${root.name}-radar`, scene);
  radar.parent = assembly;
  radar.position.set(-0.38, 1.56, -0.24);
  const panel = box("radar-panel", 0.52, 0.27, 0.065, 0, 0, 0, armor);
  panel.parent = radar;
  panel.rotation.x = -0.2;
  const panelFace = box("radar-face", 0.44, 0.19, 0.015, 0, 0, 0.04, glass);
  panelFace.parent = panel;
  return {
    update: (seconds) => {
      radar.rotation.y = seconds * 0.45;
      fan.rotation.y = seconds * 2.5;
    },
    dispose: () => assembly.dispose(),
  };
};
