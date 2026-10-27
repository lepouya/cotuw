import { createCircleStructure } from "./circle-models.ts";
import type { CircleStructureId } from "./circle-models.ts";
import { surface } from "./model-surface.ts";
import {
  Animation,
  AnimationGroup,
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

import { createCommandCenterDetails } from "../src/render/command-center.ts";
import { createBarracksDetails } from "../src/render/barracks.ts";
import { createRefineryDetails } from "../src/render/refinery.ts";
import { createHarvesterAppearance } from "../src/render/harvester.ts";
import { createWolfAppearance } from "../src/render/wolf.ts";
import {
  BITE_COLOR,
  BOLT_COLOR,
  TRACER_COLOR,
} from "../src/render/combat-effects.ts";
import {
  MATERIALS_COLOR,
  SALVAGE_COLOR,
} from "../src/render/materials-sites.ts";
import { exportGlb, FRAMES_PER_SECOND, rigidSkin } from "./glb-export.ts";
import { seededRandom } from "./sprite-sheet.ts";

import type { Scene } from "@babylonjs/core";
import type { ActorAppearance } from "../src/render/actor.ts";
import type { TilePlacedActorDetailsFactory } from "../src/render/tile-placed-actor-view.ts";

/** Samples authored poses into glTF node channels; playback needs no builder. */
function clip(
  root: TransformNode,
  name: string,
  seconds: number,
  pose: (seconds: number) => void,
  completePose = true,
) {
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
      animation.setKeys(keys[index]![property]);
      group.addTargetedAnimation(animation, node);
    }
  });
  return group;
}

/** Rigid weights preserve the part hierarchy while exporting a real skin. */
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
  const joints = parts.map((part) => {
    const joint = new TransformNode(`${part.name}-joint`, scene);
    joint.parent = part.parent;
    joint.position.copyFrom(part.position);
    joint.rotation.copyFrom(part.rotation);
    joint.scaling.copyFrom(part.scaling);
    for (const child of part.getChildren()) child.parent = joint;
    return joint;
  });
  const skeleton = new Skeleton("wolf-rig", "wolf-rig", scene);
  skeleton.useTextureToStoreBoneMatrices = true;
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
  for (const material of new Set(parts.map((part) => part.material)))
    rigidSkin(
      `wolf-${material!.name}-skin`,
      parts.flatMap((part, index) =>
        part.material === material
          ? [
              {
                vertices: vertices[index]!,
                bone: skeleton.bones.indexOf(bones.get(joints[index]!)!),
              },
            ]
          : [],
      ),
      skeleton,
      material!,
      root,
    );
  for (const part of parts) part.dispose(false, false);
}

function unlit(scene: Scene, name: string, color: Color3) {
  const material = surface(scene, name, color);
  material.disableLighting = true;
  material.emissiveColor = material.diffuseColor;
  return material;
}

