import {
  Bone,
  Color3,
  Color4,
  Matrix,
  Mesh,
  MeshBuilder,
  Quaternion,
  Skeleton,
  StandardMaterial,
  TransformNode,
  Vector3,
  VertexBuffer,
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
  const profile = [
    { z: 0, radius: 0.013 },
    { z: 0.19, radius: 0.017 },
    { z: 0.61, radius: 0.023 },
    { z: 0.88, radius: 0.03 },
    { z: 1, radius: 0.007 },
  ];
  const beam = MeshBuilder.CreateTube(
    "beam",
    {
      path: profile.map(({ z }) => new Vector3(0, 0, z)),
      radiusFunction: (index) => profile[index]!.radius,
      tessellation: 6,
      cap: Mesh.CAP_ALL,
    },
    scene,
  );
  const tail = new Color3(1, 0.73, 0.36).toLinearSpace();
  const hot = Color3.Lerp(TRACER_COLOR, Color3.White(), 0.65).toLinearSpace();
  const positions = beam.getVerticesData(VertexBuffer.PositionKind)!;
  const colors: number[] = [];
  for (let i = 2; i < positions.length; i += 3) {
    const heat = Math.min(1, positions[i]! / 0.88);
    const color = Color3.Lerp(tail, hot, heat);
    colors.push(color.r, color.g, color.b, 1);
  }
  beam.setVerticesData(VertexBuffer.ColorKind, colors);
  beam.parent = root;
  beam.material = unlit(scene, name, Color3.White());
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
  const core = unlit(scene, `${name}-core`, new Color3(0.91, 0.77, 1));
  const violet = unlit(scene, name, new Color3(0.76, 0.46, 1));
  const strands = [core, violet, violet].map((material, strand) => {
    const path = Array.from({ length: 25 }, (_, index) => {
      const z = index / 24;
      const bend = Math.sin(z * Math.PI * 2) * 0.06;
      const radius = strand === 0 ? 0 : Math.sin(z * Math.PI) * 0.095;
      const angle = z * Math.PI * 4 + strand * Math.PI;
      return new Vector3(
        bend + Math.cos(angle) * radius,
        Math.sin(angle) * radius,
        z,
      );
    });
    const vine = MeshBuilder.CreateTube(
      `living-strand-${strand}`,
      {
        path,
        radiusFunction: (index) =>
          0.009 +
          Math.sin((index * Math.PI) / 24) * (strand === 0 ? 0.024 : 0.012),
        tessellation: 6,
        cap: Mesh.CAP_ALL,
      },
      scene,
    );
    vine.parent = root;
    vine.material = material;
    return vine;
  });
  const petals = Array.from({ length: 4 }, (_, index) => {
    const angle = ((index + 0.25) * Math.PI) / 2;
    const point = (radius: number, sweep: number, z: number) =>
      new Vector3(
        Math.cos(angle + sweep) * radius,
        Math.sin(angle + sweep) * radius,
        z,
      );
    return MeshBuilder.CreateTube(
      "impact-petal",
      {
        path: [
          point(0, 0, 1),
          point(0.09, 0.15, 0.976),
          point(0.16, 0.28, 0.964),
          point(0.24, 0.46, 0.966),
        ],
        radiusFunction: (ring) => [0.012, 0.035, 0.027, 0.004][ring]!,
        tessellation: 5,
        cap: Mesh.CAP_ALL,
      },
      scene,
    );
  });
  const bloom = merge(root, "impact-bloom", petals, core);
  clip(
    root,
    "idle",
    0.3,
    (seconds) => {
      strands.forEach((strand, index) => {
        const phase = (seconds * Math.PI * 2) / 0.3;
        const pulse = 1 + 0.24 * Math.sin(phase + index);
        strand.scaling.x = pulse;
        strand.scaling.y = pulse;
      });
      const opening = 0.78 + 0.38 * Math.sin((seconds * Math.PI) / 0.3);
      bloom.scaling.x = opening;
      bloom.scaling.y = opening;
    },
    false,
  );
}

