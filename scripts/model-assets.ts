import {
  Color3,
  Color4,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  TransformNode,
  Vector3,
  VertexBuffer,
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
import { CIRCLE_MODELS, leafBlade } from "./circle-models.ts";
import { exportGlb } from "./glb-export.ts";
import {
  batches,
  byMaterial,
  clip,
  loft,
  merge,
  paint,
  place,
  skin,
  surface,
  tube,
  unlit,
} from "./model-toolkit.ts";
import { seededRandom } from "./sprite-sheet.ts";

import type { Scene } from "@babylonjs/core";
import type { Vec3 } from "./model-toolkit.ts";
import type { TilePlacedActorDetailsFactory } from "../src/render/tile-placed-actor-view.ts";

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
    [width, height, depth]: Vec3,
    position: Vec3,
    material: StandardMaterial,
    rotation?: Vec3,
  ) =>
    place(MeshBuilder.CreateBox(part, { width, height, depth }, scene), {
      parent: hopper,
      material,
      position,
      rotation,
    });
  hopperPlate("hopper-floor", [0.43, 0.06, 0.49], [0, -0.12, 0], rubber);
  hopperPlate("hopper-bulkhead", [0.56, 0.26, 0.055], [0, 0.02, 0.245], steel);
  hopperPlate(
    "hopper-discharge-lip",
    [0.47, 0.08, 0.07],
    [0, -0.09, -0.245],
    steel,
  );
  for (const side of [-1, 1]) {
    hopperPlate(
      "hopper-side",
      [0.065, 0.27, 0.55],
      [side * 0.245, 0.01, 0],
      steel,
      [0, 0, side * -0.32],
    );
    hopperPlate(
      "hopper-rim",
      [0.078, 0.048, 0.56],
      [side * 0.285, 0.14, 0],
      rubber,
    );
  }
  for (const z of [-0.13, 0, 0.13])
    hopperPlate(
      "hopper-floor-cleat",
      [0.4, 0.028, 0.033],
      [0, -0.084, z],
      steel,
    );
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

/** Batches only meshes that share a material and move with the same node. */
function batchStaticParts(
  root: TransformNode,
  preserve: readonly string[] = [],
) {
  const boundaries = new Set<unknown>(
    root
      .getScene()
      .animationGroups.flatMap((group) =>
        group.targetedAnimations.map(({ target }) => target),
      ),
  );
  for (const node of root.getDescendants(false))
    if (preserve.includes(node.name)) boundaries.add(node);

  const groups = new Map<TransformNode, Mesh[]>();
  for (const mesh of root.getChildMeshes()) {
    if (!(mesh instanceof Mesh) || boundaries.has(mesh)) continue;
    // Merging disposes source meshes, so leave hierarchy parents in place.
    if (mesh.getChildren().length > 0) continue;
    let parent = mesh.parent;
    while (parent && parent !== root && !boundaries.has(parent))
      parent = parent.parent;
    const pivot = parent instanceof TransformNode ? parent : root;
    const parts = groups.get(pivot) ?? [];
    parts.push(mesh);
    groups.set(pivot, parts);
  }
  for (const [pivot, parts] of groups)
    for (const [material, group] of byMaterial(parts)) {
      if (group.length > 1)
        merge(pivot, `${pivot.name}-static-${material.name}`, group, material);
    }
}

/** Exports a building's idle loop and a clip for each activity. */
function building(
  factory: TilePlacedActorDetailsFactory,
  preserve: readonly string[] = [],
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
    batchStaticParts(root, preserve);
  };
}

/** A unit-length shot along +Z that hits scale to their range. */
function tracer(scene: Scene, name: string) {
  const root = new TransformNode(name, scene);
  const tail = new Color3(1, 0.73, 0.36).toLinearSpace();
  const hot = Color3.Lerp(TRACER_COLOR, Color3.White(), 0.65).toLinearSpace();
  const beam = tube(
    scene,
    "beam",
    [0, 0.19, 0.61, 0.88, 1].map((z) => [0, 0, z]),
    [0.013, 0.017, 0.023, 0.03, 0.007],
  );
  paint(beam, (_x, _y, z) => Color3.Lerp(tail, hot, Math.min(1, z / 0.88)));
  place(beam, { parent: root, material: unlit(scene, name, Color3.White()) });
}

