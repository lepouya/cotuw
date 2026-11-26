import {
  MeshBuilder,
  Quaternion,
  TransformNode,
  Vector3,
} from "@babylonjs/core";

import {
  batches,
  byMaterial,
  clip,
  foldedBlade,
  loft,
  merge,
  place,
  skin,
  surface,
  tube,
} from "./model-toolkit.ts";
import { seededRandom } from "./sprite-sheet.ts";

import type { Mesh, Scene, StandardMaterial } from "@babylonjs/core";
import type { Vec3 } from "./model-toolkit.ts";

/** The Thornspire's crown opens and closes once per shot. */
const FIRE_SECONDS = 0.4;
/** Producer entrances part and close once per unit that leaves. */
const EXIT_SECONDS = 1.2;
/** Entrance leaves rest slightly apart so the opening stays readable. */
const ENTRANCE_REST_ANGLE = 0.45;
const ENTRANCE_OPEN_ANGLE = 1.35;

/** Shared Circle finishes: owner-recolored marks and the violet core light. */
const OWNER_MARK: Vec3 = [0.48, 0.76, 0.59];
const CORE_LIGHT: Vec3 = [0.58, 0.28, 0.88];
const CORE_GLOW = 0.6;

/** Folded, pointed leaf with a raised midrib and a solid underside. */
const LEAF_BLADE = foldedBlade([
  [0, 0, -0.5],
  [-0.34, 0.02, -0.27],
  [-0.5, 0, 0.04],
  [-0.28, 0.12, 0.31],
  [0, 0.32, 0.5],
  [0.28, 0.12, 0.31],
  [0.5, 0, 0.04],
  [0.34, 0.02, -0.27],
  [0, 0.5, 0.02],
  [0, -0.24, 0.02],
]);

export function leafBlade(scene: Scene, name: string) {
  return MeshBuilder.CreatePolyhedron(name, { custom: LEAF_BLADE }, scene);
}

type StructureRecipe = {
  halfWidth: number;
  halfDepth: number;
  height: number;
  frame: keyof typeof FRAMES;
  focusHeight: number;
  focusScale?: Vec3;
  /** Owned buildings carry a marker; neutral resource sites do not. */
  owned: boolean;
  ownerMarks?: readonly Vec3[];
  /** A producer's front entrance, whose leaves part for each exit. */
  entrance?: {
    z: number;
    width: number;
    height: number;
    bladePanels?: boolean;
    panelWidth?: number;
  };
};

/** What a frame draws with. */
type FrameContext = {
  name: string;
  scene: Scene;
  root: TransformNode;
  recipe: StructureRecipe;
  wood: StandardMaterial;
  bark: StandardMaterial;
  leaf: StandardMaterial;
  core: StandardMaterial;
  stem: (
    id: string,
    points: readonly Vec3[],
    radius: number,
    material?: StandardMaterial,
  ) => Mesh;
  plate: (
    id: string,
    position: Vec3,
    size: Vec3,
    material?: StandardMaterial,
    shape?: "blade",
  ) => Mesh;
};

