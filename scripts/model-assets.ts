import {
  Bone,
  Color3,
  Matrix,
  Mesh,
  MeshBuilder,
  Quaternion,
  Skeleton,
  StandardMaterial,
  TransformNode,
  Vector3,
  VertexData,
} from "@babylonjs/core";

import { createBarracksDetails } from "../src/render/barracks.ts";
import {
  BITE_COLOR,
  BOLT_COLOR,
  ROCKET_COLOR,
  STRIKE_COLOR,
  TRACER_COLOR,
} from "../src/render/combat-effects.ts";
import { createCommandCenterDetails } from "../src/render/command-center.ts";
import {
  addHarvesterWorkParts,
  createHarvesterBody,
  HARVESTER_IDLE_LIGHT,
  HARVESTER_WORK_LIGHT,
} from "../src/render/harvester.ts";
import {
  MATERIALS_COLOR,
  SALVAGE_COLOR,
} from "../src/render/materials-sites.ts";
import { createRefineryDetails } from "../src/render/refinery.ts";
import { createRelayDetails } from "../src/render/relay.ts";
import { createSentryDetails } from "../src/render/sentry.ts";
import { createWolfParts } from "../src/render/wolf.ts";
import {
  CIRCLE_MODELS,
  LEAF_BLADE,
  livingDamageMaterials,
} from "./circle-models.ts";
import { exportGlb, rigidSkin } from "./glb-export.ts";
import { clip, merge, surface, unlit } from "./model-toolkit.ts";
import { seededRandom } from "./sprite-sheet.ts";

import type { Scene } from "@babylonjs/core";
import type { TilePlacedActorDetailsFactory } from "../src/render/tile-placed-actor-view.ts";

/**
 * Rigid weights preserve the part hierarchy while exporting a real skin.
 * Static pieces share the body bone and moving pieces bind to their pivots.
 */
function skin(root: TransformNode) {
  const scene = root.getScene();
  const parts = root
    .getChildMeshes()
    .filter(
      (mesh): mesh is Mesh =>
        mesh instanceof Mesh && mesh.getTotalVertices() > 0,
    );
  const vertices = parts.map((part) => {
    const data = VertexData.ExtractFromMesh(part);
    data.transform(part.computeWorldMatrix(true));
    return data;
  });
  const body = new TransformNode(`${root.name}-body-joint`, scene);
  body.parent = root;
  const joints = parts.map((part) =>
    part.parent === root ? body : (part.parent as TransformNode),
  );
  const skeleton = new Skeleton(`${root.name}-rig`, `${root.name}-rig`, scene);
  const bones = new Map<TransformNode, Bone>();
  const add = (node: TransformNode): Bone | null => {
    if (node === root) return null;
    if (bones.has(node)) return bones.get(node)!;
    const parent =
      node.parent instanceof TransformNode ? add(node.parent) : null;
    const matrix = Matrix.Compose(
      node.scaling,
      Quaternion.FromEulerVector(node.rotation),
      node.position,
    );
    const bone = new Bone(node.name, skeleton, parent, matrix);
    bone.linkTransformNode(node);
    bones.set(node, bone);
    return bone;
  };
  for (const joint of joints) add(joint);
  const pieces = parts.map((part, index) => ({
    material: part.material!,
    vertices: vertices[index]!,
    bone: skeleton.bones.indexOf(bones.get(joints[index]!)!),
  }));
  for (const material of new Set(pieces.map((piece) => piece.material)))
    rigidSkin(
      `${root.name}-${material.name}-skin`,
      pieces.filter((piece) => piece.material === material),
      skeleton,
      material,
      root,
    );
  for (const part of parts) part.dispose(false, false);
}