/** Bakes parts that share a material into one mesh, keeping draw calls low. */
function merge(
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

/** Instantiates a built-in actor's parts as the model, without its template. */
function actorParts(
  scene: Scene,
  name: string,
  create: (scene: Scene) => ActorAppearance,
) {
  const instance = create(scene).instantiate(name, 0);
  // Remove the hidden template without releasing the instance's materials.
  scene.getTransformNodeByName(`${name}-template`)!.dispose(false, false);
  return instance.root;
}

function wolf(scene: Scene, name: string) {
  const root = actorParts(scene, name, createWolfAppearance);
  skin(root);
  const hips = root
    .getChildTransformNodes()
    .filter((node) => /wolf-leg-\d$/.test(node.name));
  const head = root
    .getChildTransformNodes()
    .find((node) => node.name.endsWith("wolf-head-joint"))!;
  clip(root, "idle", 2, (seconds) => {
    head.rotation.x = -0.15 + Math.sin(seconds * Math.PI) * 0.025;
  });
  clip(root, "walk", 1, (seconds) => {
    hips.forEach((hip, index) => {
      hip.rotation.x =
        Math.sin(
          seconds * Math.PI * 2 + (index === 0 || index === 3 ? 0 : Math.PI),
        ) * 0.55;
    });
  });
  clip(root, "run", 1, (seconds) => {
    const phase = seconds * Math.PI * 2;
    hips.forEach((hip, index) => {
      hip.rotation.x = Math.sin(phase + (index < 2 ? 0 : Math.PI)) * 0.85;
    });
    root.position.y = (1 - Math.cos(phase * 2)) * 0.035;
    head.rotation.x = -0.15 - Math.sin(phase) * 0.08;
  });
  for (const [name, sign] of [
    ["turn-left", -1],
    ["turn-right", 1],
  ] as const)
    clip(
      root,
      name,
      0.3,
      (seconds) => {
        const amount = seconds / 0.3;
        root.rotation.z = -sign * amount * 0.12;
        head.rotation.y = sign * amount * 0.18;
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
    },
    false,
  );
  clip(
    root,
    "bite",
    0.4,
    (seconds) => {
      const lunge = Math.sin((seconds / 0.4) * Math.PI);
      head.rotation.x = -0.15 - lunge * 0.45;
      root.position.z = lunge * 0.18;
    },
    false,
  );
  clip(root, "death", 0.8, (seconds) => {
    const fall = (seconds / 0.8) ** 2;
    root.rotation.z = (fall * Math.PI) / 2;
    root.position.y = fall * 0.18;
    hips.forEach((hip) => {
      hip.rotation.x = -fall * 0.3;
    });
  });
}

function harvester(scene: Scene, name: string) {
  const root = actorParts(scene, name, createHarvesterAppearance);
  const drill = scene.getTransformNodeByName("harvester-drill")!;
  const amber = scene.getMeshByName("harvester-work-beacon")!;
  amber.name = "idle-signal";
  const green = amber.clone("working-signal", root)!;
  green.material = surface(scene, "working-light", [0.2, 1, 0.65], 0.25);
  const hopper = MeshBuilder.CreateBox(
    "harvester-hopper",
    {
      width: 0.5,
      height: 0.28,
      depth: 0.42,
    },
    scene,
  );
  hopper.parent = root;
  hopper.position.set(0, 0.73, -0.35);
  hopper.material = scene.getMaterialByName("harvester-steel");
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

/**
 * A building's articulated parts, with one loop of their motion as idle and a
 * clip named for each activity.
 */
function building(factory: TilePlacedActorDetailsFactory) {
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

/** A unit cube that placement scales to fit. */
function cube(color: [number, number, number]) {
  return (scene: Scene, name: string) => {
    const root = new TransformNode(name, scene);
    const mesh = MeshBuilder.CreateBox(name, { size: 1 }, scene);
    mesh.parent = root;
    mesh.material = surface(scene, name, color);
  };
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

/** Broken slabs and bent beams within the unit cube that placement scales. */
function rubble(scene: Scene, name: string) {
  const root = new TransformNode(name, scene);
  const random = seededRandom(0x5ab0);
  const pieces = new Map<string, Mesh[]>([
    ["concrete", []],
    ["scorched", []],
    ["metal", []],
  ]);
  for (let index = 0; index < 16; index++) {
    const width = 0.14 + random() * 0.3;
    const height = 0.25 + random() * 0.65;
    const depth = 0.14 + random() * 0.3;
    const chunk = MeshBuilder.CreateBox(
      `chunk-${index}`,
      { width, height, depth },
      scene,
    );
    chunk.position.set(
      (random() - 0.5) * (1 - width),
      -0.5 + height * 0.42,
      (random() - 0.5) * (1 - depth),
    );
    chunk.rotation.set(
      (random() - 0.5) * 0.5,
      random() * Math.PI,
      (random() - 0.5) * 0.5,
    );
    pieces.get(random() < 0.3 ? "scorched" : "concrete")!.push(chunk);
  }
  for (let index = 0; index < 3; index++) {
    const beam = MeshBuilder.CreateBox(
      `beam-${index}`,
      { width: 0.06, height: 0.12, depth: 0.7 + random() * 0.2 },
      scene,
    );
    beam.position.set((random() - 0.5) * 0.5, -0.25, (random() - 0.5) * 0.3);
    beam.rotation.set(0.35 + random() * 0.3, random() * Math.PI, 0);
    pieces.get("metal")!.push(beam);
  }
  for (const [part, color] of [
    ["concrete", [0.3, 0.29, 0.27]],
    ["scorched", [0.12, 0.11, 0.1]],
    ["metal", [0.4, 0.38, 0.35]],
  ] as const)
    merge(
      root,
      part,
      pieces.get(part)!,
      surface(scene, `rubble-${part}`, [...color]),
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

const circleBuilding =
  (id: CircleStructureId) => (scene: Scene, name: string) => {
    const { root, pose } = createCircleStructure(scene, id);
    // Keep the animated focus separate; static parts batch by growth layer.
    for (const layer of ["roots", "ribs", "canopy"]) {
      const groups = new Map<StandardMaterial, Mesh[]>();
      for (const mesh of root.getChildMeshes()) {
        if (
          !(mesh instanceof Mesh) ||
          !mesh.name.includes(`growth-${layer}`) ||
          mesh.name.endsWith("-focus")
        )
          continue;
        const material = mesh.material as StandardMaterial;
        const group = groups.get(material) ?? [];
        group.push(mesh);
        groups.set(material, group);
      }
      for (const [material, parts] of groups)
        merge(
          root,
          `${name}-growth-${layer}-${material.name}`,
          parts,
          material,
        );
    }
    clip(root, "idle", 2, pose, false);
  };
/** Each model's builder fills an empty scene with nodes, materials, and clips. */
const BUILDERS = {
  "circle-heartgrove": circleBuilding("circle-heartgrove"),
  "circle-conservatory": circleBuilding("circle-conservatory"),
  "circle-musterhall": circleBuilding("circle-musterhall"),
  "cultivation-site": circleBuilding("cultivation-site"),
  "command-center": building(createCommandCenterDetails),
  barracks: building(createBarracksDetails),
  refinery: building(createRefineryDetails),
  harvester,
  wolf,
  "materials-mound": materialsMound,
  salvage,
  rubble,
  foundation: cube([0.35, 0.42, 0.46]),
  scaffold,
  tracer,
  bolt,
  bite,
  smoke,
  fire,
  leaf: (scene, name) => {
    const leaf = MeshBuilder.CreateSphere(
      name,
      { diameter: 1, segments: 4 },
      scene,
    );
    leaf.scaling.set(0.35, 0.06, 0.16);
    leaf.material = surface(scene, name, [0.24, 0.42, 0.19]);
  },
  wound,
  bird,
  regeneration,
} satisfies Record<string, (scene: Scene, name: string) => void>;

export type ModelAsset = keyof typeof BUILDERS;
export const MODEL_ASSETS = Object.keys(BUILDERS) as ModelAsset[];

/** Exports model geometry, materials, rigs, and clips from code alone. */
export function exportModelAsset(kind: ModelAsset): Promise<Uint8Array> {
  return exportGlb(kind, (scene) => BUILDERS[kind](scene, kind));
}