/** Three slanted claw slashes across the strike direction. */
function bite(scene: Scene, name: string) {
  const root = new TransformNode(name, scene);
  const profile = [
    { x: -0.14, y: -0.34, z: 0.035, radius: 0.003 },
    { x: -0.09, y: -0.19, z: -0.015, radius: 0.025 },
    { x: 0, y: 0.04, z: -0.04, radius: 0.038 },
    { x: 0.11, y: 0.22, z: -0.015, radius: 0.028 },
    { x: 0.22, y: 0.32, z: 0.035, radius: 0.003 },
  ];
  const slashes = [-1, 0, 1].map((side) => {
    const length = 1 - Math.abs(side) * 0.17;
    return MeshBuilder.CreateTube(
      "claw-slash",
      {
        path: profile.map(
          ({ x, y, z }) =>
            new Vector3(
              x * length + side * 0.2,
              y * length + side * 0.04,
              z + side * 0.08,
            ),
        ),
        radiusFunction: (index) => profile[index]!.radius * length,
        tessellation: 6,
        cap: Mesh.CAP_ALL,
      },
      scene,
    );
  });
  const marks = Mesh.MergeMeshes(slashes, true, true)!;
  marks.name = "claw-marks";
  marks.parent = root;
  marks.material = unlit(scene, name, Color3.White());
  const edge = BITE_COLOR.toLinearSpace();
  const middle = new Color3(1, 0.75, 0.57).toLinearSpace();
  const positions = marks.getVerticesData(VertexBuffer.PositionKind)!;
  const colors: number[] = [];
  for (let index = 1; index < positions.length; index += 3) {
    const highlight = Math.max(
      0,
      1 - Math.abs(positions[index]! - 0.07) / 0.28,
    );
    const color = Color3.Lerp(edge, middle, highlight);
    colors.push(color.r, color.g, color.b, 1);
  }
  marks.setVerticesData(VertexBuffer.ColorKind, colors);
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

/** A terrain-seated slab module with a sloped shoulder and recessed joints. */
function foundation(scene: Scene, name: string) {
  const root = new TransformNode(name, scene);
  const square = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];
  const vertex = [
    ...square.map(([x, z]) => [x! * 0.5, -0.5, z! * 0.5]),
    ...square.map(([x, z]) => [x! * 0.5, 0.08, z! * 0.5]),
    ...square.map(([x, z]) => [x! * 0.45, 0.5, z! * 0.45]),
  ];
  const face = [
    [0, 1, 2, 3],
    [11, 10, 9, 8],
  ];
  const footing = new Color4(0.23, 0.28, 0.3, 1);
  const shoulder = new Color4(0.43, 0.48, 0.47, 1);
  const deck = new Color4(0.59, 0.63, 0.59, 1);
  const faceColors = [footing, deck];
  for (const [offset, color] of [
    [0, footing],
    [4, shoulder],
  ] as const) {
    for (let i = 0; i < square.length; i++) {
      const a = offset + i;
      const b = offset + ((i + 1) % square.length);
      face.push([b, a, a + 4, b + 4]);
      faceColors.push(color);
    }
  }
  const mesh = MeshBuilder.CreatePolyhedron(
    name,
    { custom: { vertex, face }, faceColors },
    scene,
  );
  mesh.parent = root;
  mesh.material = surface(scene, name, Color3.White());
}

