// Builds the placeholder infantry GLBs. The asset tests rebuild them to check
// the committed files are current.
import {
  Animation,
  AnimationGroup,
  Bone,
  Color3,
  Matrix,
  Mesh,
  MeshBuilder,
  NullEngine,
  PBRMaterial,
  Quaternion,
  Scene,
  Skeleton,
  TransformNode,
  Vector3,
  VertexBuffer,
  VertexData,
} from "@babylonjs/core";
import { GLTF2Export } from "@babylonjs/serializers/glTF/index.js";

export const INFANTRY_ROLES = ["trooper", "scout"] as const;
export type InfantryRole = (typeof INFANTRY_ROLES)[number];

type Vec3 = [number, number, number];
type Finish = "armor" | "cloth" | "accent" | "visor" | "dark";
type Joint = { name: string; parent?: string; offset: Vec3 };
type Part = {
  name: string;
  joint: string;
  shape: "box" | "sphere" | "cylinder";
  size: Vec3;
  position: Vec3;
  finish: Finish;
  tiltX?: number;
};
type Pose = (joint: string, phase: number) => Vec3;

const FRAMES_PER_SECOND = 30;
const KEY_STEP = 2;
const ROLE_SCALE: Record<InfantryRole, number> = { trooper: 1, scout: 0.84 };
const DARK: Vec3 = [0.09, 0.13, 0.15];
const PALETTES: Record<InfantryRole, Record<Exclude<Finish, "dark">, Vec3>> = {
  trooper: {
    armor: [0.68, 0.34, 0.17],
    cloth: [0.16, 0.21, 0.23],
    accent: [0.97, 0.71, 0.26],
    visor: [0.19, 0.72, 0.79],
  },
  scout: {
    armor: [0.2, 0.55, 0.62],
    cloth: [0.14, 0.24, 0.27],
    accent: [0.64, 0.9, 0.82],
    visor: [0.91, 0.76, 0.34],
  },
};

/** Both sides of a symmetric feature. Left is negative X. */
function mirrored<T>(build: (side: string, sign: number) => T[]): T[] {
  return [...build("left", -1), ...build("right", 1)];
}

const JOINTS: Joint[] = [
  { name: "pelvis", offset: [0, 0.91, 0] },
  { name: "spine", parent: "pelvis", offset: [0, 0.17, 0] },
  { name: "head", parent: "spine", offset: [0, 0.43, 0] },
  ...mirrored((side, sign): Joint[] => [
    { name: `${side}-arm`, parent: "spine", offset: [sign * 0.34, 0.27, 0] },
    {
      name: `${side}-forearm`,
      parent: `${side}-arm`,
      offset: [sign * 0.03, -0.24, 0.08],
    },
    { name: `${side}-leg`, parent: "pelvis", offset: [sign * 0.17, -0.06, 0] },
    { name: `${side}-shin`, parent: `${side}-leg`, offset: [0, -0.39, 0] },
  ]),
];