/** Frames build each structure's ribs and canopy above the shared roots. */
const FRAMES = {
  /** Plaited roots leave an open hall beneath the layered crown. */
  tree: ({ stem, plate, core }: FrameContext) => {
    stem(
      "growth-ribs-trunk",
      [
        [0.07, 0, -0.36],
        [0.18, 0.85, -0.41],
        [-0.1, 1.76, -0.36],
        [-0.14, 2.52, -0.2],
        [0.03, 3.27, -0.04],
      ],
      0.23,
    );
    stem(
      "growth-ribs-entry-arch",
      [
        [-0.71, 0, 1.12],
        [-0.64, 0.74, 1.08],
        [-0.37, 1.37, 1.04],
        [0, 1.61, 1.01],
        [0.37, 1.37, 1.04],
        [0.64, 0.74, 1.08],
        [0.71, 0, 1.12],
      ],
      0.13,
    );
    for (const side of [-1, 1]) {
      stem(
        `growth-ribs-side-arch-${side}`,
        [
          [side * 1.19, 0, 0.53],
          [side * 1.04, 0.53, 0.38],
          [side * 0.82, 1.18, 0.19],
          [side * 0.51, 1.72, -0.1],
          [side * 0.08, 2.07, -0.34],
        ],
        0.15,
      );
      stem(
        `growth-ribs-rear-root-${side}`,
        [
          [side * 0.79, 0, -1.15],
          [side * 0.63, 0.44, -0.94],
          [side * 0.47, 0.94, -0.72],
          [side * 0.12, 1.59, -0.37],
        ],
        0.17,
      );
      stem(
        `growth-ribs-arch-brace-${side}`,
        [
          [side * 0.38, 1.38, 1.04],
          [side * 0.44, 1.63, 0.69],
          [side * 0.34, 1.85, 0.23],
          [side * 0.12, 2.11, -0.34],
        ],
        0.095,
      );
      plate(
        `growth-canopy-entrance-lamp-${side}`,
        [side * 0.55, 0.89, 1.15],
        [0.12, 0.24, 0.12],
        core,
      );
      plate(
        `growth-roots-front-frond-${side}`,
        [side * 0.92, 0.15, 0.87],
        [0.36, 0.27, 0.8],
        undefined,
        "blade",
      ).rotation.y = side * 0.48;
      plate(
        `growth-roots-rear-frond-${side}`,
        [side * 0.89, 0.12, -0.8],
        [0.42, 0.23, 0.87],
        undefined,
        "blade",
      ).rotation.y = Math.PI - side * 0.78;
    }

    const crownHeights = [3.21, 3.09, 3.37, 3.23, 3.44, 3.31];
    for (const [i, y] of crownHeights.entries()) {
      const angle = Math.PI / 12 + (i * Math.PI) / 3;
      const x = Math.sin(angle);
      const z = Math.cos(angle);
      stem(
        `growth-ribs-branch-${i}`,
        [
          [-0.08, 2.14, -0.25],
          [x * 0.41, y - 0.69, z * 0.41],
          [x * 0.74, y - 0.23, z * 0.74],
          [x * 1.13, y - 0.08, z * 1.13],
        ],
        0.115,
      );
      plate(
        `growth-canopy-outer-blade-${i}`,
        [x * 0.86, y, z * 0.86],
        [0.86, 0.37, 1.24],
        undefined,
        "blade",
      ).rotation.y = angle;
      plate(
        `growth-canopy-inner-blade-${i}`,
        [x * 0.41, y + 0.22, z * 0.41],
        [0.67, 0.32, 1.07],
        undefined,
        "blade",
      ).rotation.y = angle + 0.24;
    }
  },
  /** A low bower leaves the Lifebloom basin open at the front. */
  basin: ({ name, scene, root, wood, stem, plate }: FrameContext) => {
    place(
      MeshBuilder.CreateCylinder(
        `${name}-growth-roots-basin-foot`,
        {
          height: 0.3,
          diameterTop: 1.72,
          diameterBottom: 1.27,
          tessellation: 20,
        },
        scene,
      ),
      {
        parent: root,
        material: wood,
        position: [0, 0.22, 0.12],
        scaling: [1, 1, 0.67],
      },
    );
    place(
      MeshBuilder.CreateTorus(
        `${name}-growth-roots-basin-rim`,
        { diameter: 1.75, thickness: 0.15, tessellation: 24 },
        scene,
      ),
      {
        parent: root,
        material: wood,
        position: [0, 0.39, 0.12],
        scaling: [1, 1, 0.67],
      },
    );
    const sap = surface(scene, `${name}-sap`, [0.4, 0.2, 0.72], 0.32);
    plate("growth-ribs-pool", [0, 0.34, 0.12], [1.75, 0.13, 1.17], sap);
    stem(
      "growth-ribs-rear-arch",
      [
        [-1.12, 0, -0.51],
        [-0.95, 0.75, -0.68],
        [-0.52, 1.29, -0.73],
        [0, 1.42, -0.71],
        [0.52, 1.29, -0.73],
        [0.95, 0.75, -0.68],
        [1.12, 0, -0.51],
      ],
      0.12,
    );
    for (const side of [-1, 1]) {
      stem(
        `growth-ribs-bower-${side}`,
        [
          [side * 1.18, 0, 0.49],
          [side * 1.03, 0.58, 0.34],
          [side * 0.88, 0.9, 0.18],
          [side * 0.76, 1.16, -0.24],
          [side * 0.39, 1.32, -0.63],
        ],
        0.13,
      );
      stem(
        `growth-roots-apron-${side}`,
        [
          [side * 0.86, 0, 0.77],
          [side * 0.68, 0.12, 0.64],
          [side * 0.43, 0.26, 0.54],
        ],
        0.095,
      );
      plate(
        `growth-canopy-wing-${side}`,
        [side * 0.84, 1.17, -0.25],
        [0.56, 0.3, 0.99],
        undefined,
        "blade",
      ).rotation.y = side * 0.86;
      plate(
        `growth-canopy-rear-leaf-${side}`,
        [side * 0.35, 1.39, -0.65],
        [0.57, 0.36, 0.84],
        undefined,
        "blade",
      ).rotation.y = side * 2.1;
      plate(
        `growth-canopy-layered-wing-${side}`,
        [side * 0.96, 1.01, -0.47],
        [0.45, 0.27, 0.78],
        undefined,
        "blade",
      ).rotation.y = side * 1.8;
      plate(
        `growth-canopy-root-leaf-${side}`,
        [side * 1.02, 0.18, 0.16],
        [0.35, 0.23, 0.7],
        undefined,
        "blade",
      ).rotation.y = side * 0.56;
    }
  },
  /** An elongated vault with a raised arch over the deployment entrance. */
  hall: ({ stem, plate, core }: FrameContext) => {
    for (const [i, z] of [-1.1, -0.37, 0.4, 1.22].entries()) {
      const peak = i === 3 ? 2.22 : 1.98;
      stem(
        `growth-ribs-arch-${i}`,
        [
          [-0.86, 0, z],
          [-0.75, 0.84, z],
          [-0.58, 1.43, z],
          [-0.36, peak - 0.32, z],
          [0, peak, z],
          [0.36, peak - 0.32, z],
          [0.58, 1.43, z],
          [0.75, 0.84, z],
          [0.86, 0, z],
        ],
        i === 3 ? 0.13 : 0.09,
      );
    }
    stem(
      "growth-ribs-ridge",
      [
        [0, 1.83, -1.27],
        [0, 1.98, -0.78],
        [0, 2.02, 0.42],
        [0, 2.22, 1.22],
      ],
      0.095,
    );
    for (const side of [-1, 1]) {
      stem(
        `growth-ribs-eave-${side}`,
        [
          [side * 0.62, 1.14, -1.18],
          [side * 0.71, 1.24, -0.64],
          [side * 0.72, 1.26, 0.51],
          [side * 0.58, 1.43, 1.22],
        ],
        0.085,
      );
      stem(
        `growth-roots-sill-${side}`,
        [
          [side * 0.79, 0, -1.29],
          [side * 0.82, 0.13, -0.72],
          [side * 0.84, 0.11, 0.59],
          [side * 0.78, 0, 1.35],
        ],
        0.13,
      );
      for (const [i, z] of [-0.89, -0.32, 0.25, 0.81].entries()) {
        const roof = plate(
          `growth-canopy-roof-blade-${i}-${side}`,
          [side * 0.35, i === 3 ? 1.88 : 1.77, z],
          [0.94, 0.42, 1.19],
          undefined,
          "blade",
        );
        roof.rotation.set(-0.12, side * 0.24, side * -0.67);
      }
      plate(
        `growth-canopy-threshold-light-${side}`,
        [side * 0.74, 0.72, 1.32],
        [0.13, 0.26, 0.16],
        core,
      );
    }
  },
  /** Three curved ribs support a thorn crown that opens to cast. */
  spire: ({
    name,
    scene,
    root,
    recipe,
    wood,
    leaf,
    core,
    stem,
    plate,
  }: FrameContext) => {
    const { height } = recipe;
    for (let i = 0; i < 3; i++) {
      const angle = (i * Math.PI * 2) / 3;
      const point = (radius: number, y: number, sweep = 0): Vec3 => [
        Math.sin(angle + sweep) * radius,
        y,
        Math.cos(angle + sweep) * radius,
      ];
      stem(
        `growth-ribs-arch-${i}`,
        [
          point(0.38, 0.14),
          point(0.29, 0.55, 0.13),
          point(0.28, 1.03, 0.46),
          point(0.32, 1.48, 0.77),
          point(0.21, 1.86, 0.9),
          point(0.06, height * 0.82, 0.96),
        ],
        0.105,
      );
      plate(
        `growth-canopy-upper-thorn-${i}`,
        point(0.32, 1.58, 0.74),
        [0.32, 0.2, 0.72],
        leaf,
        "blade",
      ).rotation.set(-1.02, angle + 0.74, 0);
      plate(
        `growth-canopy-lower-thorn-${i}`,
        point(0.27, 0.55, 0.22),
        [0.24, 0.16, 0.55],
        leaf,
        "blade",
      ).rotation.set(-0.95, angle + 0.22, 0);
    }
    // The crown turns with the weapon; its petals open to fire.
    const crown = new TransformNode(`${name}-crown`, scene);
    crown.parent = root;
    crown.position.y = height * 0.82;
    const petals: TransformNode[] = [];
    for (let i = 0; i < 4; i++) {
      const pivot = new TransformNode(`${name}-petal-${i}`, scene);
      pivot.parent = crown;
      pivot.rotation.y = (i * Math.PI) / 2;
      petals.push(pivot);
      place(leafBlade(scene, `${name}-growth-canopy-crown-${i}`), {
        parent: pivot,
        material: i % 2 ? leaf : wood,
        position: [0, 0.225, 0.205],
        rotation: [-1.28, 0, 0],
        scaling: [0.245, 0.18, 0.59],
      });
    }
    const focus = place(
      MeshBuilder.CreatePolyhedron(
        `${name}-growth-canopy-crown-core`,
        { type: 1, size: 0.2 },
        scene,
      ),
      {
        parent: crown,
        material: core,
        position: [0, 0.2, 0],
        scaling: [0.76, 1.08, 0.76],
      },
    );
    return () =>
      clip(
        root,
        "attack",
        FIRE_SECONDS,
        (seconds) => {
          const open = Math.sin((seconds / FIRE_SECONDS) * Math.PI);
          for (const petal of petals) petal.rotation.x = open * 0.93;
          focus.scaling.set(
            0.76 + open * 0.2,
            1.08 + open * 0.26,
            0.76 + open * 0.2,
          );
        },
        false,
      );
  },
  /** Layered wings cradle the seed bed around a wide deployment lane. */
  cradle: ({ recipe, bark, wood, core, stem, plate }: FrameContext) => {
    const { height, entrance } = recipe;
    const { z: front } = entrance!;
    const arches = [
      { z: -0.99, drop: 0.48, width: 0.98 },
      { z: -0.28, drop: 0.27, width: 1.19 },
      { z: 0.53, drop: 0.31, width: 1.24 },
      { z: front, drop: 0.1, width: 1.08 },
    ];
    for (const [index, { z, drop, width }] of arches.entries()) {
      const mouth = z === front;
      const peak = height - drop;
      stem(
        `growth-ribs-arch-${index}`,
        [
          [-width, 0, z],
          [-width, 0.87, z],
          [-width * 0.85, 1.37, z],
          [-width * 0.57, peak - 0.22, z],
          [-width * 0.27, peak - 0.04, z],
          [0, peak, z],
          [width * 0.27, peak - 0.04, z],
          [width * 0.57, peak - 0.22, z],
          [width * 0.85, 1.37, z],
          [width, 0.87, z],
          [width, 0, z],
        ],
        mouth ? 0.135 : 0.095,
      );
    }
    plate("growth-roots-seed-bed", [0, 0.13, -0.34], [1.53, 0.22, 1.5], bark);
    for (const side of [-1, 1]) {
      stem(
        `growth-roots-bed-rim-${side}`,
        [
          [0, 0.19, -1.07],
          [side * 0.54, 0.22, -1.02],
          [side * 0.78, 0.24, -0.69],
          [side * 0.8, 0.22, -0.25],
          [side * 0.65, 0.19, 0.22],
          [side * 0.4, 0.12, 0.53],
        ],
        0.085,
      );
      stem(
        `growth-roots-sill-${side}`,
        [
          [side * 0.96, 0.12, -1.06],
          [side * 1.21, 0.18, -0.48],
          [side * 1.18, 0.18, 0.29],
          [side * 1.13, 0.13, 0.88],
          [side * 1.24, 0.03, 1.35],
        ],
        0.103,
        bark,
      );
      stem(
        `growth-ribs-shoulder-${side}`,
        [
          [side * 0.95, 0.28, -1.12],
          [side * 1.02, 0.9, -0.72],
          [side * 1.06, 1.1, -0.08],
          [side * 0.97, 1.19, 0.58],
          [side * 0.88, 1.44, front],
        ],
        0.105,
      );
      for (const [index, z] of [-0.85, -0.29, 0.28, 0.81].entries()) {
        const sweep = side * (1.32 + index * 0.16);
        const taper = index === 0 ? 0.13 : 0;
        plate(
          `growth-canopy-wing-${side}-${index}`,
          [side * (0.68 - taper), 1.55 + index * 0.028 - taper, z],
          [0.76, 0.36, 1.29],
          undefined,
          "blade",
        ).rotation.set(0.47, sweep, 0);
        plate(
          `growth-canopy-fold-${side}-${index}`,
          [side * (1.05 - taper), 1.14 + index * 0.045, z - 0.06],
          [0.58, 0.23, 0.73],
          undefined,
          "blade",
        ).rotation.set(0.69, sweep + side * 0.13, 0);
      }
      plate(
        `growth-canopy-threshold-lamp-${side}`,
        [side * 1.1, 0.56, front + 0.115],
        [0.12, 0.24, 0.13],
        core,
      );
      plate(
        `growth-roots-seed-cradle-${side}`,
        [side * 0.28, 0.24, 0],
        [0.31, 0.34, 0.86],
        wood,
        "blade",
      ).rotation.set(0, side * 0.45, -side * 0.65);
    }
    stem(
      "growth-ribs-rear-brace",
      [
        [-0.98, 0.32, -0.99],
        [-0.71, 0.55, -1.13],
        [0, 0.64, -1.18],
        [0.71, 0.55, -1.13],
        [0.98, 0.32, -0.99],
      ],
      0.103,
      bark,
    );
    plate(
      "growth-canopy-rear-cap",
      [0, 1.48, -0.91],
      [1.28, 0.35, 0.89],
      undefined,
      "blade",
    ).rotation.set(0.46, Math.PI, 0);
    plate(
      "growth-canopy-rear-fold",
      [0, 1.17, -1.08],
      [0.9, 0.27, 0.71],
      undefined,
      "blade",
    ).rotation.set(0.7, Math.PI, 0);
  },
  /** A flowering clump with a tall open rosette and two younger blooms. */
  bloom: ({ name, scene, stem, plate, leaf, core }: FrameContext) => {
    const petals = surface(scene, `${name}-petals`, [0.63, 0.43, 0.74], 0.12);
    const foliage = surface(scene, `${name}-foliage`, [0.23, 0.43, 0.27]);
    for (const [index, [x, y, z, size, turn]] of (
      [
        [0, 0.55, 0, 0.34, 0.24],
        [-0.27, 0.37, 0.14, 0.22, 0.85],
        [0.24, 0.43, -0.17, 0.24, 0.48],
      ] as const
    ).entries()) {
      stem(
        `growth-ribs-stem-${index}`,
        [
          [x * 0.38, 0.08, z * 0.38 - 0.05],
          [x * 0.75, y * 0.52, z * 0.68],
          [x, y, z],
        ],
        size * 0.15,
        leaf,
      );
      for (let petal = 0; petal < 5; petal++) {
        const angle = (petal * Math.PI * 2) / 5 + turn;
        plate(
          `growth-canopy-petal-${index}-${petal}`,
          [
            x + Math.sin(angle) * size * 0.42,
            y,
            z + Math.cos(angle) * size * 0.42,
          ],
          [size * 0.75, size * 0.17, size],
          petals,
          "blade",
        ).rotation.set(-0.64, angle, 0);
      }
      if (index > 0)
        plate(
          `growth-canopy-bud-${index}`,
          [x, y + size * 0.18, z],
          [size * 0.58, size * 0.65, size * 0.58],
          core,
        );
    }
    for (const [index, [angle, radius, y, width, length]] of (
      [
        [0.08, 0.2, 0.21, 0.33, 0.59],
        [1.54, 0.19, 0.23, 0.28, 0.52],
        [2.63, 0.17, 0.21, 0.32, 0.52],
        [3.56, 0.18, 0.22, 0.34, 0.56],
        [4.91, 0.19, 0.24, 0.29, 0.55],
      ] as const
    ).entries()) {
      plate(
        `growth-canopy-leaf-${index}`,
        [Math.sin(angle) * radius, y, Math.cos(angle) * radius],
        [width, 0.13, length],
        foliage,
        "blade",
      ).rotation.set(-0.2, angle, 0.12);
    }
  },
};