function wolf(scene: Scene, name: string) {
  const { root, head, jaw, tail, limbs } = createWolfParts(scene, name);
  skin(root);
  clip(root, "idle", 2, (seconds) => {
    const breath = Math.sin(seconds * Math.PI);
    head.rotation.x = -0.15 + breath * 0.025;
    tail.rotation.y = breath * 0.075;
  });
  clip(root, "walk", 1, (seconds) => {
    const phase = seconds * Math.PI * 2;
    limbs.forEach(({ hip, knee }, index) => {
      const stride = Math.sin(
        phase + (index === 0 || index === 3 ? 0 : Math.PI),
      );
      hip.rotation.x = stride * 0.49;
      knee.rotation.x = Math.max(0, -stride) * (index < 2 ? 0.42 : -0.38);
    });
    tail.rotation.y = Math.sin(phase) * 0.13;
  });
  clip(root, "run", 1, (seconds) => {
    const phase = seconds * Math.PI * 2;
    limbs.forEach(({ hip, knee }, index) => {
      const stride = Math.sin(
        phase + (index < 2 ? 0 : Math.PI) + (index % 2) * 0.64,
      );
      hip.rotation.x = stride * 0.76;
      knee.rotation.x = Math.max(0, -stride) * (index < 2 ? 0.7 : -0.64);
    });
    root.position.y = (1 - Math.cos(phase * 2)) * 0.025;
    head.rotation.x = -0.15 - Math.sin(phase) * 0.09;
    tail.rotation.x = -0.18 + Math.sin(phase) * 0.12;
  });
  for (const [turn, sign] of [
    ["turn-left", -1],
    ["turn-right", 1],
  ] as const)
    clip(
      root,
      turn,
      0.3,
      (seconds) => {
        const amount = seconds / 0.3;
        root.rotation.z = -sign * amount * 0.12;
        head.rotation.y = sign * amount * 0.18;
        tail.rotation.y = -sign * amount * 0.2;
      },
      false,
    );
  clip(
    root,
    "hit",
    0.35,
    (seconds) => {
      const flinch = Math.sin((seconds / 0.35) * Math.PI);
      head.rotation.x = -0.15 + flinch * 0.3;
      root.rotation.z = flinch * 0.12;
      tail.rotation.x = flinch * 0.33;
    },
    false,
  );
  clip(
    root,
    "bite",
    0.4,
    (seconds) => {
      const lunge = Math.sin((seconds / 0.4) * Math.PI);
      head.rotation.x = -0.15 - lunge * 0.36;
      root.position.z = lunge * 0.18;
      jaw.rotation.x = Math.sin((seconds / 0.4) ** 0.65 * Math.PI) * 0.58;
    },
    false,
  );
  clip(root, "death", 0.8, (seconds) => {
    const fall = (seconds / 0.8) ** 2;
    const buckle = Math.sin((seconds / 0.8) * Math.PI);
    root.rotation.z = (fall * Math.PI) / 2;
    root.position.y = fall * 0.202 - buckle * 0.05;
    head.rotation.x = -0.15 + fall * 0.24;
    tail.rotation.y = -fall * 0.46;
    limbs.forEach(({ hip, knee }, index) => {
      hip.rotation.x = fall * (index < 2 ? -0.42 : 0.31);
      knee.rotation.x = (fall + buckle * 0.3) * (index < 2 ? 0.5 : -0.61);
    });
  });
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
  const core = surface(scene, "ram-core-fading-light", [0.58, 0.28, 0.88], 0.6);
  const owner = surface(scene, "ram-owner", [0.48, 0.76, 0.59]);
  const plate = (
    id: string,
    size: readonly [number, number, number],
    position: readonly [number, number, number],
    material: StandardMaterial,
    parent: TransformNode = root,
  ) => {
    const mesh = MeshBuilder.CreatePolyhedron(
      id,
      { custom: LEAF_BLADE },
      scene,
    );
    mesh.parent = parent;
    mesh.position.set(...position);
    mesh.scaling.set(...size);
    mesh.material = material;
    return mesh;
  };
  const branch = (
    id: string,
    points: readonly (readonly [number, number, number])[],
    radii: readonly number[],
    material: StandardMaterial,
    parent: TransformNode = root,
  ) => {
    const mesh = MeshBuilder.CreateTube(
      id,
      {
        path: points.map((point) => Vector3.FromArray(point)),
        radiusFunction: (index) => radii[index]!,
        tessellation: 6,
        cap: Mesh.CAP_ALL,
      },
      scene,
    );
    mesh.parent = parent;
    mesh.material = material;
  };
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
    size: [number, number, number],
    position: [number, number, number],
    rotation: [number, number, number],
    material: StandardMaterial,
    parent: TransformNode = root,
  ) => {
    const mesh = MeshBuilder.CreateBox(id, { size: 1 }, scene);
    mesh.parent = parent;
    mesh.position.set(...position);
    mesh.scaling.set(...size);
    mesh.rotation.set(...rotation);
    mesh.material = material;
    return mesh;
  };
  // Cracks cross the back plates and flanks.
  for (const [i, [x, y, z]] of (
    [
      [0.22, 1.22, 0.15],
      [-0.17, 1.2, -0.16],
      [0.08, 1.136, -0.45],
    ] as const
  ).entries())
    branch(
      `ram-damage-moderate-crack-${i}`,
      [
        [x - 0.12, y - 0.022, z - 0.15],
        [x - 0.06, y, z - 0.04],
        [x + 0.01, y - 0.02, z - 0.015],
        [x + 0.11, y - 0.042, z + 0.13],
      ],
      [0.01, 0.023, 0.025, 0.009],
      crack,
    );
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
  // Deeper splits open the plates and splinters jut from the breaks.
  for (const [i, [x, y, z, turn]] of (
    [
      [-0.02, 1.223, 0.33, 0.62],
      [0.14, 1.182, -0.23, -0.62],
    ] as const
  ).entries()) {
    sliver(
      `ram-damage-critical-split-${i}`,
      [0.083, 0.026, 0.37],
      [x, y, z],
      [0.16, turn, 0],
      split,
    );
    for (const offset of [-1, 1]) {
      const shard = MeshBuilder.CreateCylinder(
        `ram-damage-critical-splinter-${i}-${offset}`,
        { height: 0.22, diameterTop: 0, diameterBottom: 0.09, tessellation: 5 },
        scene,
      );
      shard.parent = root;
      shard.position.set(x + offset * 0.065, y + 0.055, z + offset * 0.05);
      shard.rotation.set(offset * 0.5, turn, offset * 0.4);
      shard.material = splinter;
    }
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

function harvester(scene: Scene, name: string) {
  const body = createHarvesterBody(scene, name);
  const { root, steel, rubber } = body;
  batchStaticParts(root);
  const { drill, beacon: amber } = addHarvesterWorkParts(
    scene,
    root,
    name,
    body,
  );
  batchStaticParts(drill);
  amber.name = "idle-signal";
  amber.material = surface(scene, "idle-light", HARVESTER_IDLE_LIGHT, 0.25);
  const green = amber.clone("working-signal", root)!;
  green.material = surface(scene, "working-light", HARVESTER_WORK_LIGHT, 0.25);
  const hopper = new TransformNode("harvester-hopper", scene);
  hopper.parent = root;
  hopper.position.set(0, 0.73, -0.35);
  const hopperPlate = (
    part: string,
    width: number,
    height: number,
    depth: number,
    x: number,
    y: number,
    z: number,
    material: StandardMaterial,
  ) => {
    const mesh = MeshBuilder.CreateBox(part, { width, height, depth }, scene);
    mesh.parent = hopper;
    mesh.position.set(x, y, z);
    mesh.material = material;
    return mesh;
  };
  hopperPlate("hopper-floor", 0.43, 0.06, 0.49, 0, -0.12, 0, rubber);
  hopperPlate("hopper-bulkhead", 0.56, 0.26, 0.055, 0, 0.02, 0.245, steel);
  hopperPlate(
    "hopper-discharge-lip",
    0.47,
    0.08,
    0.07,
    0,
    -0.09,
    -0.245,
    steel,
  );
  for (const side of [-1, 1]) {
    hopperPlate(
      "hopper-side",
      0.065,
      0.27,
      0.55,
      side * 0.245,
      0.01,
      0,
      steel,
    ).rotation.z = side * -0.32;
    hopperPlate(
      "hopper-rim",
      0.078,
      0.048,
      0.56,
      side * 0.285,
      0.14,
      0,
      rubber,
    );
  }
  for (const z of [-0.13, 0, 0.13])
    hopperPlate("hopper-floor-cleat", 0.4, 0.028, 0.033, 0, -0.084, z, steel);
  batchStaticParts(hopper);
  clip(root, "idle", 2, () => {});
  clip(root, "transit", 1, (seconds) => {
    root.position.y = Math.sin(seconds * Math.PI * 4) * 0.018;
  });
  clip(root, "harvest", 2, (seconds) => {
    drill.position.y = 0.3 + Math.sin(seconds * Math.PI * 12) * 0.035;
    drill.rotation.z = seconds * Math.PI * 4;
  });
  clip(root, "deploy", 0.6, (seconds) => {
    drill.position.y = 0.65 - (0.35 * seconds) / 0.6;
  });
  clip(root, "stow", 0.6, (seconds) => {
    drill.position.y = 0.3 + (0.35 * seconds) / 0.6;
  });
  clip(
    root,
    "unload",
    0.8,
    (seconds) => {
      const tip = Math.sin((seconds / 0.8) * Math.PI);
      hopper.rotation.x = -tip * 0.65;
      hopper.position.y = 0.73 + tip * 0.1;
    },
    false,
  );
  clip(
    root,
    "hit",
    0.35,
    (seconds) => {
      root.rotation.z = Math.sin((seconds / 0.35) * Math.PI) * 0.1;
    },
    false,
  );
  clip(root, "death", 0.8, (seconds) => {
    const fall = (seconds / 0.8) ** 2;
    root.rotation.z = -fall * 0.5;
    root.position.y = -fall * 0.12;
    drill.rotation.x = fall * 0.8;
  });
}

/** Meshes under animated pivots must keep their local transforms. */
function batchStaticParts(root: TransformNode) {
  const moving = new Set(
    root
      .getScene()
      .animationGroups.flatMap((group) =>
        group.targetedAnimations.flatMap(({ target }) =>
          target instanceof TransformNode
            ? [target, ...target.getDescendants(false)]
            : [],
        ),
      ),
  );
  const byMaterial = new Map<StandardMaterial, Mesh[]>();
  for (const mesh of root.getChildMeshes()) {
    if (!(mesh instanceof Mesh) || moving.has(mesh)) continue;
    if (!(mesh.material instanceof StandardMaterial)) continue;
    const parts = byMaterial.get(mesh.material) ?? [];
    parts.push(mesh);
    byMaterial.set(mesh.material, parts);
  }
  const toLocal = root.computeWorldMatrix(true).clone().invert();
  for (const [material, parts] of byMaterial) {
    if (parts.length === 1) continue;
    const mesh = merge(
      root,
      `${root.name}-static-${material.name}`,
      parts,
      material,
    );
    // Merge bakes world coordinates. Parts under a pivot need local vertices.
    if (!toLocal.isIdentity()) mesh.bakeTransformIntoVertices(toLocal);
  }
}

/** Exports a building's idle loop and a clip for each activity. */
function building(
  factory: TilePlacedActorDetailsFactory,
  { batchStatic = false }: { batchStatic?: boolean } = {},
) {
  return (scene: Scene, name: string) => {
    const root = new TransformNode(name, scene);
    const materials = new Map<string, StandardMaterial>();
    const details = factory(
      root,
      { center: Vector3.Zero(), roof: 0, tileSize: 1, facing: 0 },
      (materialName, configure) => {
        let material = materials.get(materialName);
        if (!material) {
          material = new StandardMaterial(materialName, scene);
          configure(material);
          materials.set(materialName, material);
        }
        return material;
      },
    );
    if (!details.loopSeconds)
      throw new Error(`Building ${name} has no looping motion`);
    clip(root, "idle", details.loopSeconds, details.update, false);
    for (const [kind, motion] of Object.entries(details.activities ?? {}))
      clip(root, kind, motion.seconds, motion.pose, false);
    if (batchStatic) batchStaticParts(root);
  };
}

/** A unit-length shot along +Z that hits scale to their range. */
function tracer(scene: Scene, name: string) {
  const root = new TransformNode(name, scene);
  const material = unlit(scene, name, TRACER_COLOR);
  const beam = MeshBuilder.CreateBox(
    "beam",
    { width: 0.025, height: 0.025, depth: 1 },
    scene,
  );
  beam.parent = root;
  beam.position.z = 0.5;
  beam.material = material;
}

function rocket(scene: Scene, name: string) {
  const root = new TransformNode(name, scene);
  const hot = unlit(scene, `${name}-hot`, ROCKET_COLOR);
  const smoke = surface(scene, `${name}-smoke`, [0.6, 0.59, 0.53], 0.3);
  const core = MeshBuilder.CreateBox(
    "rocket-streak",
    { width: 0.065, height: 0.065, depth: 1 },
    scene,
  );
  core.parent = root;
  core.position.z = 0.5;
  core.material = hot;
  const parts: Mesh[] = [];
  for (let index = 0; index < 5; index++) {
    const puff = MeshBuilder.CreateSphere(
      `trail-${index}`,
      { diameter: 0.16 - index * 0.018, segments: 4 },
      scene,
    );
    puff.parent = root;
    puff.position.set(Math.sin(index * 2) * 0.04, 0.03, 0.1 + index * 0.17);
    puff.scaling.z = 0.7;
    parts.push(puff);
  }
  merge(root, "rocket-smoke", parts, smoke);
}

function rocketImpact(scene: Scene, name: string) {
  const root = new TransformNode(name, scene);
  const bloom = new TransformNode("impact-bloom", scene);
  bloom.parent = root;
  const hot = unlit(scene, "impact-hot", new Color3(1, 0.63, 0.15));
  const parts: Mesh[] = [];
  for (let index = 0; index < 9; index++) {
    const angle = (index / 9) * Math.PI * 2;
    const ray = MeshBuilder.CreateBox(
      `impact-ray-${index}`,
      { width: 0.07, height: 0.6, depth: 0.07 },
      scene,
    );
    ray.parent = bloom;
    ray.rotation.z = angle;
    ray.position.set(
      Math.sin(angle) * 0.15,
      Math.cos(angle) * 0.15,
      Math.sin(index * 3) * 0.12,
    );
    parts.push(ray);
  }
  const core = MeshBuilder.CreateSphere(
    "impact-core",
    { diameter: 0.4, segments: 6 },
    scene,
  );
  core.parent = bloom;
  parts.push(core);
  merge(bloom, "impact-flare", parts, hot);
  clip(
    root,
    "burst",
    0.4,
    (seconds) => bloom.scaling.setAll(0.45 + seconds * 2),
    false,
  );
}

function bolt(scene: Scene, name: string) {
  const root = new TransformNode(name, scene);
  const violet = unlit(scene, name, BOLT_COLOR);
  const core = unlit(scene, `${name}-core`, new Color3(0.9, 0.8, 1));
  for (let strand = 0; strand < 3; strand++) {
    const path = Array.from({ length: 17 }, (_, index) => {
      const z = index / 16;
      const wave = Math.sin(z * Math.PI);
      return new Vector3(
        wave * (Math.sin(z * 21 + strand * 2.1) * 0.08),
        wave * (Math.cos(z * 17 + strand * 2.1) * 0.08),
        z,
      );
    });
    const vine = MeshBuilder.CreateTube(
      `living-strand-${strand}`,
      {
        path,
        radius: strand === 0 ? 0.018 : 0.01,
        tessellation: 5,
      },
      scene,
    );
    vine.parent = root;
    vine.material = strand === 0 ? core : violet;
  }
  for (let spark = 0; spark < 6; spark++) {
    const angle = (spark * Math.PI) / 3;
    const branch = MeshBuilder.CreateTube(
      `seed-spark-${spark}`,
      {
        path: [
          new Vector3(0, 0, 1),
          new Vector3(Math.cos(angle) * 0.09, Math.sin(angle) * 0.09, 0.98),
          new Vector3(
            Math.cos(angle + 0.4) * 0.18,
            Math.sin(angle + 0.4) * 0.18,
            1,
          ),
        ],
        radius: 0.012,
        tessellation: 4,
      },
      scene,
    );
    branch.parent = root;
    branch.material = violet;
  }
  const strands = root.getChildMeshes();
  clip(
    root,
    "idle",
    0.3,
    (seconds) => {
      strands.forEach((strand, index) => {
        const pulse = 1 + 0.2 * Math.sin((seconds * Math.PI * 2) / 0.3 + index);
        strand.scaling.x = pulse;
        strand.scaling.y = pulse;
      });
    },
    false,
  );
}

/** Three slanted claw slashes across the strike direction. */
function bite(scene: Scene, name: string) {
  const root = new TransformNode(name, scene);
  const material = unlit(scene, name, BITE_COLOR);
  for (const side of [-1, 0, 1]) {
    const slash = MeshBuilder.CreateBox(
      `claw-${side}`,
      { width: 0.025, height: 0.5, depth: 0.025 },
      scene,
    );
    slash.parent = root;
    slash.position.x = side * 0.12;
    slash.rotation.z = -0.5;
    slash.material = material;
  }
}

/** Splintered wood and a violet ring where a construct's blow lands. */
function strike(scene: Scene, name: string) {
  const root = new TransformNode(name, scene);
  const splinter = unlit(scene, name, STRIKE_COLOR);
  const ring = MeshBuilder.CreateTorus(
    `${name}-ring`,
    { diameter: 0.5, thickness: 0.03, tessellation: 18 },
    scene,
  );
  ring.parent = root;
  ring.rotation.x = Math.PI / 2;
  ring.material = unlit(scene, `${name}-ring`, BOLT_COLOR);
  for (let i = 0; i < 6; i++) {
    const angle = (i * Math.PI) / 3 + 0.3;
    const shard = MeshBuilder.CreateBox(
      `${name}-shard-${i}`,
      { width: 0.035, height: 0.26, depth: 0.035 },
      scene,
    );
    shard.parent = root;
    shard.position.set(Math.cos(angle) * 0.24, Math.sin(angle) * 0.24, 0);
    shard.rotation.z = angle - Math.PI / 2;
    shard.material = splinter;
  }
}

/** A unit cube that placement scales to fit. */
function foundation(scene: Scene, name: string) {
  const root = new TransformNode(name, scene);
  const mesh = MeshBuilder.CreateBox(name, { size: 1 }, scene);
  mesh.parent = root;
  mesh.material = surface(scene, name, [0.35, 0.42, 0.46]);
}

/** A tall crystal ringed by shorter ones leaning outward, on a stony bed. */
function materialsMound(scene: Scene, name: string) {
  const root = new TransformNode(name, scene);
  // Every part rests on the ground plane, so depletion shrinks toward it.
  const random = seededRandom(0x3a7e);
  const shards = Array.from({ length: 7 }, (_, index) => {
    const center = index === 0;
    const height = center ? 0.85 : 0.3 + random() * 0.28;
    const width = center ? 0.22 : 0.1 + random() * 0.07;
    const tip = width * 1.1;
    const parts = [
      MeshBuilder.CreateCylinder(
        "prism",
        { height: height - tip, diameter: width, tessellation: 6 },
        scene,
      ),
      MeshBuilder.CreateCylinder(
        "tip",
        { height: tip, diameterTop: 0, diameterBottom: width, tessellation: 6 },
        scene,
      ),
    ];
    parts[0]!.position.y = (height - tip) / 2;
    parts[1]!.position.y = height - tip / 2;
    const shard = Mesh.MergeMeshes(parts, true)!;
    const angle = (index / 6) * Math.PI * 2 + random() * 0.6;
    const ring = center ? 0 : 0.16 + random() * 0.12;
    const lean = center ? 0.05 : 0.25 + random() * 0.2;
    shard.position.set(
      Math.sin(angle) * ring,
      (width / 2) * Math.sin(lean),
      Math.cos(angle) * ring,
    );
    // Yaw applies after pitch, so the top leans toward the heading.
    shard.rotation.set(lean, angle, 0);
    return shard;
  });
  const stones = Array.from({ length: 6 }, (_, index) => {
    const angle = (index / 6) * Math.PI * 2 + random();
    const ring = 0.2 + random() * 0.15;
    const size = 0.07 + random() * 0.05;
    // Babylon's dodecahedron spans ±1 vertically per unit size.
    const stone = MeshBuilder.CreatePolyhedron(
      `bed-${index}`,
      { type: 2, sizeX: size, sizeY: size / 2, sizeZ: size },
      scene,
    );
    stone.position.set(
      Math.sin(angle) * ring,
      size / 2,
      Math.cos(angle) * ring,
    );
    stone.rotation.y = random() * Math.PI;
    return stone;
  });
  merge(
    root,
    "crystal",
    shards,
    surface(scene, "materials", MATERIALS_COLOR, 0.25),
  );
  merge(
    root,
    "bed",
    stones,
    surface(scene, "materials-bed", [0.27, 0.25, 0.23]),
  );
}

/** Fractured ARC panels and framing, sized to fit a rotated footprint tile. */
function rubble(scene: Scene, name: string) {
  const root = new TransformNode(name, scene);
  const random = seededRandom(0x5ab0);
  const pieces = {
    concrete: [] as Mesh[],
    scorched: [] as Mesh[],
    armor: [] as Mesh[],
    metal: [] as Mesh[],
  };
  const perimeter = [
    [-0.5, -0.25],
    [-0.12, -0.5],
    [0.41, -0.38],
    [0.5, 0.02],
    [0.19, 0.5],
    [-0.4, 0.37],
  ] as const;
  const count = perimeter.length;
  const fracturedSlab = {
    vertex: [
      ...perimeter.map(([x, z]) => [x, -0.5, z]),
      ...perimeter.map(([x, z], index) => [
        x * 0.88,
        index % 2 ? 0.22 : 0.5,
        z * 0.84,
      ]),
      [0.02, 0.42, -0.08],
    ],
    face: [
      perimeter.map((_, index) => index),
      ...perimeter.flatMap((_, index) => {
        const next = (index + 1) % count;
        return [
          [next, index, index + count, next + count],
          [next + count, index + count, count * 2],
        ];
      }),
    ],
  };
  const slab = (
    id: keyof typeof pieces,
    size: readonly [number, number, number],
    position: readonly [number, number, number],
    rotation: readonly [number, number, number],
  ) => {
    const mesh = MeshBuilder.CreatePolyhedron(
      id,
      { custom: fracturedSlab },
      scene,
    );
    mesh.scaling.set(...size);
    mesh.position.set(...position);
    mesh.rotation.set(...rotation);
    pieces[id].push(mesh);
  };
  slab("scorched", [0.69, 0.16, 0.62], [0, -0.41, -0.03], [0, 0.2, 0]);
  slab("concrete", [0.66, 0.3, 0.36], [-0.04, -0.3, 0.095], [0.2, 0.45, -0.15]);
  slab(
    "concrete",
    [0.43, 0.25, 0.31],
    [0.12, -0.29, -0.12],
    [-0.2, -0.6, 0.26],
  );
  slab("armor", [0.5, 0.16, 0.36], [-0.115, -0.04, 0.04], [0.47, 0.1, 0.56]);
  slab("armor", [0.33, 0.13, 0.23], [0.22, -0.17, 0.025], [-0.42, -0.65, 0.4]);
  for (let index = 0; index < 9; index++) {
    const angle = (index / 9) * Math.PI * 2 + random() * 0.35;
    const reach = 0.28 + random() * 0.085;
    const height = 0.16 + random() * 0.24;
    slab(
      index % 3 === 0 ? "scorched" : "concrete",
      [0.1 + random() * 0.11, height, 0.09 + random() * 0.09],
      [Math.cos(angle) * reach, -0.47 + height / 2, Math.sin(angle) * reach],
      [(random() - 0.5) * 0.35, angle, (random() - 0.5) * 0.35],
    );
  }
  for (const [index, path] of [
    [
      [-0.28, -0.36, -0.16],
      [-0.19, -0.04, -0.19],
      [0.03, 0.27, -0.02],
      [0.27, -0.03, 0.15],
    ],
    [
      [-0.24, -0.17, 0.19],
      [-0.08, -0.06, 0.26],
      [0.14, 0.04, 0.24],
      [0.25, -0.26, 0.2],
    ],
  ].entries())
    pieces.metal.push(
      MeshBuilder.CreateTube(
        `bent-frame-${index}`,
        {
          path: path.map((point) => Vector3.FromArray(point)),
          radius: 0.041,
          tessellation: 4,
          cap: Mesh.CAP_ALL,
        },
        scene,
      ),
    );
  for (const [part, color] of [
    ["concrete", [0.39, 0.37, 0.33]],
    ["scorched", [0.18, 0.17, 0.16]],
    ["armor", [0.49, 0.59, 0.57]],
    ["metal", [0.26, 0.3, 0.3]],
  ] as const)
    merge(root, part, pieces[part], surface(scene, `rubble-${part}`, color));
}

/**
 * Folded living architecture within the unit cube: snapped pale ribs, dark
 * roots, fallen leaves, and violet light that fades as remains collapse.
 */
function livingRubble(scene: Scene, name: string) {
  const root = new TransformNode(name, scene);
  const random = seededRandom(0x11fe);
  const pieces = {
    wood: [] as Mesh[],
    roots: [] as Mesh[],
    leaves: [] as Mesh[],
    "fading-light": [] as Mesh[],
  };
  const tube = (points: Vector3[], radius: number) =>
    MeshBuilder.CreateTube(
      `tube-${pieces.wood.length + pieces.roots.length}`,
      { path: points, radius, tessellation: 6, cap: 3 },
      scene,
    );
  // Ribs snap and fold inward, leaning against one another.
  for (let index = 0; index < 7; index++) {
    const angle = (index / 7) * Math.PI * 2 + random() * 0.4;
    const reach = 0.25 + random() * 0.2;
    const x = Math.cos(angle) * reach;
    const z = Math.sin(angle) * reach;
    pieces.wood.push(
      tube(
        [
          new Vector3(x, -0.5, z),
          new Vector3(x * 0.7, -0.5 + 0.35 + random() * 0.3, z * 0.7),
          new Vector3(x * 0.1, -0.5 + 0.2 + random() * 0.2, z * 0.1),
        ],
        0.035 + random() * 0.02,
      ),
    );
  }
  for (let index = 0; index < 8; index++) {
    const angle = random() * Math.PI * 2;
    const x = Math.cos(angle) * 0.45;
    const z = Math.sin(angle) * 0.45;
    pieces.roots.push(
      tube(
        [
          new Vector3(x, -0.5, z),
          new Vector3(x * 0.6, -0.42, z * 0.6),
          new Vector3(x * 0.2 + (random() - 0.5) * 0.2, -0.38, z * 0.2),
        ],
        0.03,
      ),
    );
  }
  for (let index = 0; index < 10; index++) {
    const leaf = MeshBuilder.CreateSphere(
      `leaf-${index}`,
      { diameter: 1, segments: 5 },
      scene,
    );
    leaf.scaling.set(0.16 + random() * 0.1, 0.06, 0.1 + random() * 0.08);
    leaf.position.set(
      (random() - 0.5) * 0.8,
      -0.45 + random() * 0.2,
      (random() - 0.5) * 0.8,
    );
    leaf.rotation.set((random() - 0.5) * 0.6, random() * Math.PI, 0);
    pieces.leaves.push(leaf);
  }
  for (let index = 0; index < 4; index++) {
    const ember = MeshBuilder.CreateSphere(
      `ember-${index}`,
      { diameter: 1, segments: 5 },
      scene,
    );
    ember.scaling.setAll(0.07 + random() * 0.05);
    ember.position.set(
      (random() - 0.5) * 0.5,
      -0.42 + random() * 0.15,
      (random() - 0.5) * 0.5,
    );
    pieces["fading-light"].push(ember);
  }
  for (const [part, color, glow] of [
    ["wood", [0.72, 0.62, 0.42], 0],
    ["roots", [0.24, 0.16, 0.1], 0],
    ["leaves", [0.2, 0.3, 0.16], 0],
    ["fading-light", [0.6, 0.3, 0.92], 0.9],
  ] as const)
    merge(
      root,
      part,
      pieces[part],
      surface(scene, `living-rubble-${part}`, color, glow),
    );
}

/** A ribboned gift box that bobs and turns. */
function salvage(scene: Scene, name: string) {
  const root = new TransformNode(name, scene);
  const gold = surface(scene, "salvage-box", SALVAGE_COLOR, 0.25);
  const ribbon = surface(scene, "salvage-ribbon", [0.8, 0.13, 0.24]);
  for (const [part, size, y, material] of [
    ["box", [0.65, 0.55, 0.65], 0, gold],
    ["lid", [0.72, 0.12, 0.72], 0.3, gold],
    ["ribbon-x", [0.13, 0.69, 0.735], 0.035, ribbon],
    ["ribbon-z", [0.735, 0.69, 0.13], 0.035, ribbon],
  ] as const) {
    const mesh = MeshBuilder.CreateBox(
      part,
      { width: size[0], height: size[1], depth: size[2] },
      scene,
    );
    mesh.parent = root;
    mesh.position.y = y;
    mesh.material = material;
  }
  for (const side of [-1, 1]) {
    const bow = MeshBuilder.CreateTorus(
      `bow-${side}`,
      { diameter: 0.24, thickness: 0.055, tessellation: 12 },
      scene,
    );
    bow.parent = root;
    bow.position.set(side * 0.12, 0.43, 0);
    bow.rotation.z = (side * Math.PI) / 4;
    bow.material = ribbon;
  }
  clip(root, "idle", 8, (seconds) => {
    root.position.y = Math.sin((seconds * Math.PI) / 2) * 0.12;
    root.rotation.y = (seconds * Math.PI) / 4;
  });
}

/** A unit-cube lattice of posts, rails, and braces around a blueprint. */
function scaffold(scene: Scene, name: string) {
  const root = new TransformNode(name, scene);
  const thickness = 0.03;
  const poles: Mesh[] = [];
  const braces: Mesh[] = [];
  /** A bar along x, rolled by `tilt` and then turned by `yaw`. */
  const bar = (
    parts: Mesh[],
    length: number,
    [x, y, z]: readonly [number, number, number],
    tilt: number,
    yaw: number,
  ) => {
    const mesh = MeshBuilder.CreateBox(
      `bar-${parts.length}`,
      { width: length, height: thickness, depth: thickness },
      scene,
    );
    mesh.position.set(x, y, z);
    mesh.rotation.set(0, yaw, tilt);
    parts.push(mesh);
  };
  const edges = [-0.5, 0, 0.5];
  // Posts at the corners and edge midpoints; rails at three levels.
  for (const x of edges)
    for (const z of edges) if (x || z) bar(poles, 1, [x, 0, z], Math.PI / 2, 0);
  for (const y of edges)
    for (const side of [-0.5, 0.5]) {
      bar(poles, 1, [0, y, side], 0, 0);
      bar(poles, 1, [side, y, 0], 0, Math.PI / 2);
    }
  // One brace per bay on each side, leaning alternately.
  const diagonal = Math.hypot(0.5, 0.5);
  for (const yaw of [0, Math.PI / 2])
    for (const side of [-0.5, 0.5])
      for (const [index, along] of [-0.25, 0.25].entries()) {
        const lean = ((index ? -1 : 1) * Math.PI) / 4;
        const y = -0.25 + index * 0.5;
        bar(
          braces,
          diagonal,
          yaw ? [side, y, along] : [along, y, side],
          lean,
          yaw,
        );
      }
  merge(
    root,
    "poles",
    poles,
    surface(scene, "scaffold-poles", [0.86, 0.62, 0.16]),
  );
  merge(
    root,
    "braces",
    braces,
    surface(scene, "scaffold-braces", [0.32, 0.33, 0.34]),
  );
}

/** A lumpy unit-wide smoke puff that damage effects raise and fade. */
function smoke(scene: Scene, name: string) {
  const root = new TransformNode(name, scene);
  const lumps = (
    [
      [0.5, 0, 0, 0],
      [0.32, 0.22, 0.12, 0.08],
      [0.3, -0.2, 0.1, -0.1],
    ] as const
  ).map(([radius, x, y, z], index) => {
    const lump = MeshBuilder.CreateIcoSphere(
      `lump-${index}`,
      { radius, subdivisions: 1 },
      scene,
    );
    lump.position.set(x, y, z);
    return lump;
  });
  merge(root, "puff", lumps, surface(scene, "smoke", [0.42, 0.42, 0.43]));
}

/** Flickering flame tongues with rising sparks, based at the origin. */
function fire(scene: Scene, name: string) {
  const root = new TransformNode(name, scene);
  const flames = (
    [
      [0.34, 0.75, 0, 0, [1, 0.42, 0.08]],
      [0.24, 0.5, 0.16, 0.08, [1, 0.62, 0.12]],
      [0.2, 0.45, -0.14, -0.06, [1, 0.62, 0.12]],
      [0.16, 0.38, 0, 0.02, [1, 0.9, 0.4]],
    ] as const
  ).map(([diameter, height, x, z, color], index) => {
    const node = new TransformNode(`flame-${index}`, scene);
    node.parent = root;
    node.position.set(x, 0, z);
    const cone = MeshBuilder.CreateCylinder(
      `flame-${index}-cone`,
      { height, diameterTop: 0, diameterBottom: diameter, tessellation: 5 },
      scene,
    );
    cone.parent = node;
    cone.position.y = height / 2;
    cone.material = unlit(scene, `flame-${index}`, new Color3(...color));
    return node;
  });
  const sparkMaterial = unlit(scene, "spark", new Color3(1, 0.85, 0.45));
  const sparks = [0, 1, 2].map((index) => {
    const spark = MeshBuilder.CreateBox(
      `spark-${index}`,
      { size: 0.04 },
      scene,
    );
    spark.parent = root;
    spark.position.set((index - 1) * 0.12, 0.3, (index % 2) * 0.1 - 0.05);
    spark.material = sparkMaterial;
    return spark;
  });
  const seconds = 0.6;
  clip(root, "flicker", seconds, (time) => {
    const phase = (time / seconds) * Math.PI * 2;
    flames.forEach((flame, index) => {
      flame.scaling.y =
        1 + Math.sin(phase * (index % 2 ? 2 : 1) + index) * 0.18;
      flame.rotation.z = Math.sin(phase + index * 1.7) * 0.12;
    });
    sparks.forEach((spark, index) => {
      const rise = (time / seconds + index / sparks.length) % 1;
      spark.position.y = 0.3 + rise * 0.9;
      spark.scaling.setAll(1 - rise);
    });
  });
}

/** A flat falling leaf for damaged living buildings. */
function leaf(scene: Scene, name: string) {
  const mesh = MeshBuilder.CreateSphere(
    name,
    { diameter: 1, segments: 4 },
    scene,
  );
  mesh.scaling.set(0.35, 0.06, 0.16);
  mesh.material = surface(scene, name, [0.24, 0.42, 0.19]);
}

/** A splintered chip of pale living wood shed by damaged constructs. */
function fragment(scene: Scene, name: string) {
  const mesh = MeshBuilder.CreatePolyhedron(
    name,
    { type: 2, sizeX: 0.12, sizeY: 0.05, sizeZ: 0.2 },
    scene,
  );
  mesh.material = surface(scene, name, [0.82, 0.72, 0.5]);
}

/** A faint violet wisp of light leaking from a damaged living core. */
function leak(scene: Scene, name: string) {
  const mesh = MeshBuilder.CreateSphere(
    name,
    { diameter: 1, segments: 5 },
    scene,
  );
  mesh.scaling.set(0.12, 0.22, 0.12);
  mesh.material = unlit(scene, name, new Color3(0.68, 0.38, 1));
}

/** A falling drop for wounded biological actors. */
function wound(scene: Scene, name: string) {
  const root = new TransformNode(name, scene);
  const drop = MeshBuilder.CreatePolyhedron(
    "drop",
    { type: 1, sizeX: 0.035, sizeY: 0.06, sizeZ: 0.035 },
    scene,
  );
  drop.parent = root;
  drop.material = surface(scene, "wound", [0.5, 0.04, 0.05]);
}

/** A healing halo and rising marks, distinct from wound drops. */
function regeneration(scene: Scene, name: string) {
  const root = new TransformNode(name, scene);
  const material = unlit(scene, "regeneration", new Color3(0.25, 1, 0.65));
  const halo = MeshBuilder.CreateTorus(
    "healing-halo",
    {
      diameter: 1.1,
      thickness: 0.025,
      tessellation: 24,
    },
    scene,
  );
  halo.parent = root;
  halo.position.y = 0.06;
  halo.material = material;
  const marks = [0, 1, 2].map((index) => {
    const mark = new TransformNode(`healing-mark-${index}`, scene);
    mark.parent = root;
    const angle = (index * Math.PI * 2) / 3;
    mark.position.set(Math.sin(angle) * 0.4, 0.3, Math.cos(angle) * 0.4);
    for (const [width, height] of [
      [0.14, 0.04],
      [0.04, 0.14],
    ]) {
      const bar = MeshBuilder.CreateBox(
        "healing-cross",
        { width, height, depth: 0.04 },
        scene,
      );
      bar.parent = mark;
      bar.material = material;
    }
    return mark;
  });
  clip(root, "pulse", 1.5, (seconds) => {
    halo.scaling.setAll(1 + Math.sin((seconds * Math.PI * 2) / 1.5) * 0.08);
    marks.forEach((mark, index) => {
      const progress = (seconds / 1.5 + index / 3) % 1;
      mark.position.y = 0.2 + progress * 0.65;
      mark.scaling.setAll(0.7 + Math.sin(progress * Math.PI) * 0.3);
    });
  });
}

/** A dark bird facing +Z whose wings beat in its idle clip. */
function bird(scene: Scene, name: string) {
  const root = new TransformNode(name, scene);
  const plumage = surface(scene, "plumage", [0.14, 0.14, 0.17]);
  const body = MeshBuilder.CreateBox(
    "body",
    { width: 0.1, height: 0.08, depth: 0.36 },
    scene,
  );
  body.parent = root;
  body.material = plumage;
  const tail = MeshBuilder.CreateBox(
    "tail",
    { width: 0.14, height: 0.02, depth: 0.12 },
    scene,
  );
  tail.parent = root;
  tail.position.z = -0.22;
  tail.material = plumage;
  const wings = [-1, 1].map((side) => {
    const shoulder = new TransformNode(`shoulder-${side}`, scene);
    shoulder.parent = root;
    shoulder.position.x = side * 0.05;
    const wing = MeshBuilder.CreateBox(
      `wing-${side}`,
      { width: 0.42, height: 0.015, depth: 0.16 },
      scene,
    );
    wing.parent = shoulder;
    wing.position.x = side * 0.21;
    wing.material = plumage;
    return { shoulder, side };
  });
  const seconds = 0.5;
  clip(root, "flap", seconds, (time) => {
    const beat = Math.sin((time / seconds) * Math.PI * 2) * 0.6;
    for (const { shoulder, side } of wings) shoulder.rotation.z = side * beat;
  });
}

/** Each model's builder fills an empty scene with nodes, materials, and clips. */
const BUILDERS = {
  ...CIRCLE_MODELS,
  "command-center": building(createCommandCenterDetails),
  barracks: building(createBarracksDetails, { batchStatic: true }),
  refinery: building(createRefineryDetails, { batchStatic: true }),
  relay: building(createRelayDetails, { batchStatic: true }),
  sentry: building(createSentryDetails),
  harvester,
  wolf,
  "circle-briar-ram": briarRam,
  "materials-mound": materialsMound,
  salvage,
  rubble,
  "living-rubble": livingRubble,
  foundation,
  scaffold,
  tracer,
  rocket,
  "rocket-impact": rocketImpact,
  bolt,
  bite,
  strike,
  smoke,
  fire,
  leaf,
  fragment,
  leak,
  wound,
  bird,
  regeneration,
} satisfies Record<string, (scene: Scene, name: string) => void>;

type ModelAsset = keyof typeof BUILDERS;
export const MODEL_ASSETS = Object.keys(BUILDERS) as ModelAsset[];

/** Exports model geometry, materials, rigs, and clips from code alone. */
export function exportModelAsset(kind: ModelAsset): Promise<Uint8Array> {
  return exportGlb(kind, (scene) => BUILDERS[kind](scene, kind));
}