/** Positions are in the model's rest pose, relative to the ground point. */
const PARTS: Part[] = [
  part("waist", "pelvis", "box", [0.47, 0.2, 0.3], [0, 0.91, 0], "dark"),
  part("chest", "spine", "box", [0.63, 0.47, 0.34], [0, 1.31, 0], "cloth"),
  part(
    "breastplate",
    "spine",
    "box",
    [0.55, 0.34, 0.12],
    [0, 1.34, 0.22],
    "armor",
  ),
  part(
    "chest-mark",
    "spine",
    "box",
    [0.12, 0.13, 0.025],
    [0, 1.39, 0.292],
    "accent",
  ),
  part(
    "backpack",
    "spine",
    "box",
    [0.42, 0.42, 0.18],
    [0, 1.31, -0.26],
    "armor",
  ),
  part("collar", "spine", "cylinder", [0.33, 0.13, 0.33], [0, 1.54, 0], "dark"),
  part("helmet", "head", "sphere", [0.43, 0.35, 0.43], [0, 1.69, 0], "armor"),
  part("visor", "head", "box", [0.35, 0.13, 0.08], [0, 1.69, 0.2], "visor"),
  part(
    "helmet-ridge",
    "head",
    "box",
    [0.12, 0.06, 0.43],
    [0, 1.86, 0],
    "accent",
  ),
  ...mirrored((side, sign) => [
    part(
      `${side}-pauldron`,
      `${side}-arm`,
      "sphere",
      [0.3, 0.24, 0.34],
      [sign * 0.37, 1.37, 0],
      "armor",
    ),
    part(
      `${side}-upper-arm`,
      `${side}-arm`,
      "cylinder",
      [0.15, 0.29, 0.15],
      [sign * 0.38, 1.18, 0.03],
      "cloth",
    ),
    part(
      `${side}-forearm`,
      `${side}-forearm`,
      "box",
      [0.17, 0.26, 0.18],
      [sign * 0.4, 0.96, 0.12],
      "armor",
    ),
    part(
      `${side}-glove`,
      `${side}-forearm`,
      "box",
      [0.15, 0.13, 0.16],
      [sign * 0.4, 0.81, 0.16],
      "dark",
    ),
    part(
      `${side}-thigh`,
      `${side}-leg`,
      "cylinder",
      [0.23, 0.43, 0.23],
      [sign * 0.17, 0.65, 0],
      "cloth",
    ),
    part(
      `${side}-knee`,
      `${side}-shin`,
      "box",
      [0.25, 0.18, 0.12],
      [sign * 0.17, 0.45, 0.1],
      "armor",
    ),
    part(
      `${side}-shin-plate`,
      `${side}-shin`,
      "box",
      [0.21, 0.32, 0.19],
      [sign * 0.17, 0.26, 0],
      "armor",
    ),
    part(
      `${side}-boot`,
      `${side}-shin`,
      "box",
      [0.24, 0.18, 0.37],
      [sign * 0.17, 0.1, 0.08],
      "dark",
    ),
  ]),
  part(
    "rifle-body",
    "spine",
    "box",
    [0.17, 0.16, 0.65],
    [0.12, 1.12, 0.41],
    "dark",
  ),
  part(
    "rifle-barrel",
    "spine",
    "cylinder",
    [0.055, 0.42, 0.055],
    [0.12, 1.15, 0.88],
    "dark",
    Math.PI / 2,
  ),
  part(
    "rifle-sight",
    "spine",
    "box",
    [0.08, 0.07, 0.16],
    [0.12, 1.24, 0.36],
    "accent",
  ),
];

function part(
  name: string,
  joint: string,
  shape: Part["shape"],
  size: Vec3,
  position: Vec3,
  finish: Finish,
  tiltX?: number,
): Part {
  return { name, joint, shape, size, position, finish, tiltX };
}

/** Exports one role's model, skin, and clips as GLB bytes. */
export async function exportInfantry(role: InfantryRole): Promise<Uint8Array> {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  try {
    buildInfantry(scene, role);
    const name = `arc-${role}`;
    const data = await GLTF2Export.GLBAsync(scene, name);
    const blob = data.files[`${name}.glb`];
    if (!(blob instanceof Blob)) {
      throw new Error(`Exporter did not produce ${name}.glb`);
    }
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    scene.dispose();
    engine.dispose();
  }
}