const CIRCLE_STRUCTURES = {
  "circle-heartgrove": {
    halfWidth: 1.15,
    halfDepth: 1.3,
    height: 4,
    frame: "tree",
    focusHeight: 2.26,
    owned: true,
    ownerMarks: [
      [0, 1.55, 1.16],
      [-0.87, 1.18, 0.2],
      [0.87, 1.18, 0.2],
    ],
    entrance: { z: 1.12, width: 0.8, height: 1.05 },
  },
  "circle-conservatory": {
    halfWidth: 1.3,
    halfDepth: 0.8,
    height: 1.5,
    frame: "basin",
    focusHeight: 0.54,
    owned: true,
    ownerMarks: [
      [-0.93, 0.85, 0.29],
      [0.93, 0.85, 0.29],
    ],
  },
  "circle-musterhall": {
    halfWidth: 0.85,
    halfDepth: 1.3,
    height: 2.1,
    frame: "hall",
    focusHeight: 0.65,
    owned: true,
    ownerMarks: [
      [0, 1.99, 1.33],
      [-0.76, 1.27, 0.37],
      [0.76, 1.27, 0.37],
    ],
    entrance: { z: 1.32, width: 1.2, height: 1.35, bladePanels: true },
  },
  "circle-construct-nursery": {
    halfWidth: 1.3,
    halfDepth: 1.3,
    height: 2.2,
    frame: "cradle",
    focusHeight: 0.42,
    owned: true,
    ownerMarks: [
      [0, 2.07, 1.35],
      [-1.11, 1.17, 0.42],
      [1.11, 1.17, 0.42],
      [0, 1.72, -1.075],
    ],
    entrance: {
      z: 1.22,
      width: 2.12,
      height: 1.35,
      bladePanels: true,
      panelWidth: 0.58,
    },
  },
  "circle-thornspire": {
    halfWidth: 0.45,
    halfDepth: 0.45,
    height: 2.6,
    frame: "spire",
    focusHeight: 1.1,
    owned: true,
    ownerMarks: [
      [0.12, 1.05, 0.29],
      [0.2, 1.05, -0.23],
      [-0.27, 1.05, -0.07],
    ],
  },
  "cultivation-site": {
    halfWidth: 0.36,
    halfDepth: 0.38,
    height: 0.7,
    frame: "bloom",
    focusHeight: 0.62,
    focusScale: [0.26, 0.23, 0.26],
    owned: false,
  },
} satisfies Record<string, StructureRecipe>;
type CircleStructureId = keyof typeof CIRCLE_STRUCTURES;