/** An exposed vein of tilted ore blades in a low, fractured rock bed. */
function materialsMound(scene: Scene, name: string) {
  const root = new TransformNode(name, scene);
  const ore = { faces: [] as Mesh[], edges: [] as Mesh[] };
  const outline = [
    [-0.52, -0.33],
    [-0.22, -0.53],
    [0.48, -0.35],
    [0.56, 0.21],
    [0.23, 0.51],
    [-0.47, 0.32],
  ] as const;
  const shoulders = [0.73, 0.87, 0.8, 0.57, 0.49, 0.62];
  const vertex = [
    ...outline.map(([x, z]) => [x, 0, z]),
    ...outline.map(([x, z], i) => [x * 0.82 + 0.12, shoulders[i]!, z * 0.72]),
    [0.04, 1, -0.11],
  ];
  const face = [[0, 1, 2, 3, 4, 5]];
  for (let i = 0; i < outline.length; i++) {
    const next = (i + 1) % outline.length;
    face.push([next, i, i + 6, next + 6], [next + 6, i + 6, 12]);
  }
  for (const [part, x, z, width, height, depth, lean, yaw] of [
    ["faces", -0.1, 0.02, 0.33, 0.83, 0.27, 0.28, 0.5],
    ["edges", 0.13, -0.05, 0.28, 0.68, 0.23, 0.43, 0.62],
    ["faces", 0.21, 0.14, 0.2, 0.46, 0.18, 0.45, 0.8],
    ["edges", -0.21, 0.16, 0.19, 0.36, 0.18, 0.45, -1.5],
    ["faces", -0.22, -0.13, 0.18, 0.33, 0.17, 0.34, -2],
    ["edges", 0.06, 0.25, 0.13, 0.25, 0.14, 0.63, 1.1],
  ] as const) {
    const blade = MeshBuilder.CreatePolyhedron(
      "blade",
      { custom: { vertex, face }, sizeX: width, sizeY: height, sizeZ: depth },
      scene,
    );
    blade.position.set(x, 0.06, z);
    blade.rotation.set(lean, yaw, 0);
    ore[part].push(blade);
  }
  const bed = (
    [
      [-0.15, 0, 0.25, 0.13, 0.23, 0.3],
      [0.15, 0.05, 0.24, 0.16, 0.24, -0.55],
      [-0.02, -0.23, 0.25, 0.12, 0.14, 0.52],
      [-0.19, 0.22, 0.16, 0.08, 0.11, -0.38],
      [0.19, 0.25, 0.15, 0.1, 0.1, 0.2],
    ] as const
  ).map(([x, z, width, height, depth, yaw]) => {
    const stone = MeshBuilder.CreatePolyhedron(
      "stone",
      { type: 2, sizeX: width, sizeY: height, sizeZ: depth },
      scene,
    );
    stone.position.set(x, height, z);
    stone.rotation.y = yaw;
    return stone;
  });
  merge(
    root,
    "ore",
    ore.faces,
    surface(scene, "materials", MATERIALS_COLOR, 0.24),
  );
  merge(
    root,
    "ore-bright",
    ore.edges,
    surface(scene, "materials-bright", [0.42, 0.75, 0.79], 0.27),
  );
  merge(root, "bed", bed, surface(scene, "materials-bed", [0.34, 0.31, 0.25]));
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

/** Broken Circle ribs fold over a root bed and leave embers at the breaks. */
function livingRubble(scene: Scene, name: string) {
  const root = new TransformNode(name, scene);
  const pieces = {
    wood: [] as Mesh[],
    roots: [] as Mesh[],
    leaves: [] as Mesh[],
    "fading-light": [] as Mesh[],
  };
  const branch = (
    part: "wood" | "roots",
    knots: readonly (readonly [number, number, number, number])[],
  ) => {
    pieces[part].push(
      MeshBuilder.CreateTube(
        `${part}-${pieces[part].length}`,
        {
          path: knots.map(([x, y, z]) => new Vector3(x, y, z)),
          radiusFunction: (index) => knots[index]![3],
          tessellation: 6,
          cap: Mesh.CAP_ALL,
        },
        scene,
      ),
    );
  };
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
    const leaf = MeshBuilder.CreatePolyhedron(
      `leaf-${index}`,
      { custom: LEAF_BLADE },
      scene,
    );
    leaf.scaling.set(0.22, 0.15, length);
    leaf.position.set(x, y, z);
    leaf.rotation.set(0.33, angle, -0.24);
    pieces.leaves.push(leaf);
  }
  for (const [index, [x, y, z, size]] of (
    [
      [0.079, 0.057, 0.024, 0.064],
      [0.177, -0.137, 0.036, 0.046],
      [0.02, -0.3, 0.11, 0.048],
    ] as const
  ).entries()) {
    const ember = MeshBuilder.CreatePolyhedron(
      `ember-${index}`,
      { type: 1, size },
      scene,
    );
    ember.position.set(x, y, z);
    ember.rotation.set(-0.3, 0.25, 0.48);
    pieces["fading-light"].push(ember);
  }
  for (const [part, color, glow] of [
    ["wood", [0.84, 0.71, 0.48], 0],
    ["roots", [0.29, 0.2, 0.13], 0],
    ["leaves", [0.15, 0.35, 0.23], 0],
    ["fading-light", [0.65, 0.35, 0.93], 0.95],
  ] as const)
    merge(
      root,
      part,
      pieces[part],
      surface(scene, `living-rubble-${part}`, color, glow),
    );
}

