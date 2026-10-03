import {
  Color3,
  MeshBuilder,
  StandardMaterial,
  TransformNode,
} from "@babylonjs/core";

import type { Material, Mesh, Scene } from "@babylonjs/core";

const BAR_HEIGHT = 0.12;
const BORDER = 0.03;
const DIVIDER_WIDTH = 0.025;
/** Draws over terrain, fog, and models so bars stay readable. */
const RENDERING_GROUP = 1;

export type ScreenBar = {
  /** Faces the camera; position it in world space. */
  root: TransformNode;
  meshes: readonly Mesh[];
  /** Fills from the left, from 0 to 1. */
  setFill: (fraction: number, material: Material) => void;
  dispose: () => void;
};

/** An unlit flat color for bar fills and frames. */
export function createBarMaterial(
  scene: Scene,
  name: string,
  color: Color3,
): StandardMaterial {
  const material = new StandardMaterial(name, scene);
  material.emissiveColor = color;
  material.diffuseColor = Color3.Black();
  material.specularColor = Color3.Black();
  material.disableLighting = true;
  return material;
}

/**
 * A camera-facing framed bar, so every status bar lines up on screen whatever
 * the camera angle. Dividers split it into equal segments.
 */
export function createScreenBar(
  scene: Scene,
  name: string,
  {
    width,
    frame,
    segments = 1,
  }: {
    width: number;
    frame: Material;
    segments?: number;
  },
): ScreenBar {
  const root = new TransformNode(name, scene);
  root.billboardMode = TransformNode.BILLBOARDMODE_ALL;
  const plane = (part: string, planeWidth: number, height: number) => {
    const mesh = MeshBuilder.CreatePlane(
      `${name}-${part}`,
      { width: planeWidth, height },
      scene,
    );
    mesh.isPickable = false;
    mesh.renderingGroupId = RENDERING_GROUP;
    mesh.parent = root;
    return mesh;
  };
  const background = plane(
    "frame",
    width + BORDER * 2,
    BAR_HEIGHT + BORDER * 2,
  );
  background.material = frame;
  const fill = plane("fill", width, BAR_HEIGHT);
  // Slightly towards the camera, which billboards face along -Z.
  fill.position.z = -0.001;
  const meshes = [background, fill];
  for (let index = 1; index < segments; index += 1) {
    const divider = plane(`divider-${index}`, DIVIDER_WIDTH, BAR_HEIGHT);
    divider.material = frame;
    divider.position.set((index / segments - 0.5) * width, 0, -0.002);
    meshes.push(divider);
  }
  return {
    root,
    meshes,
    setFill: (fraction, material) => {
      const clamped = Math.min(Math.max(fraction, 0), 1);
      fill.scaling.x = Math.max(clamped, 1e-3);
      fill.position.x = ((clamped - 1) * width) / 2;
      fill.material = material;
    },
    dispose: () => root.dispose(),
  };
}