/**
 * Materials for living damage, named by stage so presentation can select
 * them after merging or skinning.
 */
function livingDamageMaterials(scene: Scene, prefix: string) {
  const finish = (part: string, color: Vec3, glow = 0) =>
    surface(scene, `${prefix}-${part}`, color, glow);
  return {
    crack: finish("damage-moderate-crack", [0.1, 0.06, 0.04]),
    // Leaks go dark with the rest of a fallen construct's light.
    leak: finish("damage-moderate-leak-fading-light", [0.62, 0.32, 0.95], 0.9),
    split: finish("damage-critical-split", [0.06, 0.04, 0.03]),
    splinter: finish("damage-critical-splinter", [0.9, 0.82, 0.6]),
    wilted: finish("damage-critical-wilted", [0.36, 0.3, 0.14]),
    flicker: finish("damage-critical-flicker", [0.7, 0.36, 1], 1),
  };
}

type Rib = { points: readonly Vec3[]; radius: number };
type Plate = { position: Vec3; size: Vec3 };

/**
 * Broken shapes for living damage. `damage-moderate` meshes crack plates and
 * leak faint violet light; `damage-critical` meshes add deeper splits,
 * splinters, drooping foliage, and a flickering leak. Presentation selects
 * them by health.
 */
function addLivingDamage(
  scene: Scene,
  name: string,
  root: TransformNode,
  ribs: readonly Rib[],
  plates: readonly Plate[],
  seed: number,
) {
  const { crack, leak, split, splinter, wilted, flicker } =
    livingDamageMaterials(scene, name);
  const random = seededRandom(seed);
  /** A point on a rib's surface, facing away from the building's axis. */
  const onRib = () => {
    const rib = ribs[Math.floor(random() * ribs.length)]!;
    const segment = Math.floor(random() * (rib.points.length - 1));
    const t = 0.2 + random() * 0.6;
    const [a, b] = [rib.points[segment]!, rib.points[segment + 1]!];
    const at = Vector3.Lerp(Vector3.FromArray(a), Vector3.FromArray(b), t);
    const along = Vector3.FromArray(b).subtract(Vector3.FromArray(a));
    let out = new Vector3(at.x, 0, at.z);
    if (out.lengthSquared() < 0.01)
      out = new Vector3(Math.cos(random() * 7), 0, Math.sin(random() * 7));
    out.normalize();
    return { at: at.add(out.scale(rib.radius * 0.9)), along, out, rib };
  };
  const part = (
    id: string,
    material: typeof crack,
    position: Vector3,
    size: Vec3,
    along: Vector3,
    out: Vector3,
    shape: "box" | "cone" | "sphere" = "box",
  ) => {
    const mesh =
      shape === "box"
        ? MeshBuilder.CreateBox(`${name}-${id}`, { size: 1 }, scene)
        : shape === "cone"
          ? MeshBuilder.CreateCylinder(
              `${name}-${id}`,
              { height: 1, diameterTop: 0, diameterBottom: 1, tessellation: 5 },
              scene,
            )
          : MeshBuilder.CreateSphere(
              `${name}-${id}`,
              { diameter: 1, segments: 5 },
              scene,
            );
    mesh.parent = root;
    mesh.material = material;
    mesh.position.copyFrom(position);
    mesh.scaling.set(...size);
    // Local Y runs along the rib; local Z faces outward.
    const up = along.normalizeToNew();
    const side = Vector3.Cross(up, out).normalize();
    const forward = Vector3.Cross(side, up).normalize();
    mesh.rotationQuaternion = Quaternion.FromLookDirectionLH(forward, up);
    return mesh;
  };
  for (let i = 0; i < 6; i++) {
    const { at, along, out, rib } = onRib();
    part(
      `damage-moderate-crack-${i}`,
      crack,
      at,
      [Math.min(rib.radius * 0.7, 0.12), Math.min(rib.radius * 5, 0.55), 0.05],
      along,
      out,
    );
  }
  for (let i = 0; i < 3; i++) {
    const { at, along, out } = onRib();
    part(
      `damage-moderate-leak-${i}`,
      leak,
      at,
      [0.09, 0.14, 0.09],
      along,
      out,
      "sphere",
    );
  }
  for (let i = 0; i < 5; i++) {
    const { at, along, out, rib } = onRib();
    part(
      `damage-critical-split-${i}`,
      split,
      at,
      [Math.min(rib.radius * 1.3, 0.2), Math.min(rib.radius * 8, 0.85), 0.08],
      along,
      out,
    );
    part(
      `damage-critical-splinter-${i}`,
      splinter,
      at.add(out.scale(0.08)),
      [0.06, 0.32, 0.06],
      out.add(along.normalizeToNew().scale(0.4)),
      along,
      "cone",
    );
  }
  for (let i = 0; i < 2; i++) {
    const { at, along, out } = onRib();
    part(
      `damage-critical-flicker-${i}`,
      flicker,
      at,
      [0.13, 0.22, 0.13],
      along,
      out,
      "sphere",
    );
  }
  // Wilted leaves hang from the outer edge of canopy plates.
  for (const [i, plate] of plates.entries()) {
    if (i % 2) continue;
    const [x, y, z] = plate.position;
    let out = new Vector3(x, 0, z);
    if (out.lengthSquared() < 0.01) out = new Vector3(0, 0, 1);
    out.normalize();
    const reach = Math.max(plate.size[0], plate.size[2]) * 0.45;
    part(
      `damage-critical-wilted-${i}`,
      wilted,
      new Vector3(x, y - plate.size[1] * 0.4, z).add(out.scale(reach)),
      [plate.size[0] * 0.45, plate.size[1] * 1.6, 0.08],
      new Vector3(0, 1, 0).add(out.scale(0.5)),
      out,
      "sphere",
    );
  }
}