/** A neutral recovery case with reinforced ends and an amber locator. */
function salvage(scene: Scene, name: string) {
  const root = new TransformNode(name, scene);
  const pieces = {
    shell: [] as Mesh[],
    frame: [] as Mesh[],
    lamp: [] as Mesh[],
  };
  const box = (
    part: keyof typeof pieces,
    [x, y, z]: readonly [number, number, number],
    [width, height, depth]: readonly [number, number, number],
  ) => {
    const mesh = MeshBuilder.CreateBox(
      `${part}-${pieces[part].length}`,
      { width, height, depth },
      scene,
    );
    mesh.position.set(x, y, z);
    pieces[part].push(mesh);
  };
  const outline = [
    [-0.34, -0.3],
    [0.34, -0.3],
    [0.46, -0.18],
    [0.46, 0.18],
    [0.34, 0.3],
    [-0.34, 0.3],
    [-0.46, 0.18],
    [-0.46, -0.18],
  ] as const;
  const vertex = [
    ...outline.map(([x, z]) => [x * 0.9, -0.23, z * 0.9]),
    ...outline.map(([x, z]) => [x, 0.13, z]),
    ...outline.map(([x, z]) => [x * 0.83, 0.24, z * 0.83]),
  ];
  const face = [
    [0, 1, 2, 3, 4, 5, 6, 7],
    [23, 22, 21, 20, 19, 18, 17, 16],
  ];
  for (const offset of [0, 8])
    for (let i = 0; i < outline.length; i++) {
      const a = offset + i;
      const b = offset + ((i + 1) % outline.length);
      face.push([b, a, a + 8, b + 8]);
    }
  pieces.shell.push(
    MeshBuilder.CreatePolyhedron("case", { custom: { vertex, face } }, scene),
  );
  box("frame", [0, 0.248, 0], [0.47, 0.06, 0.35]);
  box("lamp", [0, 0.283, 0], [0.37, 0.025, 0.18]);
  for (const side of [-1, 1]) {
    box("frame", [side * 0.32, -0.232, 0], [0.15, 0.085, 0.49]);
    box("frame", [side * 0.535, 0.02, 0], [0.065, 0.09, 0.29]);
    for (const z of [-0.11, 0.11])
      box("frame", [side * 0.475, 0.02, z], [0.13, 0.09, 0.07]);
    box("frame", [0, 0.05, side * 0.285], [0.43, 0.13, 0.064]);
    box("lamp", [0, 0.05, side * 0.322], [0.33, 0.061, 0.018]);
  }
  merge(
    root,
    "shell",
    pieces.shell,
    surface(scene, "salvage-shell", [0.49, 0.5, 0.46]),
  );
  merge(
    root,
    "frame",
    pieces.frame,
    surface(scene, "salvage-frame", [0.19, 0.23, 0.23]),
  );
  merge(
    root,
    "lamp",
    pieces.lamp,
    surface(scene, "salvage-lamp", SALVAGE_COLOR, 0.55),
  );
  clip(
    root,
    "idle",
    8,
    (seconds) => {
      root.position.y = Math.sin((seconds * Math.PI) / 2) * 0.12;
      root.rotation.y = (seconds * Math.PI) / 4;
    },
    false,
  );
}

