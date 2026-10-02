import {
  Color3,
  MeshBuilder,
  StandardMaterial,
  TransformNode,
} from "@babylonjs/core";
import { createMeshAppearance } from "./actor";
import type { Scene } from "@babylonjs/core";

export function createHarvesterAppearance(scene: Scene) {
  const root = new TransformNode("harvester-template", scene);
  const steel = new StandardMaterial("harvester-steel", scene);
  steel.diffuseColor = new Color3(0.78, 0.58, 0.2);
  const rubber = new StandardMaterial("harvester-tracks", scene);
  rubber.diffuseColor = new Color3(0.12, 0.16, 0.17);
  const box = (
    name: string,
    width: number,
    height: number,
    depth: number,
    x: number,
    y: number,
    z: number,
    material: StandardMaterial,
  ) => {
    const mesh = MeshBuilder.CreateBox(name, { width, height, depth }, scene);
    mesh.parent = root;
    mesh.position.set(x, y, z);
    mesh.material = material;
  };
  box("harvester-chassis", 0.7, 0.35, 1.1, 0, 0.45, 0, steel);
  box("harvester-cab", 0.55, 0.4, 0.45, 0, 0.82, 0.25, steel);
  box("harvester-left-track", 0.2, 0.28, 1.25, -0.43, 0.25, 0, rubber);
  box("harvester-right-track", 0.2, 0.28, 1.25, 0.43, 0.25, 0, rubber);
  return createMeshAppearance(
    root,
    { radius: 0.6, height: 1.1 },
    [0.94, 0.7, 0.22],
  );
}