/**
 * Two leaf panels hinge at the sides of a producer's entrance and swing
 * outward while a violet glow swells on the threshold.
 */
function addEntrance(
  scene: Scene,
  name: string,
  root: TransformNode,
  {
    z,
    width,
    height,
    bladePanels,
    panelWidth = width / 2,
  }: NonNullable<StructureRecipe["entrance"]>,
  leaf: StandardMaterial,
  core: StandardMaterial,
) {
  const hinges = ([-1, 1] as const).map((side) => {
    const hinge = new TransformNode(`${name}-entrance-hinge-${side}`, scene);
    hinge.parent = root;
    hinge.position.set((side * width) / 2, 0, z);
    hinge.rotation.y = side * ENTRANCE_REST_ANGLE;
    const panelName = `${name}-growth-canopy-entrance-${side}`;
    const panel = bladePanels
      ? leafBlade(scene, panelName)
      : MeshBuilder.CreateSphere(
          panelName,
          { diameter: 1, segments: 6 },
          scene,
        );
    panel.parent = hinge;
    panel.material = leaf;
    panel.position.set((-side * panelWidth) / 2, height / 2, 0);
    if (bladePanels) {
      panel.rotation.x = Math.PI / -2;
      panel.scaling.set(panelWidth, 0.19, height);
    } else {
      panel.scaling.set(panelWidth, height, 0.08);
    }
    return { hinge, side };
  });
  const glow = MeshBuilder.CreateSphere(
    `${name}-growth-canopy-entrance-glow`,
    { diameter: 1, segments: 8 },
    scene,
  );
  glow.parent = root;
  glow.material = core;
  glow.position.set(0, height * 0.4, z);
  const rest = 0.001;
  glow.scaling.setAll(rest);
  return () =>
    clip(
      root,
      "exit",
      EXIT_SECONDS,
      (seconds) => {
        const open = Math.sin((seconds / EXIT_SECONDS) * Math.PI);
        for (const { hinge, side } of hinges)
          hinge.rotation.y =
            side *
            (ENTRANCE_REST_ANGLE +
              (ENTRANCE_OPEN_ANGLE - ENTRANCE_REST_ANGLE) * open);
        const pulse = open ** 2;
        glow.scaling.set(
          rest + width * 0.55 * pulse,
          rest + height * 0.7 * pulse,
          rest + 0.12 * pulse,
        );
      },
      false,
    );
}