function rocket(scene: Scene, name: string) {
  const root = new TransformNode(name, scene);
  const core = tube(
    scene,
    "rocket-streak",
    [0.46, 0.63, 0.8, 0.92, 0.97, 1].map((z) => [0, 0, z]),
    [0.006, 0.016, 0.033, 0.055, 0.039, 0.009],
  );
  const ember = new Color3(0.88, 0.35, 0.1).toLinearSpace();
  const gold = ROCKET_COLOR.toLinearSpace();
  const pale = new Color3(1, 0.93, 0.65).toLinearSpace();
  paint(core, (_x, _y, z) =>
    z < 0.8
      ? Color3.Lerp(ember, gold, (z - 0.46) / 0.34)
      : Color3.Lerp(gold, pale, (z - 0.8) / 0.2),
  );
  place(core, {
    parent: root,
    material: unlit(scene, `${name}-hot`, Color3.White()),
  });

  const puffs = [
    [-0.07, 0.07, 0.08, 0.24, 0.09],
    [0.045, 0.08, 0.19, 0.29, 0.13],
    [-0.058, 0.04, 0.31, 0.24, 0.12],
    [0.05, 0.052, 0.42, 0.23, 0.11],
    [-0.045, 0.029, 0.53, 0.2, 0.1],
    [0.031, 0.023, 0.64, 0.16, 0.09],
    [-0.025, 0.01, 0.74, 0.13, 0.075],
  ] as const;
  const smoke = surface(scene, `${name}-smoke`, Color3.White());
  smoke.alpha = 0.8;
  const wake = merge(
    root,
    "rocket-smoke",
    puffs.map(([x, y, z, width, length], index) =>
      place(
        MeshBuilder.CreateIcoSphere(
          `trail-${index}`,
          { radius: 0.5, subdivisions: 2 },
          scene,
        ),
        { position: [x, y, z], scaling: [width, width * 0.86, length] },
      ),
    ),
    smoke,
  );
  const ash = new Color3(0.67, 0.64, 0.57);
  const soot = new Color3(0.39, 0.36, 0.33);
  paint(wake, (_x, y, z) =>
    Color3.Lerp(soot, ash, Math.max(0, Math.min(1, 0.64 - z * 0.75 + y * 1.6))),
  );
}

