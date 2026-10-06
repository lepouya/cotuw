import { Color3, MeshBuilder, TransformNode } from "@babylonjs/core";

import type { Mesh, StandardMaterial } from "@babylonjs/core";
import type { TilePlacedActorDetailsFactory } from "./tile-placed-actor-view";

type Triple = readonly [number, number, number];
type DetailsArguments = Parameters<TilePlacedActorDetailsFactory>;

/** Eases from 0 to 1 as `value` crosses from `start` to `end`. */
export function ease(value: number, start: number, end: number): number {
  const t = Math.min(1, Math.max(0, (value - start) / (end - start)));
  return t * t * (3 - 2 * t);
}

/** Opens over `opening` seconds, holds, and closes by `seconds`. */
export function openAndClose(
  value: number,
  seconds: number,
  opening: number,
): number {
  return ease(value, 0, opening) - ease(value, seconds - opening, seconds);
}

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
  /** Names a part and seats it under `parent`, the assembly by default. */
  const place = <T extends TransformNode>(
    node: T,
    [x, y, z]: Triple,
    parent: TransformNode,
  ) => {
    node.parent = parent;
    node.position.set(x, y, z);
    return node;
  };
  const surfaced = (mesh: Mesh, surface: StandardMaterial) => {
    mesh.material = surface;
    return mesh;
  };
  /** An empty node that moving parts turn or slide with. */
  const pivot = (name: string, position: Triple, parent = assembly) =>
    place(new TransformNode(`${root.name}-${name}`, scene), position, parent);
  const box = (
    name: string,
    [width, height, depth]: Triple,
    position: Triple,
    surface: StandardMaterial,
    parent = assembly,
  ) =>
    surfaced(
      place(
        MeshBuilder.CreateBox(
          `${root.name}-${name}`,
          { width, height, depth },
          scene,
        ),
        position,
        parent,
      ),
      surface,
    );
  const cylinder = (
    name: string,
    [diameter, height]: readonly [number, number],
    position: Triple,
    surface: StandardMaterial,
    parent = assembly,
  ) =>
    surfaced(
      place(
        MeshBuilder.CreateCylinder(
          `${root.name}-${name}`,
          { diameter, height, tessellation: 16 },
          scene,
        ),
        position,
        parent,
      ),
      surface,
    );
  /** Two crossed blades; spin the returned blade around y. */
  const fan = (
    length: number,
    thickness: number,
    position: Triple,
    surface: StandardMaterial,
  ) => {
    const blade = box("fan", [length, thickness, 0.08], position, surface);
    box("fan-cross", [0.08, thickness, length], [0, 0, 0], surface, blade);
    return blade;
  };
  return { assembly, material, pivot, box, cylinder, fan };
}
