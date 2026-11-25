import {
  Color3,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  TransformNode,
  VertexData,
} from "@babylonjs/core";

import { createMeshAppearance } from "./actor";

import type { Scene } from "@babylonjs/core";
import type { ActorAppearance } from "./actor";

/** Stride length of one full leg cycle, in world units. */
const STRIDE = 1.1;
const LEG_SWING = 0.55;

type Point = [number, number, number];

/** Eight-sided rings from rump to chest, with a darker saddle over the back. */
function wolfBody(root: TransformNode, material: StandardMaterial) {
  const rings = [
    [-0.49, 0.58, 0.055, 0.075],
    [-0.36, 0.57, 0.165, 0.175],
    [-0.14, 0.61, 0.155, 0.145],
    [0.16, 0.6, 0.198, 0.209],
    [0.36, 0.62, 0.211, 0.205],
    [0.5, 0.658, 0.105, 0.12],
  ] as const;
  const sides = 8;
  const positions: number[] = [];
  const indices: number[] = [];
  const colors: number[] = [];
  const saddle = new Color3(0.26, 0.24, 0.21);
  const flank = new Color3(0.57, 0.52, 0.44);
  const belly = new Color3(0.7, 0.64, 0.53);
  rings.forEach(([z, centerY, radiusX, radiusY], ring) => {
    for (let side = 0; side < sides; side++) {
      const angle = ((side + 0.5) * 2 * Math.PI) / sides;
      const y = Math.sin(angle);
      positions.push(Math.cos(angle) * radiusX, centerY + y * radiusY, z);
      const shade =
        y > 0 ? Color3.Lerp(flank, saddle, y) : Color3.Lerp(flank, belly, -y);
      colors.push(shade.r, shade.g, shade.b, 1);
      if (ring > 0) {
        const rear = (ring - 1) * sides;
        const front = ring * sides;
        const next = (side + 1) % sides;
        indices.push(rear + side, front + side, rear + next);
        indices.push(rear + next, front + side, front + next);
      }
    }
  });
  const last = (rings.length - 1) * sides;
  for (let side = 1; side < sides - 1; side++) {
    indices.push(0, side, side + 1, last, last + side + 1, last + side);
  }

  const mesh = new Mesh("wolf-body", root.getScene());
  const vertices = new VertexData();
  vertices.positions = positions;
  vertices.indices = indices;
  vertices.colors = colors;
  vertices.normals = [];
  VertexData.ComputeNormals(positions, indices, vertices.normals);
  vertices.applyToMesh(mesh);
  mesh.convertToFlatShadedMesh();
  mesh.parent = root;
  mesh.material = material;
}