function rocketImpact(scene: Scene, name: string) {
  const root = new TransformNode(name, scene);
  const bloom = new TransformNode("impact-bloom", scene);
  bloom.parent = root;

  const lobes = [
    [0, 0.03, 0, 0.28],
    [-0.17, 0.06, 0.06, 0.19],
    [0.17, -0.02, -0.065, 0.18],
    [0.04, 0.16, 0.09, 0.16],
    [-0.045, -0.055, -0.17, 0.15],
  ] as const;
  const sparks = [
    [0.51, 0.24, 0.16],
    [-0.42, 0.34, -0.22],
    [0.08, 0.53, -0.12],
    [-0.19, 0.22, 0.48],
    [0.31, -0.13, -0.41],
    [-0.48, -0.15, 0.19],
    [0.17, -0.22, 0.37],
  ] as const;
  const flare = merge(
    bloom,
    "impact-flare",
    [
      ...lobes.map(([x, y, z, radius], index) =>
        place(
          MeshBuilder.CreateIcoSphere(
            `impact-lobe-${index}`,
            { radius, subdivisions: 2 },
            scene,
          ),
          { position: [x, y, z], scaling: [1, 0.85, 1] },
        ),
      ),
      ...sparks.map(([x, y, z], index) =>
        tube(
          scene,
          `impact-spark-${index}`,
          [0.59, 0.77, 1].map((reach) => [x * reach, y * reach, z * reach]),
          [0.018, 0.044, 0.004],
        ),
      ),
    ],
    unlit(scene, "impact-hot", Color3.White()),
  );
  const pale = new Color3(1, 0.94, 0.69).toLinearSpace();
  const amber = new Color3(1, 0.63, 0.19).toLinearSpace();
  const ember = new Color3(0.92, 0.31, 0.1).toLinearSpace();
  paint(flare, (x, y, z) => {
    const distance = Math.hypot(x, y * 0.85, z);
    return distance < 0.36
      ? Color3.Lerp(pale, amber, Math.max(0, (distance - 0.24) / 0.12))
      : Color3.Lerp(amber, ember, Math.min(1, (distance - 0.36) / 0.21));
  });

  const smoke = surface(scene, "impact-ash", [0.43, 0.38, 0.33]);
  smoke.alpha = 0.64;
  const puffs = [
    [-0.29, -0.04, -0.09, 0.23],
    [0.27, -0.08, -0.19, 0.24],
    [0.12, -0.11, 0.28, 0.22],
    [-0.2, -0.13, 0.27, 0.19],
    [-0.04, -0.06, -0.33, 0.21],
  ] as const;
  merge(
    bloom,
    "impact-smoke",
    puffs.map(([x, y, z, radius], index) =>
      place(
        MeshBuilder.CreateIcoSphere(
          `impact-ash-${index}`,
          { radius, subdivisions: 2 },
          scene,
        ),
        { position: [x, y, z], scaling: [1, 0.66, 1] },
      ),
    ),
    smoke,
  );
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
      return [
        bend + Math.cos(angle) * radius,
        Math.sin(angle) * radius,
        z,
      ] as const;
    });
    const vine = tube(
      scene,
      `living-strand-${strand}`,
      path,
      path.map(
        (_, index) =>
          0.009 +
          Math.sin((index * Math.PI) / 24) * (strand === 0 ? 0.024 : 0.012),
      ),
    );
    vine.parent = root;
    vine.material = material;
    return vine;
  });
  const petals = Array.from({ length: 4 }, (_, index) => {
    const angle = ((index + 0.25) * Math.PI) / 2;
    const point = (radius: number, sweep: number, z: number): Vec3 => [
      Math.cos(angle + sweep) * radius,
      Math.sin(angle + sweep) * radius,
      z,
    ];
    return tube(
      scene,
      "impact-petal",
      [
        point(0, 0, 1),
        point(0.09, 0.15, 0.976),
        point(0.16, 0.28, 0.964),
        point(0.24, 0.46, 0.966),
      ],
      [0.012, 0.035, 0.027, 0.004],
      5,
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
    return tube(
      scene,
      "claw-slash",
      profile.map(({ x, y, z }) => [
        x * length + side * 0.2,
        y * length + side * 0.04,
        z + side * 0.08,
      ]),
      profile.map(({ radius }) => radius * length),
    );
  });
  const marks = Mesh.MergeMeshes(slashes, true, true)!;
  marks.name = "claw-marks";
  const edge = BITE_COLOR.toLinearSpace();
  const middle = new Color3(1, 0.75, 0.57).toLinearSpace();
  paint(marks, (_x, y) =>
    Color3.Lerp(edge, middle, Math.max(0, 1 - Math.abs(y - 0.07) / 0.28)),
  );
  place(marks, { parent: root, material: unlit(scene, name, Color3.White()) });
}