/** An open braced frame sized to the blueprint's footprint and stage height. */
function scaffold(scene: Scene, name: string) {
  const root = new TransformNode(name, scene);
  const frame: Mesh[] = [];
  const fittings: Mesh[] = [];
  const safety: Mesh[] = [];
  const beam = (
    batch: Mesh[],
    [width, height, depth]: readonly [number, number, number],
    [x, y, z]: readonly [number, number, number],
    tilt = 0,
    yaw = 0,
  ) => {
    const mesh = MeshBuilder.CreateBox(
      `beam-${batch.length}`,
      { width, height, depth },
      scene,
    );
    mesh.position.set(x, y, z);
    mesh.rotation.set(0, yaw, tilt);
    batch.push(mesh);
  };
  const edge = 0.445;
  const sides = [-edge, edge];
  for (const x of sides)
    for (const z of sides) {
      beam(frame, [0.055, 0.94, 0.055], [x, 0, z]);
      beam(fittings, [0.11, 0.1, 0.11], [x, -0.45, z]);
      beam(safety, [0.091, 0.17, 0.091], [x, 0.415, z]);
    }

  const lower = -0.36;
  const upper = 0.41;
  const span = upper - lower;
  const diagonal = Math.hypot(edge, span);
  const lean = Math.atan2(span, edge);
  for (const yaw of [0, Math.PI / 2]) {
    for (const side of sides) {
      const at = (along: number, y: number): [number, number, number] =>
        yaw ? [side, y, -along] : [along, y, side];
      beam(frame, [2 * edge, 0.075, 0.05], at(0, lower), 0, yaw);
      beam(frame, [2 * edge, 0.09, 0.055], at(0, upper), 0, yaw);
      beam(frame, [0.035, span, 0.035], at(0, (lower + upper) / 2));
      for (const sign of [-1, 1]) {
        beam(
          fittings,
          [diagonal, 0.035, 0.026],
          at((sign * edge) / 2, (lower + upper) / 2),
          sign * lean,
          yaw,
        );
        beam(safety, [0.14, 0.075, 0.065], at(sign * 0.352, upper), 0, yaw);
      }
    }
  }
  merge(
    root,
    "frame",
    frame,
    surface(scene, "scaffold-frame", [0.17, 0.24, 0.27]),
  );
  merge(
    root,
    "fittings",
    fittings,
    surface(scene, "scaffold-fittings", [0.35, 0.43, 0.45]),
  );
  merge(
    root,
    "safety",
    safety,
    surface(scene, "scaffold-safety", [0.9, 0.59, 0.19]),
  );
}

