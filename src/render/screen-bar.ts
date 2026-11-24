import {
  Color3,
  MeshBuilder,
  StandardMaterial,
  TransformNode,
} from "@babylonjs/core";

import type { Material, Scene } from "@babylonjs/core";

export const BAR_HEIGHT = 0.12;
export const BORDER = 0.03;
/** Draws over terrain, fog, and models so bars stay readable. */
export const BAR_RENDERING_GROUP = 1;

export type ScreenBar = {
  /** Faces the camera; position it in world space. */
  root: TransformNode;
  /** Fills from the left, from 0 to 1. */
  setFill: (fraction: number, material: Material) => void;
};

/**
 * A fill's clamped fraction, its scale across a bar `width` wide, and its
 * center's offset, so it grows from the bar's left edge.
 */
export function fillSpan(fraction: number, width: number) {
  const clamped = Math.min(Math.max(fraction, 0), 1);
  return {
    fraction: clamped,
    // Zero-width geometry would degenerate.
    scale: Math.max(clamped, 1e-3),
    x: ((clamped - 1) * width) / 2,
  };
}

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
 * the camera angle.
 */
export function createScreenBar(
  scene: Scene,
  name: string,
  {
    width,
    frame,
  }: {
    width: number;
    frame: Material;
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
    mesh.renderingGroupId = BAR_RENDERING_GROUP;
    mesh.parent = root;
    return mesh;
  };
  const background = plane(
    "frame",
    width + BORDER * 2,
    BAR_HEIGHT + BORDER * 2,
  );
  background.material = frame;
  background.alphaIndex = 0;
  const fill = plane("fill", width, BAR_HEIGHT);
  fill.alphaIndex = 1;
  // Slightly towards the camera, which billboards face along -Z.
  fill.position.z = -0.001;
  return {
    root,
    setFill: (fraction, material) => {
      const span = fillSpan(fraction, width);
      fill.scaling.x = span.scale;
      fill.position.x = span.x;
      fill.material = material;
    },
  };
}