/** A fan of split wood and violet arcs at the point of impact. */
function strike(scene: Scene, name: string) {
  const root = new TransformNode(name, scene);
  const wood = STRIKE_COLOR.toLinearSpace();
  const pale = new Color3(1, 0.95, 0.78).toLinearSpace();
  const bark = new Color3(0.58, 0.36, 0.19).toLinearSpace();
  const splinters = [
    [-0.32, 0.12, 0.07, 0.25, 0.054, 1.1],
    [-0.19, 0.29, 0.07, 0.37, 0.059, 0.49],
    [0.02, 0.34, -0.07, 0.43, 0.063, -0.15],
    [0.21, 0.24, 0.09, 0.31, 0.063, -0.66],
    [0.38, 0.08, 0.01, 0.22, 0.054, -1.15],
    [0.12, -0.12, 0.25, 0.19, 0.054, -2.2],
    [-0.26, -0.08, -0.17, 0.16, 0.048, 2.3],
  ] as const;
  merge(
    root,
    "strike-splinters",
    splinters.map(([x, y, z, length, width, angle], index) => {
      const shard = loft(
        [
          [
            [-width * 0.56, -length * 0.5, 0],
            [0, -length * 0.53, -width * 0.35],
            [width * 0.58, -length * 0.47, 0],
            [0, -length * 0.43, width * 0.48],
          ],
          [
            [-width, -length * 0.08, 0],
            [0, length * 0.03, -width * 0.58],
            [width * 0.86, length * 0.1, 0],
            [0, length * 0.04, width * 0.54],
          ],
        ],
        [width * 0.28, length * 0.5, -width * 0.13],
      );
      const mesh = MeshBuilder.CreatePolyhedron(
        `strike-shard-${index}`,
        { custom: shard },
        scene,
      );
      paint(mesh, (_x, height, depth) =>
        depth > width * 0.3
          ? bark
          : Color3.Lerp(wood, pale, Math.max(0, height / length) * 2),
      );
      return place(mesh, {
        position: [x, y, z],
        rotation: [0.34 - index * 0.12, index * 0.67, angle],
      });
    }),
    unlit(scene, "strike-wood", Color3.White()),
  );

  const arcs = [
    [0.08, 2.71, 0.41, 0.25, 0.07],
    [3.31, 5.94, 0.32, 0.17, 0.02],
  ] as const;
  const violet = BOLT_COLOR.toLinearSpace();
  const lilac = new Color3(0.96, 0.78, 1).toLinearSpace();
  const sweeps = arcs.map(([start, end, width, height, lift], index) => {
    const path = Array.from({ length: 13 }, (_, step): Vec3 => {
      const angle = start + ((end - start) * step) / 12;
      return [
        Math.cos(angle) * width,
        lift + Math.sin(angle) * height,
        Math.sin(angle) * 0.19,
      ];
    });
    const sweep = tube(
      scene,
      `strike-arc-${index}`,
      path,
      path.map((_, step) => 0.004 + 0.032 * Math.sin((step * Math.PI) / 12)),
    );
    return paint(sweep, (x) =>
      Color3.Lerp(violet, lilac, Math.max(0, 1 - Math.abs(x) / width)),
    );
  });
  merge(
    root,
    "strike-arcs",
    sweeps,
    unlit(scene, "strike-violet", Color3.White()),
  );
}

/** A terrain-seated slab module with a sloped shoulder and recessed joints. */
function foundation(scene: Scene, name: string) {
  const root = new TransformNode(name, scene);
  const square = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ] as const;
  const ring = (half: number, y: number) =>
    square.map(([x, z]): Vec3 => [x * half, y, z * half]);
  const footing = new Color4(0.23, 0.28, 0.3, 1);
  const shoulder = new Color4(0.43, 0.48, 0.47, 1);
  const deck = new Color4(0.59, 0.63, 0.59, 1);
  // Loft faces: bottom, top, then each band of sides from the ground up.
  const faceColors = [
    footing,
    deck,
    ...square.map(() => footing),
    ...square.map(() => shoulder),
  ];
  const mesh = MeshBuilder.CreatePolyhedron(
    name,
    {
      custom: loft([ring(0.5, -0.5), ring(0.5, 0.08), ring(0.45, 0.5)]),
      faceColors,
    },
    scene,
  );
  place(mesh, { parent: root, material: surface(scene, name, Color3.White()) });
}

