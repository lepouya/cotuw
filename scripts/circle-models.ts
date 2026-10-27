import { MeshBuilder, TransformNode, Vector3 } from "@babylonjs/core";
import type { Mesh, Scene, StandardMaterial } from "@babylonjs/core";
import { surface } from "./model-surface.ts";

type StructureRecipe = {
  halfWidth: number;
  halfDepth: number;
  height: number;
  frame: keyof typeof FRAMES;
  focusHeight: number;
  /** A glowing pool for buildings that receive cultivated Lifebloom. */
  basin?: boolean;
  /** Owned buildings carry a marker; neutral resource sites do not. */
  owned: boolean;
};

type Builder = {
  name: string;
  scene: Scene;
  root: TransformNode;
  recipe: StructureRecipe;
  wood: StandardMaterial;
  core: StandardMaterial;
  stem: (
    id: string,
    points: number[][],
    radius: number,
    surface?: StandardMaterial,
  ) => Mesh;
  plate: (
    id: string,
    position: number[],
    size: number[],
    surface?: StandardMaterial,
  ) => Mesh;
};

/** Frames build each structure's ribs and canopy above the shared roots. */
const FRAMES = {
  /** A central trunk with arched ribs and a raised canopy. */
  tree: ({ stem, plate }: Builder) => {
    stem(
      "growth-ribs-trunk",
      [
        [0, 0, 0],
        [0.18, 1.2, -0.05],
        [-0.1, 2.3, 0],
        [0, 3.3, 0],
      ],
      0.3,
    );
    for (let i = 0; i < 6; i++) {
      const angle = (i * Math.PI) / 3;
      const x = Math.cos(angle),
        z = Math.sin(angle);
      stem(
        `growth-ribs-arch-${i}`,
        [
          [x * 1.1, 0, z * 1.1],
          [x * 0.75, 0.9, z * 0.75],
          [0.05, 1.6, 0],
        ],
        0.12,
      );
      stem(
        `growth-ribs-branch-${i}`,
        [
          [0, 1.8, 0],
          [x * 0.8, 2.7, z * 0.8],
          [x * 1.1, 3.2, z * 1.1],
        ],
        0.13,
      );
      plate(
        `growth-canopy-${i}`,
        [x * 0.7, 3.25 + (i % 2) * 0.3, z * 0.7],
        [1.25, 0.7, 1.1],
      );
    }
  },
  /** A hall of arched ribs under leaf roofing. */
  arches: ({ name, scene, root, recipe, wood, core, stem, plate }: Builder) => {
    const { halfWidth, halfDepth, height } = recipe;
    for (let i = 0; i < 4; i++) {
      const z = -halfDepth + (i * halfDepth * 2) / 3;
      stem(
        `growth-ribs-arch-${i}`,
        [
          [-halfWidth, 0, z],
          [-halfWidth * 0.9, height * 0.55, z],
          [0, height, z],
          [halfWidth * 0.9, height * 0.55, z],
          [halfWidth, 0, z],
        ],
        0.1,
      );
      for (const side of [-1, 1]) {
        const roof = plate(
          `growth-canopy-${i}-${side}`,
          [side * halfWidth * 0.52, height * 0.84, z],
          [halfWidth * 1.1, 0.18, halfDepth * 0.85],
        );
        roof.rotation.z = side * -0.38;
      }
    }
    if (recipe.basin) {
      const basin = MeshBuilder.CreateTorus(
        `${name}-growth-roots-basin`,
        { diameter: 1.4, thickness: 0.18, tessellation: 20 },
        scene,
      );
      basin.parent = root;
      basin.position.y = 0.25;
      basin.material = wood;
      plate("growth-ribs-pool", [0, 0.2, 0], [1.2, 0.14, 1.2], core);
    }
  },
  /** A ring of flowering stems. */
  bloom: ({ stem, plate, core }: Builder) => {
    for (let i = 0; i < 7; i++) {
      const angle = (i * Math.PI * 2) / 7;
      const x = Math.cos(angle) * 0.45,
        z = Math.sin(angle) * 0.45;
      stem(
        `growth-ribs-stem-${i}`,
        [
          [x, 0, z],
          [x * 0.8, 0.3, z * 0.8],
          [x, 0.7, z],
        ],
        0.045,
      );
      plate(`growth-canopy-leaf-${i}`, [x, 0.35, z], [0.5, 0.12, 0.22]);
      plate(
        `growth-canopy-flower-${i}`,
        [x, 0.65, z],
        [0.23, 0.18, 0.23],
        core,
      );
    }
  },
};

