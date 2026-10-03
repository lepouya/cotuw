import {
  Color3,
  MeshBuilder,
  StandardMaterial,
  TransformNode,
} from "@babylonjs/core";
import { createMeshAppearance } from "./actor";

import type { Mesh, Scene } from "@babylonjs/core";
import type { ActorAppearance } from "./actor";

/** Stride length of one full leg cycle, in world units. */
const STRIDE = 1.1;
const LEG_SWING = 0.55;

/** A low-poly stand-in wolf whose legs swing with distance travelled. */
export function createWolfAppearance(
  scene: Scene,
  reducedMotion: () => boolean = () => false,
  scale = 1,
): ActorAppearance {
  const root = new TransformNode("wolf-template", scene);
  root.scaling.setAll(scale);
  const fur = new StandardMaterial("wolf-fur", scene);
  fur.diffuseColor = new Color3(0.42, 0.4, 0.37);
  fur.specularColor = Color3.Black();
  const dark = new StandardMaterial("wolf-dark", scene);
  dark.diffuseColor = new Color3(0.16, 0.15, 0.14);
  dark.specularColor = Color3.Black();
  const eyes = new StandardMaterial("wolf-eyes", scene);
  eyes.emissiveColor = new Color3(1, 0.72, 0.2);
  eyes.disableLighting = true;
  const box = (
    name: string,
    size: [number, number, number],
    position: [number, number, number],
    material: StandardMaterial,
    parent: TransformNode = root,
  ): Mesh => {
    const [width, height, depth] = size;
    const mesh = MeshBuilder.CreateBox(
      `wolf-${name}`,
      { width, height, depth },
      scene,
    );
    mesh.parent = parent;
    mesh.position.set(...position);
    mesh.material = material;
    return mesh;
  };
  box("body", [0.34, 0.32, 0.9], [0, 0.55, 0], fur);
  box("chest", [0.38, 0.38, 0.32], [0, 0.6, 0.3], fur);
  const head = box("head", [0.28, 0.26, 0.3], [0, 0.78, 0.55], fur);
  head.rotation.x = -0.15;
  box("snout", [0.15, 0.13, 0.22], [0, -0.05, 0.22], dark, head);
  box("left-ear", [0.07, 0.13, 0.05], [-0.09, 0.17, -0.05], dark, head);
  box("right-ear", [0.07, 0.13, 0.05], [0.09, 0.17, -0.05], dark, head);
  box("left-eye", [0.04, 0.04, 0.02], [-0.07, 0.04, 0.15], eyes, head);
  box("right-eye", [0.04, 0.04, 0.02], [0.07, 0.04, 0.15], eyes, head);
  const tail = box("tail", [0.09, 0.09, 0.42], [0, 0.62, -0.6], dark);
  tail.rotation.x = 0.5;
  const legs = [
    [-0.12, 0.32],
    [0.12, 0.32],
    [-0.12, -0.3],
    [0.12, -0.3],
  ].map(([x, z], index) => {
    const hip = new TransformNode(`wolf-leg-${index}`, scene);
    hip.parent = root;
    hip.position.set(x!, 0.45, z!);
    box(`leg-${index}-mesh`, [0.09, 0.45, 0.1], [0, -0.22, 0], dark, hip);
    return hip;
  });

  const body = createMeshAppearance(
    root,
    { radius: 0.5 * scale, height: 0.95 * scale },
    [0.86, 0.22, 0.2],
  );
  return {
    ...body,
    instantiate: (name, seed) => {
      const instance = body.instantiate(name, seed);
      const hips = legs.map((leg) =>
        instance.root
          .getChildTransformNodes(true)
          .find((node) => node.name.endsWith(leg.name))!,
      );
      let phase = seed * Math.PI * 2;
      return {
        ...instance,
        animate: ({ distance }) => {
          if (reducedMotion()) return;
          phase += (distance / STRIDE) * Math.PI * 2;
          // Diagonal pairs move together, as in a trot.
          hips.forEach((hip, index) => {
            const swing = Math.sin(
              phase + (index === 0 || index === 3 ? 0 : Math.PI),
            );
            hip.rotation.x = distance > 0 ? swing * LEG_SWING : 0;
          });
        },
      };
    },
  };
}