/** An exposed vein of tilted ore blades in a low, fractured rock bed. */
function materialsMound(scene: Scene, name: string) {
  const root = new TransformNode(name, scene);
  const pieces = batches(root, {
    ore: surface(scene, "materials", MATERIALS_COLOR, 0.24),
    "ore-bright": surface(scene, "materials-bright", [0.42, 0.75, 0.79], 0.27),
    bed: surface(scene, "materials-bed", [0.34, 0.31, 0.25]),
  });
  const outline = [
    [-0.52, -0.33],
    [-0.22, -0.53],
    [0.48, -0.35],
    [0.56, 0.21],
    [0.23, 0.51],
    [-0.47, 0.32],
  ] as const;
  const shoulders = [0.73, 0.87, 0.8, 0.57, 0.49, 0.62];
  const crystal = loft(
    [
      outline.map(([x, z]): Vec3 => [x, 0, z]),
      outline.map(([x, z], i): Vec3 => [
        x * 0.82 + 0.12,
        shoulders[i]!,
        z * 0.72,
      ]),
    ],
    [0.04, 1, -0.11],
  );
  for (const [part, x, z, width, height, depth, lean, yaw] of [
    ["ore", -0.1, 0.02, 0.33, 0.83, 0.27, 0.28, 0.5],
    ["ore-bright", 0.13, -0.05, 0.28, 0.68, 0.23, 0.43, 0.62],
    ["ore", 0.21, 0.14, 0.2, 0.46, 0.18, 0.45, 0.8],
    ["ore-bright", -0.21, 0.16, 0.19, 0.36, 0.18, 0.45, -1.5],
    ["ore", -0.22, -0.13, 0.18, 0.33, 0.17, 0.34, -2],
    ["ore-bright", 0.06, 0.25, 0.13, 0.25, 0.14, 0.63, 1.1],
  ] as const) {
    const blade = MeshBuilder.CreatePolyhedron(
      "blade",
      { custom: crystal, sizeX: width, sizeY: height, sizeZ: depth },
      scene,
    );
    pieces.add(
      part,
      place(blade, { position: [x, 0.06, z], rotation: [lean, yaw, 0] }),
    );
  }
  for (const [x, z, width, height, depth, yaw] of [
    [-0.15, 0, 0.25, 0.13, 0.23, 0.3],
    [0.15, 0.05, 0.24, 0.16, 0.24, -0.55],
    [-0.02, -0.23, 0.25, 0.12, 0.14, 0.52],
    [-0.19, 0.22, 0.16, 0.08, 0.11, -0.38],
    [0.19, 0.25, 0.15, 0.1, 0.1, 0.2],
  ] as const) {
    const stone = MeshBuilder.CreatePolyhedron(
      "stone",
      { type: 2, sizeX: width, sizeY: height, sizeZ: depth },
      scene,
    );
    pieces.add(
      "bed",
      place(stone, { position: [x, height, z], rotation: [0, yaw, 0] }),
    );
  }
  pieces.merge();
}

/** Fractured ARC panels and framing, sized to fit a rotated footprint tile. */
function rubble(scene: Scene, name: string) {
  const root = new TransformNode(name, scene);
  const random = seededRandom(0x5ab0);
  const pieces = batches(root, {
    concrete: surface(scene, "rubble-concrete", [0.39, 0.37, 0.33]),
    scorched: surface(scene, "rubble-scorched", [0.18, 0.17, 0.16]),
    armor: surface(scene, "rubble-armor", [0.49, 0.59, 0.57]),
    metal: surface(scene, "rubble-metal", [0.26, 0.3, 0.3]),
  });
  const perimeter = [
    [-0.5, -0.25],
    [-0.12, -0.5],
    [0.41, -0.38],
    [0.5, 0.02],
    [0.19, 0.5],
    [-0.4, 0.37],
  ] as const;
  const fracturedSlab = loft(
    [
      perimeter.map(([x, z]): Vec3 => [x, -0.5, z]),
      perimeter.map(([x, z], index): Vec3 => [
        x * 0.88,
        index % 2 ? 0.22 : 0.5,
        z * 0.84,
      ]),
    ],
    [0.02, 0.42, -0.08],
  );
  const slab = (
    part: "concrete" | "scorched" | "armor",
    scaling: Vec3,
    position: Vec3,
    rotation: Vec3,
  ) =>
    pieces.add(
      part,
      place(
        MeshBuilder.CreatePolyhedron(part, { custom: fracturedSlab }, scene),
        { position, rotation, scaling },
      ),
    );
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
  for (const [index, path] of (
    [
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
    ] as const
  ).entries())
    pieces.add("metal", tube(scene, `bent-frame-${index}`, path, 0.041, 4));
  pieces.merge();
}