export const CIRCLE_STRUCTURES = {
  "circle-heartgrove": {
    halfWidth: 1.15,
    halfDepth: 1.3,
    height: 4,
    frame: "tree",
    focusHeight: 2.1,
    owned: true,
  },
  "circle-conservatory": {
    halfWidth: 1.3,
    halfDepth: 0.8,
    height: 1.5,
    frame: "arches",
    focusHeight: 0.65,
    basin: true,
    owned: true,
  },
  "circle-musterhall": {
    halfWidth: 0.85,
    halfDepth: 1.3,
    height: 2.1,
    frame: "arches",
    focusHeight: 0.65,
    owned: true,
  },
  "cultivation-site": {
    halfWidth: 0.65,
    halfDepth: 0.65,
    height: 0.7,
    frame: "bloom",
    focusHeight: 0.5,
    owned: false,
  },
} satisfies Record<string, StructureRecipe>;
export type CircleStructureId = keyof typeof CIRCLE_STRUCTURES;

/** Named growth layers let presentation reveal living architecture in thirds. */
export function createCircleStructure(scene: Scene, id: CircleStructureId) {
  const recipe: StructureRecipe = CIRCLE_STRUCTURES[id];
  const name = id;
  const root = new TransformNode(name, scene);
  const material = (
    id: string,
    color: readonly [number, number, number],
    glow = 0,
  ) => surface(scene, `${name}-${id}`, color, glow);
  const wood = material("wood", [0.82, 0.74, 0.52]);
  const bark = material("roots", [0.28, 0.19, 0.12]);
  const leaf = material("leaves", [0.12, 0.34, 0.22]);
  const core = material("core", [0.58, 0.28, 0.88], 0.6);
  const owner = material("owner", [0.48, 0.76, 0.59]);
  const stem: Builder["stem"] = (id, points, radius, surface = wood) => {
    const mesh = MeshBuilder.CreateTube(
      `${name}-${id}`,
      {
        path: points.map((point) => Vector3.FromArray(point)),
        radius,
        tessellation: 7,
        cap: 3,
      },
      scene,
    );
    mesh.parent = root;
    mesh.material = surface;
    return mesh;
  };
  const plate: Builder["plate"] = (id, position, size, surface = leaf) => {
    const mesh = MeshBuilder.CreateSphere(
      `${name}-${id}`,
      { diameter: 1, segments: 6 },
      scene,
    );
    mesh.parent = root;
    mesh.material = surface;
    mesh.position.copyFromFloats(position[0]!, position[1]!, position[2]!);
    mesh.scaling.copyFromFloats(size[0]!, size[1]!, size[2]!);
    return mesh;
  };
  const { halfWidth, halfDepth, height } = recipe;
  for (let index = 0; index < 6; index++) {
    const angle = (index * Math.PI) / 3;
    const x = Math.cos(angle) * halfWidth,
      z = Math.sin(angle) * halfDepth;
    stem(
      `growth-roots-${index}`,
      [
        [x, 0, z],
        [x * 0.75, 0.16, z * 0.75],
        [x * 0.3, 0.22, z * 0.3],
      ],
      0.12,
      bark,
    );
  }
  FRAMES[recipe.frame]({
    name,
    scene,
    root,
    recipe,
    wood,
    core,
    stem,
    plate,
  });
  if (recipe.owned)
    plate(
      "growth-canopy-owner",
      [0, height * 0.62, halfDepth * 0.85],
      [0.35, 0.3, 0.12],
      owner,
    );
  else owner.dispose();
  const pulse = plate(
    "growth-canopy-focus",
    [0, recipe.focusHeight, 0],
    [0.3, 0.45, 0.3],
    core,
  );
  return {
    root,
    pose: (seconds: number) => {
      pulse.scaling.set(
        0.3,
        0.45 * (1 + Math.sin(seconds * Math.PI) * 0.12),
        0.3,
      );
    },
  };
}