function buildInfantry(scene: Scene, role: InfantryRole): void {
  const name = `arc-${role}`;
  const root = new TransformNode(name, scene);
  root.scaling.setAll(ROLE_SCALE[role]);
  const skeleton = new Skeleton(`${name}-rig`, `${name}-rig`, scene);
  const bones = new Map<string, Bone>();
  for (const { name: label, parent, offset } of JOINTS) {
    const parentBone = parent ? bones.get(parent)! : null;
    const joint = new TransformNode(label, scene);
    joint.parent = parentBone?.getTransformNode() ?? root;
    joint.position.set(...offset);
    joint.rotationQuaternion = Quaternion.Identity();
    const bone = new Bone(
      label,
      skeleton,
      parentBone,
      Matrix.Translation(...offset),
    );
    bone.linkTransformNode(joint);
    bones.set(label, bone);
  }

  // glTF colors are linear. One vertex-colored body mesh plus the glowing
  // visor keeps each soldier to two draw calls.
  const palette = { ...PALETTES[role], dark: DARK };
  const linear = (color: Vec3) => new Color3(...color).toLinearSpace();
  const body = new PBRMaterial(`${name}-body`, scene);
  body.albedoColor = Color3.White();
  body.metallic = 0;
  body.roughness = 0.7;
  const visor = new PBRMaterial(`${name}-visor`, scene);
  visor.albedoColor = Color3.White();
  visor.emissiveColor = linear(palette.visor).scale(0.35);
  visor.metallic = 0;
  visor.roughness = 0.3;

  const skinned = (label: string, parts: Part[], material: PBRMaterial) => {
    const partCounts = new Map<Part, number>();
    const [merged, ...rest] = parts.map((each) => {
      const vertices = partVertices(scene, each, linear(palette[each.finish]));
      partCounts.set(each, vertices.positions!.length / 3);
      return vertices;
    });
    merged.merge(rest, true);
    const mesh = new Mesh(`${name}-${label}`, scene);
    merged.applyToMesh(mesh);
    // Byte joint indices, as glTF stores them; floats would export padded.
    const joints = new Uint8Array(mesh.getTotalVertices() * 4);
    const weights = new Float32Array(joints.length);
    let vertex = 0;
    for (const each of parts) {
      const boneIndex = skeleton.bones.indexOf(bones.get(each.joint)!);
      const end = vertex + partCounts.get(each)!;
      for (; vertex < end; vertex++) {
        joints[vertex * 4] = boneIndex;
        weights[vertex * 4] = 1;
      }
    }
    mesh.setVerticesBuffer(
      new VertexBuffer(
        scene.getEngine(),
        joints,
        VertexBuffer.MatricesIndicesKind,
        {
          size: 4,
        },
      ),
    );
    mesh.setVerticesData(VertexBuffer.MatricesWeightsKind, weights);
    mesh.skeleton = skeleton;
    mesh.material = material;
    mesh.parent = root;
  };
  skinned(
    "body",
    PARTS.filter(({ finish }) => finish !== "visor"),
    body,
  );
  skinned(
    "visor",
    PARTS.filter(({ finish }) => finish === "visor"),
    visor,
  );

  const clip = (
    clipName: string,
    endFrame: number,
    pose: Pose,
    joints = [...bones.keys()],
  ) => {
    const group = new AnimationGroup(clipName, scene);
    for (const joint of joints) {
      group.addTargetedAnimation(
        keyed(`${clipName}-${joint}`, "rotationQuaternion", endFrame, (phase) =>
          Quaternion.FromEulerAngles(...pose(joint, phase)),
        ),
        bones.get(joint)!.getTransformNode(),
      );
    }
    return group;
  };
  /** Keys the pelvis moving `offset` from its rest position. */
  const shift = (
    group: AnimationGroup,
    endFrame: number,
    offset: (phase: number) => Vec3,
  ) => {
    const rest = new Vector3(...JOINTS[0].offset);
    group.addTargetedAnimation(
      keyed(`${group.name}-pelvis`, "position", endFrame, (phase) =>
        rest.add(new Vector3(...offset(phase))),
      ),
      bones.get("pelvis")!.getTransformNode(),
    );
  };
  const neutral = (joint: string): Vec3 => {
    if (joint === "left-arm") return [0, 0, -0.08];
    if (joint === "right-arm") return [0, 0, 0.08];
    return [0, 0, 0];
  };

  const idle = clip("idle", 60, (joint, phase) =>
    joint === "head" ? [Math.sin(phase) * 0.025, 0, 0] : neutral(joint),
  );
  shift(idle, 60, (phase) => [0, (Math.cos(phase) - 1) * 0.004, 0]);
  const walk = clip("walk", 30, (joint, phase) => {
    const stride = Math.sin(phase);
    switch (joint) {
      case "left-leg":
        return [stride * 0.62, 0, 0];
      case "right-leg":
        return [-stride * 0.62, 0, 0];
      case "left-shin":
        return [-Math.max(0, stride) * 0.52, 0, 0];
      case "right-shin":
        return [-Math.max(0, -stride) * 0.52, 0, 0];
      case "left-arm":
        return [-stride * 0.19, 0, -0.08];
      case "right-arm":
        return [stride * 0.19, 0, 0.08];
      case "spine":
        return [0, 0, Math.sin(phase * 2) * 0.035];
      default:
        return neutral(joint);
    }
  });
  // Lowest with the legs apart, highest as they pass.
  shift(walk, 30, (phase) => [0, (Math.cos(phase * 2) - 1) * 0.015, 0]);
  // Turn clips are additive: neutral at the first frame, full lean at the last.
  for (const [clipName, direction] of [
    ["turn-left", -1],
    ["turn-right", 1],
  ] as const) {
    clip(
      clipName,
      10,
      (joint, phase) => {
        const lean = phase / (Math.PI * 2);
        return joint === "spine"
          ? [0, direction * 0.14 * lean, 0]
          : [0, direction * 0.08 * lean, 0];
      },
      ["spine", "head"],
    );
  }
  // The attack clip is also additive: the shoulders kick back early, then
  // recover to neutral.
  clip(
    "fire",
    8,
    (joint, phase) => {
      const kick = Math.sin(Math.PI * Math.sqrt(phase / (Math.PI * 2)));
      return joint === "spine" ? [-0.12 * kick, 0, 0] : [0.06 * kick, 0, 0];
    },
    ["spine", "head"],
  );
  // Knees buckle, then the body falls back faster and faster and lies still.
  const fallen = (phase: number) => (phase / (Math.PI * 2)) ** 2;
  const death = clip("death", 24, (joint, phase) => {
    const fall = fallen(phase);
    const buckle = Math.sin(phase / 2);
    switch (joint) {
      case "pelvis":
        return [-1.45 * fall, 0, 0];
      case "left-leg":
      case "right-leg":
        return [0.15 * fall - 0.3 * buckle, 0, 0];
      case "left-shin":
      case "right-shin":
        return [0.6 * buckle, 0, 0];
      case "left-arm":
        return [0, 0, -0.08 - 0.5 * fall];
      case "right-arm":
        return [0, 0, 0.08 + 0.5 * fall];
      case "head":
        return [-0.2 * fall, 0, 0];
      default:
        return neutral(joint);
    }
  });
  shift(death, 24, (phase) => [0, -0.6 * fallen(phase), -0.25 * fallen(phase)]);
}

