// Shared steps for building generated models in a scene.
import {
  Animation,
  AnimationGroup,
  Color3,
  Mesh,
  Quaternion,
  StandardMaterial,
  TransformNode,
  Vector3,
} from "@babylonjs/core";

import { FRAMES_PER_SECOND } from "./glb-export.ts";

import type { Scene } from "@babylonjs/core";

/** A matte generated-model material; `glow` scales its self-illumination. */
export function surface(
  scene: Scene,
  name: string,
  color: Color3 | readonly [number, number, number],
  glow = 0,
) {
  const material = new StandardMaterial(name, scene);
  material.diffuseColor =
    color instanceof Color3 ? color.clone() : new Color3(...color);
  material.specularColor = Color3.Black();
  if (glow) material.emissiveColor = material.diffuseColor.scale(glow);
  return material;
}

export function unlit(scene: Scene, name: string, color: Color3) {
  const material = surface(scene, name, color);
  material.disableLighting = true;
  material.emissiveColor = material.diffuseColor;
  return material;
}

/** Bakes parts that share a material into one mesh, keeping draw calls low. */
export function merge(
  root: TransformNode,
  name: string,
  parts: Mesh[],
  material: StandardMaterial,
) {
  const mesh = Mesh.MergeMeshes(parts, true, true)!;
  mesh.convertToFlatShadedMesh();
  mesh.name = name;
  mesh.material = material;
  mesh.parent = root;
}

/**
 * Samples authored poses into glTF node channels; playback needs no builder.
 * Without `completePose`, channels that never move are left out.
 */
export function clip(
  root: TransformNode,
  name: string,
  seconds: number,
  pose: (seconds: number) => void,
  completePose = true,
): void {
  const nodes = [
    root,
    ...root
      .getDescendants(false)
      .filter((node): node is TransformNode => node instanceof TransformNode),
  ];
  const rest = nodes.map((node) => ({
    position: node.position.clone(),
    rotation: node.rotation.clone(),
    scaling: node.scaling.clone(),
  }));
  const restore = () =>
    nodes.forEach((node, index) => {
      node.position.copyFrom(rest[index]!.position);
      node.rotation.copyFrom(rest[index]!.rotation);
      node.scaling.copyFrom(rest[index]!.scaling);
    });
  const endFrame = seconds * FRAMES_PER_SECOND;
  const frames = Math.ceil(endFrame);
  const keys = nodes.map(() => ({
    position: [] as { frame: number; value: Vector3 }[],
    rotationQuaternion: [] as { frame: number; value: Quaternion }[],
    scaling: [] as { frame: number; value: Vector3 }[],
  }));
  for (let frame = 0; frame <= frames; frame++) {
    restore();
    // Include the exact endpoint between sample frames.
    const keyFrame = Math.min(frame, endFrame);
    pose(keyFrame / FRAMES_PER_SECOND);
    nodes.forEach((node, index) => {
      keys[index]!.position.push({
        frame: keyFrame,
        value: node.position.clone(),
      });
      keys[index]!.rotationQuaternion.push({
        frame: keyFrame,
        value: Quaternion.FromEulerVector(node.rotation),
      });
      keys[index]!.scaling.push({
        frame: keyFrame,
        value: node.scaling.clone(),
      });
    });
  }
  const group = new AnimationGroup(name, root.getScene());
  restore();
  nodes.forEach((node, index) => {
    node.rotationQuaternion = Quaternion.FromEulerVector(node.rotation);
    for (const property of [
      "position",
      "rotationQuaternion",
      "scaling",
    ] as const) {
      const values = keys[index]![property];
      const first = values[0]!.value.asArray();
      if (
        !completePose &&
        values.every(({ value }) =>
          value
            .asArray()
            .every((component, channel) => component === first[channel]),
        )
      )
        continue;
      const animation = new Animation(
        `${name}-${node.name}-${property}`,
        property,
        FRAMES_PER_SECOND,
        property === "rotationQuaternion"
          ? Animation.ANIMATIONTYPE_QUATERNION
          : Animation.ANIMATIONTYPE_VECTOR3,
      );
      animation.setKeys(values);
      group.addTargetedAnimation(animation, node);
    }
  });
}