/** Named growth layers let presentation reveal living architecture in thirds. */
function buildCircleStructure(scene: Scene, name: CircleStructureId) {
  const recipe: StructureRecipe = CIRCLE_STRUCTURES[name];
  const root = new TransformNode(name, scene);
  const finish = (part: string, color: Vec3, glow = 0) =>
    surface(scene, `${name}-${part}`, color, glow);
  const wood = finish("wood", [0.82, 0.74, 0.52]);
  const bark = finish("roots", [0.28, 0.19, 0.12]);
  const leaf = finish(
    "leaves",
    recipe.frame === "tree" ? [0.19, 0.45, 0.26] : [0.12, 0.34, 0.22],
  );
  const core = finish("core", CORE_LIGHT, CORE_GLOW);
  const ribs: Rib[] = [];
  const plates: Plate[] = [];
  const stem: FrameContext["stem"] = (id, points, radius, material = wood) => {
    if (id.startsWith("growth-ribs")) ribs.push({ points, radius });
    return place(tube(scene, `${name}-${id}`, points, radius, 7), {
      parent: root,
      material,
    });
  };
  const plate: FrameContext["plate"] = (
    id,
    position,
    size,
    material = leaf,
    shape,
  ) => {
    const meshName = `${name}-${id}`;
    const mesh = place(
      shape === "blade"
        ? leafBlade(scene, meshName)
        : MeshBuilder.CreateSphere(
            meshName,
            { diameter: 1, segments: 6 },
            scene,
          ),
      { parent: root, material, position, scaling: size },
    );
    if (id.startsWith("growth-canopy") && material === leaf)
      plates.push({ position, size });
    return mesh;
  };
  const { halfWidth, halfDepth, height } = recipe;
  for (let index = 0; index < 6; index++) {
    const angle = (index * Math.PI) / 3;
    const x = Math.cos(angle) * halfWidth;
    const z = Math.sin(angle) * halfDepth;
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
  const addFrameClips = FRAMES[recipe.frame]({
    name,
    scene,
    root,
    recipe,
    wood,
    bark,
    leaf,
    core,
    stem,
    plate,
  });
  const addExitClip =
    recipe.entrance &&
    addEntrance(scene, name, root, recipe.entrance, leaf, core);
  if (recipe.owned) {
    const owner = finish("owner", OWNER_MARK);
    const marks = recipe.ownerMarks ?? [[0, height * 0.62, halfDepth * 0.85]];
    for (const [index, position] of marks.entries())
      plate(`growth-canopy-owner-${index}`, position, [0.35, 0.3, 0.12], owner);
  }
  const focusScale = recipe.focusScale ?? [0.3, 0.45, 0.3];
  const pulse = plate(
    "growth-canopy-focus",
    [0, recipe.focusHeight, 0],
    focusScale,
    core,
  );
  if (recipe.owned)
    addLivingDamage(
      scene,
      name,
      root,
      ribs,
      plates,
      [...name].reduce((sum, c) => Math.imul(sum, 31) + c.charCodeAt(0), 7),
    );
  // Keep the animated focus separate; static parts batch by layer.
  for (const layer of [
    "growth-roots",
    "growth-ribs",
    "growth-canopy",
    "damage-moderate",
    "damage-critical",
  ]) {
    const layerParts = root
      .getChildMeshes<Mesh>(true)
      .filter(
        (mesh) =>
          mesh.name.includes(layer) &&
          mesh !== pulse &&
          !mesh.name.endsWith("entrance-glow"),
      );
    for (const [material, parts] of byMaterial(layerParts))
      merge(root, `${name}-${layer}-${material.name}`, parts, material);
  }
  clip(
    root,
    "idle",
    2,
    (seconds) => {
      pulse.scaling.set(
        focusScale[0],
        focusScale[1] * (1 + Math.sin(seconds * Math.PI) * 0.12),
        focusScale[2],
      );
    },
    false,
  );
  addFrameClips?.();
  addExitClip?.();
}

/**
 * A low, broad living construct facing +Z: pale armor plates over dark
 * joints, a sheltered violet core, and a thorn-framed head that strikes.
 */
function briarRam(scene: Scene, name: string) {
  const root = new TransformNode(name, scene);
  const armor = surface(scene, "ram-armor", [0.95, 0.85, 0.65]);
  const bark = surface(scene, "ram-bark", [0.43, 0.32, 0.2]);
  const joints = surface(scene, "ram-joints", [0.3, 0.24, 0.16]);
  const foliage = surface(scene, "ram-foliage", [0.19, 0.39, 0.25]);
  const core = surface(scene, "ram-core-fading-light", CORE_LIGHT, CORE_GLOW);
  const owner = surface(scene, "ram-owner", OWNER_MARK);
  const plate = (
    id: string,
    scaling: Vec3,
    position: Vec3,
    material: StandardMaterial,
    parent = root,
  ) => place(leafBlade(scene, id), { parent, material, position, scaling });
  const branch = (
    id: string,
    points: readonly Vec3[],
    radii: readonly number[],
    material: StandardMaterial,
    parent = root,
  ) => place(tube(scene, id, points, radii), { parent, material });
  plate("ram-body", [1.06, 0.65, 1.48], [0, 0.77, -0.03], joints);
  plate("ram-core", [0.49, 0.22, 0.46], [0, 0.75, 0.38], core).rotation.x =
    -0.65;
  // Pale plates overlap toward the tail. Dark leaf edges frame the seams.
  for (const [index, [width, y, z]] of [
    [0.88, 0.99, -0.46],
    [1.05, 1.07, -0.18],
    [1.21, 1.09, 0.14],
    [1.12, 1.05, 0.39],
  ].entries()) {
    plate(
      `ram-seam-${index}`,
      [width!, 0.23, 0.6],
      [0, y!, z! - 0.07],
      foliage,
    );
    plate(`ram-plate-${index}`, [width!, 0.28, 0.59], [0, y!, z!], armor);
  }
  for (const side of [-1, 1]) {
    plate(
      `ram-flank-${side}`,
      [0.39, 0.17, 1.02],
      [side * 0.43, 0.86, -0.03],
      bark,
    ).rotation.z = -side * 1.14;
    plate(
      `ram-shoulder-${side}`,
      [0.37, 0.15, 0.69],
      [side * 0.42, 0.91, 0.28],
      armor,
    ).rotation.set(-0.24, -side * 0.09, -side * 0.95);
    plate(
      `ram-shoulder-mark-${side}`,
      [0.24, 0.055, 0.46],
      [side * 0.501, 0.978, 0.3],
      owner,
    ).rotation.set(-0.24, -side * 0.09, -side * 0.95);
    plate(
      `ram-rear-mark-${side}`,
      [0.25, 0.07, 0.46],
      [side * 0.269, 1.05, -0.54],
      owner,
    ).rotation.set(-0.34, side * 0.27, -side * 0.4);
  }
  const head = new TransformNode("ram-head", scene);
  head.parent = root;
  head.position.set(0, 0.78, 0.56);
  plate("ram-skull", [0.57, 0.43, 0.59], [0, 0.02, 0.18], joints, head);
  plate(
    "ram-brow",
    [0.65, 0.22, 0.55],
    [0, 0.13, 0.16],
    armor,
    head,
  ).rotation.x = 0.42;
  plate(
    "ram-muzzle",
    [0.46, 0.24, 0.35],
    [0, -0.08, 0.36],
    bark,
    head,
  ).rotation.y = Math.PI;
  plate(
    "ram-brow-mark",
    [0.24, 0.06, 0.29],
    [0, 0.255, 0.15],
    owner,
    head,
  ).rotation.x = 0.42;
  for (const side of [-1, 1]) {
    branch(
      `ram-thorn-${side}`,
      [
        [side * 0.2, -0.03, 0.22],
        [side * 0.35, 0.02, 0.29],
        [side * 0.41, 0.1, 0.43],
        [side * 0.37, 0.22, 0.55],
        [side * 0.29, 0.35, 0.58],
      ],
      [0.116, 0.106, 0.078, 0.044, 0.001],
      armor,
      head,
    );
    plate(
      `ram-eye-${side}`,
      [0.062, 0.06, 0.13],
      [side * 0.212, 0.09, 0.297],
      core,
      head,
    ).rotation.y = side * 0.38;
  }
  for (const side of [-1, 1])
    plate(
      `ram-core-vent-${side}`,
      [0.135, 0.2, 0.34],
      [side * 0.43, 0.75, 0.29],
      core,
    ).rotation.set(-0.18, -side * 0.22, -side * 0.46);
  const hips = [
    [-0.36, 0.4],
    [0.36, 0.4],
    [-0.32, -0.48],
    [0.32, -0.48],
  ].map(([x, z], index) => {
    const hip = new TransformNode(`ram-leg-${index}`, scene);
    hip.parent = root;
    hip.position.set(x!, 0.72, z!);
    const side = Math.sign(x!);
    const front = Math.sign(z!);
    branch(
      `ram-root-${index}`,
      [
        [0, 0.08, 0],
        [side * 0.07, -0.21, front * 0.07],
        [side * 0.045, -0.47, -0.09],
        [side * 0.065, -0.65, -0.025],
      ],
      [0.18, 0.151, 0.105, 0.118],
      joints,
      hip,
    );
    plate(
      `ram-shin-${index}`,
      [0.29, 0.18, 0.38],
      [side * 0.075, -0.32, front * 0.05 + 0.08],
      bark,
      hip,
    ).rotation.x = -1.42;
    plate(
      `ram-foot-${index}`,
      [0.33, 0.21, 0.39],
      [side * 0.063, -0.66, 0.033],
      armor,
      hip,
    ).rotation.y = side * 0.13;
    return hip;
  });
  // Stage-named materials skin each damage stage into its own mesh.
  const { crack, leak, split, splinter, flicker } = livingDamageMaterials(
    scene,
    "ram",
  );
  const sliver = (
    id: string,
    scaling: Vec3,
    position: Vec3,
    rotation: Vec3,
    material: StandardMaterial,
    parent = root,
  ) =>
    place(MeshBuilder.CreateBox(id, { size: 1 }, scene), {
      parent,
      material,
      position,
      rotation,
      scaling,
    });
  // Cracks cross the back plates and flanks.
  for (const [i, [x, y, z]] of (
    [
      [0.22, 1.22, 0.15],
      [-0.17, 1.2, -0.16],
      [0.08, 1.136, -0.45],
    ] as const
  ).entries()) {
    branch(
      `ram-damage-moderate-crack-${i}`,
      [
        [x - 0.17, y - 0.012, z - 0.16],
        [x - 0.07, y + 0.01, z - 0.04],
        [x + 0.03, y + 0.003, z - 0.025],
        [x + 0.15, y - 0.025, z + 0.14],
      ],
      [0.005, 0.035, 0.032, 0.006],
      crack,
    );
    branch(
      `ram-damage-moderate-fork-${i}`,
      [
        [x - 0.07, y + 0.01, z - 0.04],
        [x - 0.13, y - 0.005, z + 0.027],
        [x - 0.21, y - 0.034, z + 0.05],
      ],
      [0.024, 0.017, 0.004],
      crack,
    );
  }
  for (const side of [-1, 1])
    sliver(
      `ram-damage-moderate-crack-flank-${side}`,
      [0.035, 0.22, 0.055],
      [side * 0.503, 0.89, -0.18],
      [side * 0.36, 0, -side * 0.44],
      crack,
    );
  sliver(
    "ram-damage-moderate-crack-head",
    [0.04, 0.02, 0.22],
    [0.126, 0.22, 0.21],
    [0.37, 0.42, 0],
    crack,
    head,
  );
  plate(
    "ram-damage-moderate-leak-0",
    [0.1, 0.07, 0.13],
    [0.17, 1.216, 0.12],
    leak,
  );
  plate(
    "ram-damage-moderate-leak-1",
    [0.08, 0.16, 0.11],
    [-0.49, 0.82, -0.18],
    leak,
  );
  // Lift the broken inner edge of each split plate above the shell.
  const brokenLip = loft([
    [
      [-0.48, -0.45, -0.42],
      [0.04, -0.45, -0.5],
      [0.46, -0.45, -0.17],
      [0.28, -0.45, 0.5],
      [-0.46, -0.45, 0.28],
    ],
    [
      [-0.42, -0.06, -0.4],
      [0.02, 0.38, -0.44],
      [0.4, 0.51, -0.17],
      [0.22, 0.22, 0.43],
      [-0.4, 0.06, 0.27],
    ],
  ]);
  for (const [i, [x, y, z, turn]] of (
    [
      [-0.02, 1.237, 0.3, 0.62],
      [0.1, 1.204, -0.27, -0.62],
    ] as const
  ).entries()) {
    const bend = Math.sign(turn);
    branch(
      `ram-damage-critical-split-${i}`,
      [
        [x - bend * 0.22, y - 0.055, z - 0.25],
        [x - bend * 0.09, y, z - 0.11],
        [x + bend * 0.035, y + 0.006, z - 0.025],
        [x + bend * 0.025, y - 0.005, z + 0.1],
        [x + bend * 0.2, y - 0.047, z + 0.26],
      ],
      [0.014, 0.061, 0.07, 0.054, 0.012],
      split,
    );
    place(
      MeshBuilder.CreatePolyhedron(
        `ram-damage-critical-splinter-${i}`,
        { custom: brokenLip },
        scene,
      ),
      {
        parent: root,
        material: splinter,
        position: [x - 0.17, y + 0.012, z],
        rotation: [0.13, turn, -0.42],
        scaling: [0.29, 0.25, 0.4],
      },
    );
  }
  sliver(
    "ram-damage-critical-split-flank",
    [0.03, 0.4, 0.1],
    [0.51, 0.89, -0.16],
    [0.44, 0, -0.3],
    split,
  );
  plate(
    "ram-damage-critical-flicker-0",
    [0.16, 0.12, 0.12],
    [0.39, 0.77, 0.39],
    flicker,
  );
  plate(
    "ram-damage-critical-flicker-1",
    [0.12, 0.1, 0.12],
    [-0.01, 1.235, 0.34],
    flicker,
  );
  skin(root);
  const restHead = head.position.clone();
  clip(root, "idle", 3, (seconds) => {
    head.rotation.x = Math.sin((seconds / 3) * Math.PI * 2) * 0.03;
  });
  // Diagonal pairs step together with deliberate, planted feet.
  clip(root, "walk", 1.4, (seconds) => {
    const phase = (seconds / 1.4) * Math.PI * 2;
    hips.forEach((hip, index) => {
      hip.rotation.x =
        Math.sin(phase + (index === 0 || index === 3 ? 0 : Math.PI)) * 0.38;
    });
    root.position.y = (1 - Math.cos(phase * 2)) * 0.02;
    head.rotation.x = Math.sin(phase * 2) * 0.03;
  });
  for (const [turn, sign] of [
    ["turn-left", -1],
    ["turn-right", 1],
  ] as const)
    clip(
      root,
      turn,
      0.4,
      (seconds) => {
        const amount = seconds / 0.4;
        root.rotation.z = -sign * amount * 0.06;
        head.rotation.y = sign * amount * 0.15;
      },
      false,
    );
  clip(
    root,
    "hit",
    0.4,
    (seconds) => {
      const flinch = Math.sin((seconds / 0.4) * Math.PI);
      head.rotation.x = -flinch * 0.15;
      root.rotation.z = flinch * 0.05;
    },
    false,
  );
  // The hit is already committed when this clip starts. Lunge, then settle.
  clip(
    root,
    "strike",
    0.6,
    (seconds) => {
      const t = seconds / 0.6;
      const travel = t < 0.2 ? t / 0.2 : (1 - t) / 0.8;
      const blow = travel ** 2;
      head.rotation.x = blow * 0.19;
      head.position.z = restHead.z + blow * 0.23;
      head.position.y = restHead.y - blow * 0.05;
      root.position.z = blow * 0.12;
    },
    false,
  );
  // Legs buckle outward and the body settles into an inert husk.
  clip(root, "death", 1.2, (seconds) => {
    const fall = (seconds / 1.2) ** 2;
    hips.forEach((hip, index) => {
      hip.rotation.z = (index % 2 ? -1 : 1) * fall * 1.1;
    });
    root.position.y = -fall * 0.42;
    root.rotation.z = fall * 0.18;
    head.rotation.x = fall * 0.4;
  });
}

/** Broken Circle ribs fold over a root bed and leave embers at the breaks. */
function livingRubble(scene: Scene, name: string) {
  const root = new TransformNode(name, scene);
  const pieces = batches(root, {
    wood: surface(scene, "living-rubble-wood", [0.84, 0.71, 0.48]),
    roots: surface(scene, "living-rubble-roots", [0.29, 0.2, 0.13]),
    leaves: surface(scene, "living-rubble-leaves", [0.15, 0.35, 0.23]),
    "fading-light": surface(
      scene,
      "living-rubble-fading-light",
      [0.65, 0.35, 0.93],
      0.95,
    ),
  });
  const branch = (
    part: "wood" | "roots",
    knots: readonly (readonly [number, number, number, number])[],
  ) =>
    pieces.add(
      part,
      tube(
        scene,
        `${part}-${pieces.count(part)}`,
        knots.map(([x, y, z]) => [x, y, z]),
        knots.map(([, , , radius]) => radius),
      ),
    );
  branch("roots", [
    [-0.39, -0.46, 0.09, 0.013],
    [-0.23, -0.43, 0.01, 0.056],
    [-0.08, -0.36, -0.01, 0.099],
    [0.18, -0.43, 0.1, 0.068],
    [0.35, -0.46, 0.23, 0.012],
  ]);
  branch("roots", [
    [-0.18, -0.46, 0.32, 0.018],
    [-0.08, -0.35, 0.16, 0.06],
    [-0.13, -0.32, -0.03, 0.068],
    [0.03, -0.41, -0.18, 0.059],
    [0.13, -0.47, -0.39, 0.012],
  ]);
  branch("roots", [
    [0.04, -0.43, 0.36, 0.02],
    [0.19, -0.37, 0.18, 0.043],
    [0.23, -0.32, 0.01, 0.055],
    [0.39, -0.47, -0.15, 0.014],
  ]);
  // The thicker ribs break across a gap before folding over the roots.
  branch("wood", [
    [-0.31, -0.39, -0.16, 0.087],
    [-0.21, -0.18, -0.14, 0.083],
    [-0.1, 0.04, -0.06, 0.063],
    [0.06, 0.13, 0.01, 0.045],
  ]);
  branch("wood", [
    [-0.34, -0.39, 0.17, 0.056],
    [-0.21, -0.21, 0.19, 0.062],
    [-0.055, -0.05, 0.15, 0.05],
    [0.094, -0.005, 0.16, 0.025],
  ]);
  branch("wood", [
    [0.34, -0.39, -0.08, 0.06],
    [0.27, -0.29, -0.035, 0.051],
    [0.2, -0.15, 0.01, 0.04],
    [0.15, -0.075, 0.048, 0.028],
  ]);
  branch("wood", [
    [0.1, -0.32, -0.29, 0.026],
    [0.17, -0.2, -0.22, 0.037],
    [0.18, -0.26, -0.09, 0.027],
  ]);
  for (const [index, [x, y, z, angle, length]] of (
    [
      [-0.09, -0.31, -0.23, 1.4, 0.34],
      [0.03, -0.25, -0.23, 0.66, 0.34],
      [0.2, -0.3, 0.12, 1, 0.44],
      [0.13, -0.36, 0.26, 2.8, 0.28],
      [-0.2, -0.33, 0.21, -0.85, 0.32],
    ] as const
  ).entries()) {
    pieces.add(
      "leaves",
      place(leafBlade(scene, `leaf-${index}`), {
        position: [x, y, z],
        rotation: [0.33, angle, -0.24],
        scaling: [0.22, 0.15, length],
      }),
    );
  }
  for (const [index, [x, y, z, size]] of (
    [
      [0.079, 0.057, 0.024, 0.064],
      [0.177, -0.137, 0.036, 0.046],
      [0.02, -0.3, 0.11, 0.048],
    ] as const
  ).entries()) {
    pieces.add(
      "fading-light",
      place(
        MeshBuilder.CreatePolyhedron(
          `ember-${index}`,
          { type: 1, size },
          scene,
        ),
        { position: [x, y, z], rotation: [-0.3, 0.25, 0.48] },
      ),
    );
  }
  pieces.merge();
}

/** Every Circle model builder, keyed by asset ID. */
export const CIRCLE_MODELS = {
  ...(Object.fromEntries(
    (Object.keys(CIRCLE_STRUCTURES) as CircleStructureId[]).map((id) => [
      id,
      (scene: Scene) => buildCircleStructure(scene, id),
    ]),
  ) as Record<CircleStructureId, (scene: Scene) => void>),
  "circle-briar-ram": briarRam,
  "living-rubble": livingRubble,
};