/** Keys `value` across one cycle, where phase runs from 0 to 2π. */
function keyed(
  name: string,
  property: "rotationQuaternion" | "position",
  endFrame: number,
  value: (phase: number) => Quaternion | Vector3,
): Animation {
  const animation = new Animation(
    name,
    property,
    FRAMES_PER_SECOND,
    property === "position"
      ? Animation.ANIMATIONTYPE_VECTOR3
      : Animation.ANIMATIONTYPE_QUATERNION,
    Animation.ANIMATIONLOOPMODE_CYCLE,
  );
  const keys = [];
  for (let frame = 0; frame <= endFrame; frame += KEY_STEP) {
    keys.push({ frame, value: value((frame / endFrame) * Math.PI * 2) });
  }
  animation.setKeys(keys);
  return animation;
}

/** One part's vertices in the rest pose, colored per vertex. */
function partVertices(
  scene: Scene,
  { name, shape, size, position, tiltX = 0 }: Part,
  color: Color3,
): VertexData {
  const mesh =
    shape === "sphere"
      ? MeshBuilder.CreateSphere(name, { diameter: 1, segments: 10 }, scene)
      : shape === "cylinder"
        ? MeshBuilder.CreateCylinder(
            name,
            { height: 1, diameter: 1, tessellation: 10 },
            scene,
          )
        : MeshBuilder.CreateBox(name, { size: 1 }, scene);
  mesh.scaling.set(...size);
  mesh.position.set(...position);
  mesh.rotation.x = tiltX;
  mesh.bakeCurrentTransformIntoVertices();
  const vertices = VertexData.ExtractFromMesh(mesh);
  mesh.dispose();
  const count = vertices.positions!.length / 3;
  vertices.colors = Array.from({ length: count }, () => [
    color.r,
    color.g,
    color.b,
    1,
  ]).flat();
  return vertices;
}
