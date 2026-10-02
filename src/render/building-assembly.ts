import { Color3, MeshBuilder, TransformNode } from "@babylonjs/core";

import type { StandardMaterial } from "@babylonjs/core";
import type { TilePlacedActorDetailsFactory } from "./tile-placed-actor-view";

type Triple = readonly [number, number, number];
type DetailsArguments = Parameters<TilePlacedActorDetailsFactory>;

/** Detail geometry uses tile-sized local coordinates and the placed facing. */
export function createBuildingAssembly(
  root: TransformNode,
  { center, roof, tileSize, facing }: DetailsArguments[1],
  sharedMaterial: DetailsArguments[2],
  specular: Triple,
) {
  const scene = root.getScene();
  const assembly = new TransformNode(`${root.name}-assembly`, scene);
  assembly.parent = root;
  assembly.position.set(center.x, roof, center.z);
  assembly.rotation.y = facing;
  assembly.scaling.setAll(tileSize);
  const material = (name: string, color: Triple, glow = false) =>
    sharedMaterial(name, (result) => {
      result.diffuseColor = Color3.FromArray(color);
      result.specularColor = Color3.FromArray(specular);
      if (glow) result.emissiveColor = result.diffuseColor.scale(0.75);
    });
  const box = (
    name: string,
    [width, height, depth]: Triple,
    [x, y, z]: Triple,
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
  /** Two crossed blades; spin the returned blade around y. */
  const fan = (
    length: number,
    thickness: number,
    position: Triple,
    surface: StandardMaterial,
  ) => {
    const blade = box("fan", [length, thickness, 0.08], position, surface);
    box("fan-cross", [0.08, thickness, length], [0, 0, 0], surface).parent =
      blade;
    return blade;
  };
  return { assembly, material, box, fan };
}