/** A curled, translucent puff scaled and faded by the damage view. */
function smoke(scene: Scene, name: string) {
  const root = new TransformNode(name, scene);
  const puff = MeshBuilder.CreateIcoSphere(
    "puff",
    { radius: 1, subdivisions: 3, flat: false },
    scene,
  );
  puff.parent = root;
  const material = surface(scene, name, Color3.White());
  material.alpha = 0.86;
  puff.material = material;
  const soot = new Color3(0.36, 0.36, 0.36);
  const ash = new Color3(0.72, 0.71, 0.68);
  const positions = puff.getVerticesData(VertexBuffer.PositionKind)!;
  const colors: number[] = [];
  for (let index = 0; index < positions.length; index += 3) {
    const x = positions[index]!;
    const y = positions[index + 1]!;
    const z = positions[index + 2]!;
    const roll = Math.sin(4 * x + 3 * y) * Math.cos(4 * z - 2 * y);
    const radius = 0.42 + 0.07 * y + 0.08 * roll;
    positions[index] = x * radius + 0.13 * y;
    positions[index + 1] = y * 0.47 + 0.06 * roll;
    positions[index + 2] = z * radius + 0.1 * y * y;
    const color = Color3.Lerp(soot, ash, (y + 1) / 2);
    colors.push(color.r, color.g, color.b, 1);
  }
  puff.setVerticesData(VertexBuffer.PositionKind, positions);
  puff.setVerticesData(VertexBuffer.ColorKind, colors);
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
  const drop = MeshBuilder.CreateLathe(
    "drop",
    {
      shape: [
        new Vector3(0, 0.12, 0),
        new Vector3(0.025, 0.052, 0),
        new Vector3(0.052, 0.012, 0),
        new Vector3(0.06, -0.028, 0),
        new Vector3(0.046, -0.062, 0),
        new Vector3(0, -0.077, 0),
      ],
      tessellation: 8,
    },
    scene,
  );
  drop.parent = root;
  drop.material = unlit(scene, name, Color3.White());
  const crimson = new Color3(0.56, 0.08, 0.14).toLinearSpace();
  const coral = new Color3(0.95, 0.42, 0.36).toLinearSpace();
  const positions = drop.getVerticesData(VertexBuffer.PositionKind)!;
  const colors: number[] = [];
  for (let index = 1; index < positions.length; index += 3) {
    const highlight = Math.max(
      0,
      1 - Math.abs(positions[index]! - 0.012) / 0.07,
    );
    const color = Color3.Lerp(crimson, coral, highlight);
    colors.push(color.r, color.g, color.b, 1);
  }
  drop.setVerticesData(VertexBuffer.ColorKind, colors);
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

/** A dark bird facing +Z with articulated, feathered wings. */
function bird(scene: Scene, name: string) {
  const root = new TransformNode(name, scene);
  const plumage = surface(scene, "plumage", [0.2, 0.23, 0.26]);
  const flights = surface(scene, "flight-feathers", [0.29, 0.33, 0.37]);
  const panel = (
    name: string,
    outline: readonly (readonly [number, number])[],
    thickness: number,
    side = 1,
  ) => {
    const perimeter =
      side < 0 ? [outline[0]!, ...outline.slice(1).reverse()] : outline;
    const count = perimeter.length;
    const vertex = [-thickness / 2, thickness / 2].flatMap((y) =>
      perimeter.map(([x, z]) => [side * x, y, z]),
    );
    const bottom = perimeter.map((_, i) => i);
    // The fan starts at the same point on both faces of the notched tips.
    const face = [
      bottom,
      [
        count,
        ...bottom
          .slice(1)
          .reverse()
          .map((i) => count + i),
      ],
    ];
    for (let a = 0; a < count; a++) {
      const b = (a + 1) % count;
      face.push([b, a, a + count, b + count]);
    }
    return MeshBuilder.CreatePolyhedron(
      name,
      { custom: { vertex, face } },
      scene,
    );
  };

  const body = MeshBuilder.CreateSphere(
    "torso",
    { diameterX: 0.125, diameterY: 0.11, diameterZ: 0.36, segments: 5 },
    scene,
  );
  const head = MeshBuilder.CreateSphere(
    "head",
    { diameterX: 0.095, diameterY: 0.09, diameterZ: 0.12, segments: 4 },
    scene,
  );
  head.position.set(0, 0.025, 0.164);
  const tail = panel(
    "tail",
    [
      [-0.03, 0.08],
      [-0.084, -0.09],
      [-0.045, -0.11],
      [0.045, -0.11],
      [0.084, -0.09],
      [0.03, 0.08],
    ],
    0.018,
  );
  tail.position.z = -0.22;
  merge(root, "body", [body, head, tail], plumage);

  const bill = MeshBuilder.CreateCylinder(
    "bill",
    { diameterTop: 0, diameterBottom: 0.056, height: 0.085, tessellation: 4 },
    scene,
  );
  bill.parent = root;
  bill.position.set(0, 0.016, 0.245);
  bill.rotation.x = Math.PI / 2;
  bill.material = surface(scene, "bill", [0.36, 0.36, 0.32]);

  const wings = [-1, 1].map((side) => {
    const shoulder = new TransformNode(`shoulder-${side}`, scene);
    shoulder.parent = root;
    shoulder.position.set(side * 0.045, 0.016, 0.016);
    const wing = panel(
      `wing-${side}`,
      [
        [-0.01, 0.055],
        [-0.01, -0.091],
        [0.12, -0.111],
        [0.27, -0.102],
        [0.29, 0.043],
        [0.21, 0.105],
        [0.105, 0.127],
      ],
      0.027,
      side,
    );
    wing.parent = shoulder;
    wing.material = plumage;

    const wrist = new TransformNode(`wrist-${side}`, scene);
    wrist.parent = shoulder;
    wrist.position.x = side * 0.255;
    const feathers = panel(
      `flight-feathers-${side}`,
      [
        [0, 0.07],
        [0, -0.1],
        [0.08, -0.153],
        [0.12, -0.148],
        [0.1, -0.108],
        [0.195, -0.134],
        [0.15, -0.082],
        [0.258, -0.061],
        [0.224, 0.015],
        [0.12, 0.075],
      ],
      0.016,
      side,
    );
    feathers.parent = wrist;
    feathers.material = flights;
    return { shoulder, wrist, side };
  });
  const seconds = 0.5;
  clip(
    root,
    "flap",
    seconds,
    (time) => {
      const phase = (time / seconds) * Math.PI * 2;
      for (const { shoulder, wrist, side } of wings) {
        shoulder.rotation.z = side * Math.sin(phase) * 0.61;
        wrist.rotation.z = side * (Math.sin(phase - 0.6) * 0.28 - 0.08);
      }
    },
    false,
  );
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