/** A neutral recovery case with reinforced ends and an amber locator. */
function salvage(scene: Scene, name: string) {
  const root = new TransformNode(name, scene);
  const pieces = batches(root, {
    shell: surface(scene, "salvage-shell", [0.49, 0.5, 0.46]),
    frame: surface(scene, "salvage-frame", [0.19, 0.23, 0.23]),
    lamp: surface(scene, "salvage-lamp", SALVAGE_COLOR, 0.55),
  });
  const box = (
    part: "frame" | "lamp",
    position: Vec3,
    [width, height, depth]: Vec3,
  ) =>
    pieces.add(
      part,
      place(
        MeshBuilder.CreateBox(
          `${part}-${pieces.count(part)}`,
          { width, height, depth },
          scene,
        ),
        { position },
      ),
    );
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
  const ring = (scale: number, y: number) =>
    outline.map(([x, z]): Vec3 => [x * scale, y, z * scale]);
  pieces.add(
    "shell",
    MeshBuilder.CreatePolyhedron(
      "case",
      { custom: loft([ring(0.9, -0.23), ring(1, 0.13), ring(0.83, 0.24)]) },
      scene,
    ),
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
  pieces.merge();
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
  const pieces = batches(root, {
    frame: surface(scene, "scaffold-frame", [0.17, 0.24, 0.27]),
    fittings: surface(scene, "scaffold-fittings", [0.35, 0.43, 0.45]),
    safety: surface(scene, "scaffold-safety", [0.9, 0.59, 0.19]),
  });
  const beam = (
    part: "frame" | "fittings" | "safety",
    [width, height, depth]: Vec3,
    position: Vec3,
    tilt = 0,
    yaw = 0,
  ) =>
    pieces.add(
      part,
      place(
        MeshBuilder.CreateBox(
          `beam-${pieces.count(part)}`,
          { width, height, depth },
          scene,
        ),
        { position, rotation: [0, yaw, tilt] },
      ),
    );
  const edge = 0.445;
  const sides = [-edge, edge];
  for (const x of sides)
    for (const z of sides) {
      beam("frame", [0.055, 0.94, 0.055], [x, 0, z]);
      beam("fittings", [0.11, 0.1, 0.11], [x, -0.45, z]);
      beam("safety", [0.091, 0.17, 0.091], [x, 0.415, z]);
    }

  const lower = -0.36;
  const upper = 0.41;
  const span = upper - lower;
  const diagonal = Math.hypot(edge, span);
  const lean = Math.atan2(span, edge);
  for (const yaw of [0, Math.PI / 2]) {
    for (const side of sides) {
      const at = (along: number, y: number): Vec3 =>
        yaw ? [side, y, -along] : [along, y, side];
      beam("frame", [2 * edge, 0.075, 0.05], at(0, lower), 0, yaw);
      beam("frame", [2 * edge, 0.09, 0.055], at(0, upper), 0, yaw);
      beam("frame", [0.035, span, 0.035], at(0, (lower + upper) / 2));
      for (const sign of [-1, 1]) {
        beam(
          "fittings",
          [diagonal, 0.035, 0.026],
          at((sign * edge) / 2, (lower + upper) / 2),
          sign * lean,
          yaw,
        );
        beam("safety", [0.14, 0.075, 0.065], at(sign * 0.352, upper), 0, yaw);
      }
    }
  }
  pieces.merge();
}

/** A curled, translucent puff scaled and faded by the damage view. */
function smoke(scene: Scene, name: string) {
  const root = new TransformNode(name, scene);
  const material = surface(scene, name, Color3.White());
  material.alpha = 0.86;
  const puff = place(
    MeshBuilder.CreateIcoSphere(
      "puff",
      { radius: 1, subdivisions: 3, flat: false },
      scene,
    ),
    { parent: root, material },
  );
  const soot = new Color3(0.36, 0.36, 0.36);
  const ash = new Color3(0.72, 0.71, 0.68);
  paint(puff, (_x, y) => Color3.Lerp(soot, ash, (y + 1) / 2));
  const positions = puff.getVerticesData(VertexBuffer.PositionKind)!;
  for (let index = 0; index < positions.length; index += 3) {
    const x = positions[index]!;
    const y = positions[index + 1]!;
    const z = positions[index + 2]!;
    const roll = Math.sin(4 * x + 3 * y) * Math.cos(4 * z - 2 * y);
    const radius = 0.42 + 0.07 * y + 0.08 * roll;
    positions[index] = x * radius + 0.13 * y;
    positions[index + 1] = y * 0.47 + 0.06 * roll;
    positions[index + 2] = z * radius + 0.1 * y * y;
  }
  puff.setVerticesData(VertexBuffer.PositionKind, positions);
}

/** Flickering flame tongues with rising sparks, based at the origin. */
function fire(scene: Scene, name: string) {
  const root = new TransformNode(name, scene);
  const material = unlit(scene, name, Color3.White());
  const hot = new Color3(1, 0.96, 0.64).toLinearSpace();
  const orange = new Color3(1, 0.48, 0.1).toLinearSpace();
  const flames = (
    [
      [0.18, 0.8, 0, 0, 0.2, -0.07],
      [0.13, 0.56, -0.14, 0.075, -0.19, 0.06],
      [0.12, 0.49, 0.14, -0.1, 0.15, 0.11],
    ] as const
  ).map(([width, height, x, z, bendX, bendZ], index) => {
    const node = new TransformNode(`flame-${index}`, scene);
    node.parent = root;
    node.position.set(x, 0, z);
    const tongue = MeshBuilder.CreateLathe(
      `flame-${index}-tongue`,
      {
        shape: [
          new Vector3(0, height, 0),
          new Vector3(width * 0.2, height * 0.73, 0),
          new Vector3(width * 0.61, height * 0.46, 0),
          new Vector3(width, height * 0.19, 0),
          new Vector3(width * 0.8, 0, 0),
          Vector3.Zero(),
        ],
        tessellation: 7,
      },
      scene,
    );
    paint(tongue, (_x, y) =>
      Color3.Lerp(hot, orange, Math.min(1, (y / height) * 1.35)),
    );
    const positions = tongue.getVerticesData(VertexBuffer.PositionKind)!;
    for (let vertex = 0; vertex < positions.length; vertex += 3) {
      const sweep = (positions[vertex + 1]! / height) ** 2;
      positions[vertex] = positions[vertex]! + bendX * sweep;
      positions[vertex + 2] = positions[vertex + 2]! + bendZ * sweep;
    }
    tongue.setVerticesData(VertexBuffer.PositionKind, positions);
    place(tongue, { parent: node, material });
    return node;
  });
  const sparkMaterial = unlit(scene, "spark", new Color3(1, 0.85, 0.45));
  const sparks = [0, 1, 2].map((index) => {
    const spark = MeshBuilder.CreatePolyhedron(
      `spark-${index}`,
      { type: 1, sizeX: 0.024, sizeY: 0.052, sizeZ: 0.024 },
      scene,
    );
    spark.parent = root;
    spark.position.set((index - 1) * 0.12, 0.3, (index % 2) * 0.1 - 0.05);
    spark.material = sparkMaterial;
    return spark;
  });
  const seconds = 0.6;
  clip(
    root,
    "flicker",
    seconds,
    (time) => {
      const phase = (time / seconds) * Math.PI * 2;
      flames.forEach((flame, index) => {
        const wave = phase * (index % 2 ? 2 : 1) + index;
        flame.scaling.y = 1 + Math.sin(wave) * 0.2;
        flame.rotation.z = Math.cos(wave) * 0.13;
      });
      sparks.forEach((spark, index) => {
        const rise = (time / seconds + index / sparks.length) % 1;
        spark.position.x += (index - 1) * rise * 0.16;
        spark.position.y += rise * 0.9;
        spark.scaling.setAll(Math.min(1, rise * 9) * (1 - rise));
      });
    },
    false,
  );
}

/** A wilted leaf shed by damaged living constructs. */
function leaf(scene: Scene, name: string) {
  const mesh = leafBlade(scene, name);
  mesh.scaling.set(0.29, 0.13, 0.58);
  mesh.material = surface(scene, name, Color3.White());
  const green = new Color3(0.55, 0.63, 0.24).toLinearSpace();
  const ochre = new Color3(0.87, 0.65, 0.27).toLinearSpace();
  const underside = new Color3(0.42, 0.38, 0.14).toLinearSpace();
  paint(mesh, (x, y, z) =>
    y < 0
      ? underside
      : Color3.Lerp(green, ochre, Math.max(Math.abs(x), Math.abs(z)) * 2),
  );
}

/** A splintered chip of pale living wood shed by damaged constructs. */
function fragment(scene: Scene, name: string) {
  const splinter = loft(
    [
      [
        [-0.08, -0.19, -0.04],
        [0.01, -0.21, -0.08],
        [0.07, -0.19, -0.04],
        [0.06, -0.16, 0.05],
        [-0.07, -0.17, 0.06],
      ],
      [
        [-0.12, 0.02, -0.04],
        [-0.01, 0.09, -0.09],
        [0.11, 0.03, -0.04],
        [0.09, 0.08, 0.07],
        [-0.1, 0.04, 0.08],
      ],
    ],
    [0.13, 0.26, 0.015],
  );
  const mesh = MeshBuilder.CreatePolyhedron(name, { custom: splinter }, scene);
  mesh.material = surface(scene, name, Color3.White());
  const wood = new Color3(0.99, 0.9, 0.65).toLinearSpace();
  const bark = new Color3(0.47, 0.33, 0.18).toLinearSpace();
  paint(mesh, (_x, _y, z) => (z >= 0.05 ? bark : wood));
}

/** A faint violet wisp of light leaking from a damaged living core. */
function leak(scene: Scene, name: string) {
  const mesh = tube(
    scene,
    name,
    [
      [-0.12, -0.18, 0.04],
      [-0.06, 0.01, -0.025],
      [0.09, 0.22, -0.07],
      [0.16, 0.43, 0],
      [0.1, 0.62, 0.14],
      [-0.06, 0.8, 0.22],
    ],
    [0.008, 0.1, 0.14, 0.105, 0.06, 0.006],
    7,
  );
  mesh.material = unlit(scene, name, Color3.White());
  const violet = BOLT_COLOR.toLinearSpace();
  const lilac = new Color3(0.94, 0.76, 1).toLinearSpace();
  paint(mesh, (_x, y) =>
    Color3.Lerp(violet, lilac, Math.max(0, 1 - Math.abs(y - 0.22) / 0.42)),
  );
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
  place(drop, { parent: root, material: unlit(scene, name, Color3.White()) });
  const crimson = new Color3(0.56, 0.08, 0.14).toLinearSpace();
  const coral = new Color3(0.95, 0.42, 0.36).toLinearSpace();
  paint(drop, (_x, y) =>
    Color3.Lerp(crimson, coral, Math.max(0, 1 - Math.abs(y - 0.012) / 0.07)),
  );
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
    const ring = (y: number) =>
      perimeter.map(([x, z]): Vec3 => [side * x, y, z]);
    return MeshBuilder.CreatePolyhedron(
      name,
      { custom: loft([ring(-thickness / 2), ring(thickness / 2)]) },
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
  // The browser checks use the cabin and canopy as placement landmarks.
  "command-center": building(createCommandCenterDetails, [
    "command-center-command-cabin",
    "command-center-entry-canopy",
  ]),
  barracks: building(createBarracksDetails),
  refinery: building(createRefineryDetails),
  relay: building(createRelayDetails),
  // Runtime aim can rotate the turret independently of its authored clips.
  sentry: building(createSentryDetails, ["sentry-turret"]),
  harvester,
  wolf,
  "materials-mound": materialsMound,
  salvage,
  rubble,
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