/** The wolf's parts, for the stand-in below and the generated model. */
export function createWolfParts(scene: Scene, rootName: string) {
  const root = new TransformNode(rootName, scene);
  const matte = (name: string, color: Point) => {
    const material = new StandardMaterial(`wolf-${name}`, scene);
    material.diffuseColor = new Color3(...color);
    material.specularColor = Color3.Black();
    material.specularPower = 0;
    return material;
  };
  const coat = matte("coat", [1, 1, 1]);
  const fur = matte("fur", [0.48, 0.43, 0.36]);
  const cream = matte("cream", [0.7, 0.62, 0.49]);
  const dark = matte("dark", [0.23, 0.205, 0.17]);
  const nose = matte("nose", [0.1, 0.08, 0.07]);
  const teeth = matte("teeth", [0.88, 0.83, 0.7]);
  const eyes = matte("eyes", [0.95, 0.66, 0.24]);
  eyes.emissiveColor = eyes.diffuseColor.scale(0.4);

  const place = (
    mesh: Mesh,
    position: Point,
    material: StandardMaterial,
    parent: TransformNode,
  ) => {
    mesh.material = material;
    mesh.parent = parent;
    mesh.position.set(...position);
    return mesh;
  };
  const joint = (name: string, position: Point, parent = root) => {
    const node = new TransformNode(`wolf-${name}`, scene);
    node.parent = parent;
    node.position.set(...position);
    return node;
  };
  const oval = (
    name: string,
    size: Point,
    position: Point,
    material: StandardMaterial,
    parent = root,
  ) => {
    const mesh = MeshBuilder.CreateSphere(
      `wolf-${name}`,
      { diameter: 1, segments: 5 },
      scene,
    );
    mesh.scaling.set(...size);
    return place(mesh, position, material, parent);
  };
  const taper = (
    name: string,
    height: number,
    diameterTop: number,
    diameterBottom: number,
    position: Point,
    material: StandardMaterial,
    parent: TransformNode,
    pitch = 0,
  ) => {
    const mesh = MeshBuilder.CreateCylinder(
      `wolf-${name}`,
      { height, diameterTop, diameterBottom, tessellation: 5 },
      scene,
    ).convertToFlatShadedMesh();
    mesh.rotation.x = pitch;
    return place(mesh, position, material, parent);
  };

  wolfBody(root, coat);
  oval("ruff", [0.39, 0.41, 0.42], [0, 0.66, 0.384], fur).rotation.x = 0.62;
  oval("throat", [0.275, 0.28, 0.29], [0, 0.56, 0.444], cream);

  const head = joint("head-joint", [0, 0.757, 0.538]);
  head.rotation.x = -0.15;
  oval("skull", [0.284, 0.215, 0.275], [0, 0.005, 0.022], fur, head);
  const muzzle = taper(
    "muzzle",
    0.199,
    0.102,
    0.175,
    [0, -0.037, 0.158],
    dark,
    head,
    1.76,
  );
  muzzle.scaling.z = 0.7;
  oval("nose-tip", [0.105, 0.062, 0.055], [0, -0.057, 0.265], nose, head);
  const jaw = joint("jaw", [0, -0.067, 0.054], head);
  oval("chin", [0.133, 0.06, 0.215], [0, -0.028, 0.092], cream, jaw);
  oval("mouth", [0.113, 0.04, 0.195], [0, -0.007, 0.093], nose, jaw);
  for (const side of [-1, 1]) {
    const ear = taper(
      `ear-${side}`,
      0.151,
      0.012,
      0.112,
      [side * 0.087, 0.123, -0.036],
      dark,
      head,
      -0.19,
    );
    ear.scaling.z = 0.62;
    ear.rotation.z = -side * 0.22;
    const cheek = oval(
      `cheek-${side}`,
      [0.121, 0.12, 0.196],
      [side * 0.089, -0.056, 0.061],
      cream,
      head,
    );
    cheek.rotation.x = -0.32;
    oval(
      `eye-${side}`,
      [0.044, 0.023, 0.028],
      [side * 0.108, 0.025, 0.121],
      eyes,
      head,
    );
    taper(
      `canine-${side}`,
      0.037,
      0.023,
      0.006,
      [side * 0.048, -0.083, 0.183],
      teeth,
      head,
    );
  }

  const tail = joint("tail", [0, 0.604, -0.41]);
  oval(
    "brush",
    [0.136, 0.143, 0.371],
    [0, -0.097, -0.145],
    fur,
    tail,
  ).rotation.x = -0.55;
  oval(
    "brush-tip",
    [0.102, 0.119, 0.209],
    [0, -0.207, -0.272],
    dark,
    tail,
  ).rotation.x = -0.78;

  const limbs = [-0.135, 0.135, -0.128, 0.128].map((x, index) => {
    const front = index < 2;
    const hip = joint(`leg-${index}`, [x, 0.462, front ? 0.318 : -0.318]);
    const knee = joint(
      `leg-${index}-knee`,
      [0, -0.231, front ? 0.008 : 0.074],
      hip,
    );
    const upper = oval(
      `leg-${index}-upper`,
      front ? [0.112, 0.303, 0.123] : [0.155, 0.3, 0.217],
      [0, -0.083, front ? 0.007 : 0.02],
      fur,
      hip,
    );
    upper.rotation.x = front ? 0 : -0.39;
    taper(
      `leg-${index}-shin`,
      0.205,
      0.091,
      0.056,
      [0, -0.09, front ? 0 : -0.039],
      dark,
      knee,
      front ? 0 : 0.39,
    );
    oval(
      `leg-${index}-paw`,
      [0.093, 0.079, 0.148],
      [0, -0.19, front ? 0.027 : -0.054],
      dark,
      knee,
    );
    return { hip, knee };
  });
  return { root, head, jaw, tail, limbs };
}

/** A low-poly stand-in wolf whose legs swing with distance travelled. */
export function createWolfAppearance(
  scene: Scene,
  reducedMotion: () => boolean = () => false,
  scale = 1,
): ActorAppearance {
  const { root, limbs } = createWolfParts(scene, "wolf-template");
  root.scaling.setAll(scale);
  const body = createMeshAppearance(root, {
    radius: 0.5 * scale,
    height: 0.95 * scale,
  });
  return {
    ...body,
    instantiate: (name, seed) => {
      const instance = body.instantiate(name, seed);
      const hips = limbs.map(({ hip }) =>
        instance.root
          .getChildTransformNodes(true)
          .find((node) => node.name.endsWith(hip.name))!,
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
