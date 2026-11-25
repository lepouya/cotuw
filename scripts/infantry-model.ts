// Builds the infantry GLBs. The asset tests rebuild them to check
// the committed files are current.
import {
  Animation,
  AnimationGroup,
  Bone,
  Color3,
  Matrix,
  Mesh,
  MeshBuilder,
  PBRMaterial,
  Quaternion,
  Skeleton,
  TransformNode,
  Vector3,
  VertexData,
} from "@babylonjs/core";

import { exportGlb, FRAMES_PER_SECOND, rigidSkin } from "./glb-export.ts";

import type { Scene } from "@babylonjs/core";

type Vec3 = [number, number, number];
type Finish = "armor" | "cloth" | "owner" | "visor" | "dark" | "skin" | "metal";
type Joint = { name: string; parent?: string; offset: Vec3 };
type Part = {
  name: string;
  joint: string;
  shape:
    | "box"
    | "sphere"
    | "cylinder"
    | "torus"
    | "leaf"
    | "shell"
    | "leaf-plate"
    | "focus-bough";
  size: Vec3;
  position: Vec3;
  finish: Finish;
  tiltX?: number;
  tiltZ?: number;
};
type Pose = (joint: string, phase: number) => Vec3;

const KEY_STEP = 2;
const DARK: Vec3 = [0.09, 0.13, 0.15];
const METAL: Vec3 = [0.62, 0.68, 0.7];

/** Resting arms: shoulder pitch and outward spread, mirrored on the right. */
type Stance = {
  pitch: number;
  spread: number;
  forearm: number;
  swing: number;
  ready?: Readonly<Record<string, Vec3>>;
};
type JointPose = { joints: string[]; pose: Pose };
/** An additive layer that starts and ends at neutral for continuous blending. */
type Attack = JointPose & { clip: string; frames: number; aim?: JointPose };
type InfantryRecipe = {
  scale: number;
  palette: Record<Exclude<Finish, "dark" | "metal">, Vec3>;
  parts: readonly Part[];
  stride: number;
  stance: Stance;
  work?: keyof typeof WORK_POSES;
  /** Armed roles also get an aim layer. */
  attack?: Attack;
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

const ARC_BACKPACK: Part[] = [
  part(
    "backpack",
    "spine",
    "box",
    [0.42, 0.42, 0.18],
    [0, 1.31, -0.26],
    "armor",
  ),
];
const ARC_HEAD: Part[] = [
  part("helmet", "head", "sphere", [0.43, 0.35, 0.43], [0, 1.69, 0], "armor"),
  part("visor", "head", "box", [0.35, 0.13, 0.08], [0, 1.69, 0.2], "visor"),
  part(
    "helmet-ridge",
    "head",
    "box",
    [0.12, 0.06, 0.43],
    [0, 1.86, 0],
    "owner",
  ),
];
const ARC_RIFLE: Part[] = [
  part(
    "rifle-stock",
    "spine",
    "box",
    [0.13, 0.17, 0.3],
    [0.12, 1.15, 0.08],
    "dark",
  ),
  part(
    "rifle-receiver",
    "spine",
    "shell",
    [0.24, 0.46, 0.21],
    [0.12, 1.16, 0.39],
    "metal",
    Math.PI / 2,
  ),
  part(
    "rifle-shroud",
    "spine",
    "shell",
    [0.2, 0.35, 0.19],
    [0.12, 1.16, 0.72],
    "dark",
    Math.PI / 2,
  ),
  part(
    "rifle-barrel",
    "spine",
    "cylinder",
    [0.085, 0.3, 0.085],
    [0.12, 1.16, 0.98],
    "metal",
    Math.PI / 2,
  ),
  part(
    "rifle-tip",
    "spine",
    "cylinder",
    [0.115, 0.11, 0.115],
    [0.12, 1.16, 1.09],
    "dark",
    Math.PI / 2,
  ),
  part(
    "rifle-grip",
    "spine",
    "box",
    [0.1, 0.23, 0.1],
    [0.12, 1.04, 0.25],
    "dark",
    0.25,
  ),
  part(
    "rifle-rail",
    "spine",
    "box",
    [0.065, 0.045, 0.46],
    [0.12, 1.25, 0.44],
    "dark",
  ),
  part(
    "rifle-sight",
    "spine",
    "box",
    [0.075, 0.065, 0.13],
    [0.12, 1.28, 0.36],
    "visor",
  ),
];

const TROOPER_PACK: Part[] = [
  part("pack", "spine", "shell", [0.48, 0.41, 0.28], [0, 1.31, -0.25], "armor"),
  part(
    "pack-vent",
    "spine",
    "box",
    [0.26, 0.24, 0.05],
    [0, 1.31, -0.385],
    "dark",
  ),
  part(
    "pack-mark",
    "spine",
    "box",
    [0.24, 0.07, 0.04],
    [0, 1.49, -0.36],
    "owner",
  ),
];

const arcFieldArmor = (pack: readonly Part[]): Part[] => [
  part("waist", "pelvis", "shell", [0.5, 0.23, 0.33], [0, 0.91, 0], "dark"),
  part("suit", "spine", "shell", [0.67, 0.48, 0.44], [0, 1.29, 0], "cloth"),
  part(
    "chest-carapace",
    "spine",
    "shell",
    [0.61, 0.35, 0.43],
    [0, 1.35, 0.11],
    "armor",
    Math.PI,
  ),
  part(
    "chest-mark",
    "spine",
    "box",
    [0.14, 0.09, 0.03],
    [0, 1.42, 0.317],
    "owner",
  ),
  ...pack,
  part("collar", "spine", "cylinder", [0.34, 0.14, 0.34], [0, 1.54, 0], "dark"),
  part(
    "helmet-shell",
    "head",
    "shell",
    [0.48, 0.23, 0.5],
    [0, 1.78, -0.015],
    "armor",
  ),
  part(
    "helmet-jaw",
    "head",
    "shell",
    [0.45, 0.23, 0.47],
    [0, 1.63, 0.015],
    "dark",
    Math.PI,
  ),
  part(
    "visor-housing",
    "head",
    "shell",
    [0.42, 0.16, 0.095],
    [0, 1.719, 0.219],
    "dark",
    Math.PI / 2,
  ),
  part(
    "visor-band",
    "head",
    "box",
    [0.36, 0.078, 0.05],
    [0, 1.72, 0.257],
    "visor",
  ),
  part(
    "helmet-stripe",
    "head",
    "box",
    [0.13, 0.035, 0.28],
    [0, 1.893, -0.018],
    "owner",
  ),
  ...mirrored((side, sign) => [
    part(
      `${side}-ear-guard`,
      "head",
      "shell",
      [0.12, 0.16, 0.19],
      [sign * 0.199, 1.68, -0.04],
      "armor",
    ),
    part(
      `${side}-upper-arm`,
      `${side}-arm`,
      "shell",
      [0.18, 0.31, 0.19],
      [sign * 0.37, 1.21, 0.04],
      "cloth",
    ),
    part(
      `${side}-shoulder-cap`,
      `${side}-arm`,
      "shell",
      [0.31, 0.21, 0.36],
      [sign * 0.39, 1.365, 0],
      "armor",
    ),
    part(
      `${side}-shoulder-mark`,
      `${side}-arm`,
      "shell",
      [0.2, 0.065, 0.27],
      [sign * 0.4, 1.466, 0],
      "owner",
    ),
    part(
      `${side}-gauntlet`,
      `${side}-forearm`,
      "shell",
      [0.21, 0.26, 0.23],
      [sign * 0.39, 0.97, 0.12],
      "armor",
      Math.PI,
    ),
    part(
      `${side}-glove`,
      `${side}-forearm`,
      "shell",
      [0.16, 0.14, 0.17],
      [sign * 0.4, 0.81, 0.16],
      "dark",
    ),
    part(
      `${side}-thigh`,
      `${side}-leg`,
      "shell",
      [0.27, 0.42, 0.26],
      [sign * 0.17, 0.65, 0],
      "cloth",
    ),
    part(
      `${side}-knee-cap`,
      `${side}-shin`,
      "shell",
      [0.24, 0.22, 0.14],
      [sign * 0.17, 0.45, 0.12],
      "armor",
    ),
    part(
      `${side}-greave`,
      `${side}-shin`,
      "shell",
      [0.25, 0.34, 0.24],
      [sign * 0.17, 0.26, 0.01],
      "armor",
      Math.PI,
    ),
    part(
      `${side}-boot`,
      `${side}-shin`,
      "shell",
      [0.25, 0.18, 0.38],
      [sign * 0.17, 0.1, 0.07],
      "dark",
    ),
  ]),
];

const SCOUT_KIT: Part[] = [
  part("waist", "pelvis", "shell", [0.41, 0.2, 0.29], [0, 0.91, 0], "dark"),
  part("jacket", "spine", "shell", [0.56, 0.48, 0.35], [0, 1.29, 0], "cloth"),
  part("vest", "spine", "shell", [0.46, 0.27, 0.18], [0, 1.3, 0.15], "armor"),
  part(
    "radio-pack",
    "spine",
    "shell",
    [0.43, 0.46, 0.24],
    [0, 1.37, -0.25],
    "armor",
  ),
  part(
    "radio-panel",
    "spine",
    "shell",
    [0.33, 0.27, 0.075],
    [0, 1.34, -0.358],
    "dark",
  ),
  part(
    "radio-mark",
    "spine",
    "box",
    [0.27, 0.09, 0.14],
    [0, 1.574, -0.28],
    "owner",
  ),
  part(
    "radio-mount",
    "spine",
    "cylinder",
    [0.1, 0.12, 0.1],
    [0.16, 1.6, -0.225],
    "dark",
  ),
  part(
    "radio-aerial",
    "spine",
    "cylinder",
    [0.046, 0.36, 0.046],
    [0.21, 1.77, -0.285],
    "metal",
    -0.34,
    -0.27,
  ),
  part(
    "radio-tip",
    "spine",
    "cylinder",
    [0.06, 0.09, 0.06],
    [0.25, 1.91, -0.34],
    "armor",
    -0.34,
    -0.27,
  ),
  part(
    "neck-wrap",
    "spine",
    "cylinder",
    [0.32, 0.14, 0.31],
    [0, 1.53, 0],
    "dark",
  ),
  part(
    "helmet-shell",
    "head",
    "shell",
    [0.43, 0.19, 0.44],
    [0, 1.785, -0.015],
    "armor",
  ),
  part(
    "helmet-jaw",
    "head",
    "shell",
    [0.37, 0.21, 0.37],
    [0, 1.641, 0.025],
    "dark",
    Math.PI,
  ),
  part(
    "helmet-mark",
    "head",
    "box",
    [0.12, 0.032, 0.23],
    [0, 1.877, -0.023],
    "owner",
  ),
  part(
    "optics-frame",
    "head",
    "shell",
    [0.39, 0.15, 0.13],
    [0, 1.733, 0.208],
    "dark",
    Math.PI / 2,
  ),
  ...mirrored((side, sign) => [
    part(
      `${side}-lens-rim`,
      "head",
      "cylinder",
      [0.165, 0.085, 0.165],
      [sign * 0.098, 1.733, 0.27],
      "metal",
      Math.PI / 2,
    ),
    part(
      `${side}-lens`,
      "head",
      "cylinder",
      [0.115, 0.028, 0.115],
      [sign * 0.098, 1.733, 0.315],
      "visor",
      Math.PI / 2,
    ),
    part(
      `${side}-pack-strap`,
      "spine",
      "box",
      [0.085, 0.26, 0.04],
      [sign * 0.15, 1.411, 0.217],
      "dark",
      0.21,
      sign * 0.16,
    ),
    part(
      `${side}-sleeve`,
      `${side}-arm`,
      "shell",
      [0.18, 0.33, 0.18],
      [sign * 0.354, 1.233, 0.028],
      "cloth",
    ),
    part(
      `${side}-shoulder-tab`,
      `${side}-arm`,
      "shell",
      [0.125, 0.055, 0.16],
      [sign * 0.348, 1.393, 0],
      "owner",
    ),
    part(
      `${side}-bracer`,
      `${side}-forearm`,
      "shell",
      [0.15, 0.24, 0.16],
      [sign * 0.358, 0.972, 0.093],
      "cloth",
    ),
    part(
      `${side}-glove`,
      `${side}-forearm`,
      "shell",
      [0.145, 0.13, 0.15],
      [sign * 0.354, 0.804, 0.115],
      "dark",
    ),
    part(
      `${side}-thigh`,
      `${side}-leg`,
      "shell",
      [0.23, 0.43, 0.23],
      [sign * 0.17, 0.65, 0],
      "cloth",
    ),
    part(
      `${side}-shin`,
      `${side}-shin`,
      "shell",
      [0.18, 0.36, 0.19],
      [sign * 0.17, 0.285, 0.009],
      "cloth",
    ),
    part(
      `${side}-knee-pad`,
      `${side}-shin`,
      "shell",
      [0.17, 0.16, 0.12],
      [sign * 0.17, 0.442, 0.1],
      "armor",
    ),
    part(
      `${side}-boot`,
      `${side}-shin`,
      "shell",
      [0.2, 0.17, 0.33],
      [sign * 0.17, 0.095, 0.067],
      "dark",
    ),
  ]),
];

const DEMOLITION_GEAR: Part[] = [
  part(
    "launcher-tube",
    "spine",
    "cylinder",
    [0.32, 1.4, 0.32],
    [0.43, 1.46, 0.35],
    "armor",
    Math.PI / 2,
  ),
  part(
    "launcher-rear-collar",
    "spine",
    "cylinder",
    [0.39, 0.18, 0.39],
    [0.43, 1.46, -0.29],
    "metal",
    Math.PI / 2,
  ),
  part(
    "launcher-muzzle",
    "spine",
    "torus",
    [0.43, 0.55, 0.43],
    [0.43, 1.46, 1.07],
    "metal",
    Math.PI / 2,
  ),
  part(
    "launcher-bore",
    "spine",
    "cylinder",
    [0.29, 0.04, 0.29],
    [0.43, 1.46, 1.07],
    "dark",
    Math.PI / 2,
  ),
  part(
    "launcher-grip",
    "spine",
    "box",
    [0.12, 0.27, 0.12],
    [0.43, 1.23, 0.5],
    "dark",
  ),
  part(
    "launcher-sight",
    "spine",
    "box",
    [0.12, 0.1, 0.2],
    [0.43, 1.68, 0.7],
    "visor",
  ),
  part(
    "launcher-mark",
    "spine",
    "box",
    [0.025, 0.12, 0.2],
    [0.6, 1.46, 0.7],
    "owner",
  ),
  part(
    "rocket-rack",
    "spine",
    "box",
    [0.62, 0.5, 0.18],
    [0, 1.32, -0.3],
    "dark",
  ),
  ...mirrored((side, sign) => [
    part(
      `${side}-rocket-tube`,
      "spine",
      "cylinder",
      [0.22, 0.75, 0.22],
      [sign * 0.2, 1.42, -0.44],
      "metal",
    ),
    part(
      `${side}-rocket-cap`,
      "spine",
      "sphere",
      [0.22, 0.24, 0.22],
      [sign * 0.2, 1.82, -0.44],
      "armor",
    ),
    part(
      `${side}-rack-band`,
      "spine",
      "box",
      [0.23, 0.11, 0.23],
      [sign * 0.2, 1.34, -0.44],
      "owner",
    ),
  ]),
];

/** Ground-relative body parts with explicit head, pack, and role equipment. */
function arcParts({
  head = ARC_HEAD,
  backpack = ARC_BACKPACK,
  gear = [],
}: {
  head?: readonly Part[];
  backpack?: readonly Part[];
  gear?: readonly Part[];
} = {}): Part[] {
  return [
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
      "owner",
    ),
    ...backpack,
    part(
      "collar",
      "spine",
      "cylinder",
      [0.33, 0.13, 0.33],
      [0, 1.54, 0],
      "dark",
    ),
    ...head,
    ...mirrored((side, sign) => [
      part(
        `${side}-pauldron`,
        `${side}-arm`,
        "sphere",
        [0.3, 0.24, 0.34],
        [sign * 0.37, 1.37, 0],
        "owner",
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
    ...gear,
  ];
}

const MEDIC_PACK: Part[] = [
  part(
    "pack-frame",
    "spine",
    "shell",
    [0.59, 0.32, 0.58],
    [0, 1.34, -0.31],
    "dark",
    -Math.PI / 2,
  ),
  part(
    "pack-lid",
    "spine",
    "shell",
    [0.56, 0.16, 0.5],
    [0, 1.35, -0.474],
    "armor",
    -Math.PI / 2,
  ),
  part(
    "pack-medical-bar",
    "spine",
    "box",
    [0.1, 0.32, 0.022],
    [0, 1.36, -0.556],
    "cloth",
  ),
  part(
    "pack-medical-arms",
    "spine",
    "box",
    [0.32, 0.1, 0.022],
    [0, 1.36, -0.559],
    "cloth",
  ),
  part(
    "pack-handle",
    "spine",
    "box",
    [0.24, 0.07, 0.1],
    [0, 1.632, -0.375],
    "dark",
  ),
  part(
    "pack-owner-tab",
    "spine",
    "box",
    [0.3, 0.065, 0.05],
    [0, 1.567, -0.504],
    "owner",
    -0.28,
  ),
];

const MEDIC_GEAR: Part[] = [
  part(
    "medical-panel",
    "spine",
    "shell",
    [0.38, 0.065, 0.28],
    [0, 1.305, 0.337],
    "armor",
    Math.PI / 2,
  ),
  part(
    "bib-medical-bar",
    "spine",
    "box",
    [0.078, 0.22, 0.021],
    [0, 1.312, 0.372],
    "cloth",
  ),
  part(
    "bib-medical-arms",
    "spine",
    "box",
    [0.22, 0.078, 0.021],
    [0, 1.312, 0.375],
    "cloth",
  ),
  part(
    "medical-case",
    "left-forearm",
    "shell",
    [0.34, 0.25, 0.32],
    [-0.435, 0.635, 0.16],
    "armor",
    Math.PI / 2,
  ),
  part(
    "case-handle",
    "left-forearm",
    "box",
    [0.13, 0.08, 0.11],
    [-0.425, 0.79, 0.16],
    "dark",
  ),
  part(
    "case-medical-bar",
    "left-forearm",
    "box",
    [0.052, 0.155, 0.02],
    [-0.435, 0.635, 0.287],
    "cloth",
  ),
  part(
    "case-medical-arms",
    "left-forearm",
    "box",
    [0.154, 0.052, 0.02],
    [-0.435, 0.635, 0.29],
    "cloth",
  ),
  part(
    "scanner",
    "right-forearm",
    "shell",
    [0.2, 0.275, 0.1],
    [0.405, 0.987, 0.222],
    "dark",
    Math.PI / 2,
  ),
  part(
    "scanner-display",
    "right-forearm",
    "box",
    [0.124, 0.145, 0.024],
    [0.405, 0.998, 0.284],
    "visor",
  ),
];

const MECHANIC_GEAR: Part[] = [
  part("hard-hat", "head", "sphere", [0.5, 0.32, 0.46], [0, 1.72, 0], "armor"),
  part(
    "hat-brim",
    "head",
    "cylinder",
    [0.61, 0.065, 0.56],
    [0, 1.67, 0.02],
    "armor",
  ),
  part("hat-stripe", "head", "box", [0.12, 0.055, 0.47], [0, 1.89, 0], "owner"),
  part(
    "face-shield",
    "head",
    "box",
    [0.33, 0.13, 0.08],
    [0, 1.63, 0.21],
    "dark",
  ),
  part("headlamp", "head", "box", [0.16, 0.1, 0.07], [0, 1.74, 0.26], "visor"),
  part(
    "tool-pack",
    "spine",
    "box",
    [0.68, 0.45, 0.23],
    [0, 1.28, -0.29],
    "dark",
  ),
  ...mirrored((side, sign) => [
    part(
      `${side}-service-tank`,
      "spine",
      "cylinder",
      [0.23, 0.64, 0.23],
      [sign * 0.27, 1.4, -0.4],
      "metal",
    ),
    part(
      `${side}-tank-cap`,
      "spine",
      "cylinder",
      [0.25, 0.1, 0.25],
      [sign * 0.27, 1.75, -0.4],
      "armor",
    ),
    part(
      `${side}-tool-pouch`,
      "pelvis",
      "box",
      [0.25, 0.28, 0.28],
      [sign * 0.3, 0.87, 0.02],
      "armor",
    ),
    part(
      `${side}-vest-strap`,
      "spine",
      "box",
      [0.08, 0.37, 0.04],
      [sign * 0.2, 1.33, 0.3],
      "metal",
    ),
  ]),
  part(
    "wrench-shaft",
    "right-forearm",
    "box",
    [0.09, 0.62, 0.1],
    [0.47, 1.13, 0.23],
    "metal",
  ),
  part(
    "wrench-grip",
    "right-forearm",
    "box",
    [0.12, 0.24, 0.13],
    [0.47, 0.92, 0.23],
    "dark",
  ),
  part(
    "wrench-jaw-base",
    "right-forearm",
    "box",
    [0.31, 0.1, 0.13],
    [0.47, 1.47, 0.23],
    "metal",
  ),
  ...mirrored((side, sign) => [
    part(
      `wrench-${side}-jaw`,
      "right-forearm",
      "box",
      [0.09, 0.22, 0.13],
      [0.47 + sign * 0.11, 1.6, 0.23],
      "metal",
    ),
  ]),
];

/** The shared Circle body; `mantle` sizes each role's cloak. */
function elvenParts(mantle: Vec3): Part[] {
  return [
    part("tunic", "spine", "sphere", [0.43, 0.58, 0.28], [0, 1.25, 0], "cloth"),
    part("sash", "pelvis", "torus", [0.43, 0.12, 0.32], [0, 0.98, 0], "owner"),
    part("face", "head", "sphere", [0.26, 0.39, 0.28], [0, 1.73, 0.05], "skin"),
    part(
      "hair-crown",
      "head",
      "sphere",
      [0.3, 0.24, 0.3],
      [0, 1.89, -0.025],
      "dark",
    ),
    part(
      "long-hair",
      "head",
      "leaf",
      [0.28, 0.55, 0.3],
      [0, 1.61, -0.14],
      "dark",
    ),
    part("circlet", "head", "torus", [0.32, 0.07, 0.31], [0, 1.87, 0], "armor"),
    part(
      "brow-focus",
      "head",
      "leaf",
      [0.09, 0.16, 0.08],
      [0, 1.89, 0.16],
      "visor",
    ),
    part("mantle", "spine", "leaf", mantle, [0, 1.12, -0.25], "cloth"),
    ...mirrored((side, sign): Part[] => [
      {
        ...part(
          `${side}-ear`,
          "head",
          "leaf",
          [0.1, 0.46, 0.13],
          [sign * 0.23, 1.87, 0.015],
          "skin",
        ),
        tiltZ: -sign * 0.85,
      },
      part(
        `${side}-arm-cloth`,
        `${side}-arm`,
        "sphere",
        [0.14, 0.3, 0.16],
        [sign * 0.35, 1.18, 0.03],
        "cloth",
      ),
      part(
        `${side}-sleeve`,
        `${side}-forearm`,
        "leaf",
        [0.19, 0.36, 0.2],
        [sign * 0.37, 0.98, 0.1],
        "cloth",
      ),
      part(
        `${side}-hand`,
        `${side}-forearm`,
        "sphere",
        [0.12, 0.15, 0.13],
        [sign * 0.38, 0.81, 0.15],
        "skin",
      ),
      part(
        `${side}-leg-cloth`,
        `${side}-leg`,
        "cylinder",
        [0.15, 0.44, 0.15],
        [sign * 0.15, 0.65, 0],
        "cloth",
      ),
      part(
        `${side}-soft-boot`,
        `${side}-shin`,
        "sphere",
        [0.17, 0.46, 0.22],
        [sign * 0.15, 0.24, 0.04],
        "dark",
      ),
      part(
        `${side}-tabard`,
        `${side}-leg`,
        "leaf",
        [0.28, 0.76, 0.15],
        [sign * 0.14, 0.65, 0.16],
        "cloth",
      ),
      part(
        `${side}-tabard-trim`,
        `${side}-leg`,
        "leaf",
        [0.055, 0.59, 0.04],
        [sign * 0.14, 0.67, 0.23],
        "owner",
      ),
    ]),
  ];
}

const CULTIVATOR_GEAR: Part[] = [
  part(
    "seed-pod-shell",
    "spine",
    "sphere",
    [0.42, 0.58, 0.3],
    [0, 1.25, -0.32],
    "cloth",
  ),
  part(
    "seed-pod-window",
    "spine",
    "sphere",
    [0.16, 0.3, 0.18],
    [0, 1.29, -0.485],
    "visor",
  ),
  part(
    "seed-pod-cap",
    "spine",
    "sphere",
    [0.31, 0.13, 0.25],
    [0, 1.5, -0.31],
    "owner",
  ),
  ...mirrored((side, sign): Part[] => [
    {
      ...part(
        `${side}-pod-rib`,
        "spine",
        "leaf",
        [0.13, 0.53, 0.14],
        [sign * 0.13, 1.25, -0.47],
        "armor",
      ),
      tiltZ: -sign * 0.31,
    },
    {
      ...part(
        `${side}-harness-strap`,
        "spine",
        "box",
        [0.062, 0.43, 0.055],
        [sign * 0.106, 1.25, 0.125],
        "armor",
        -0.18,
      ),
      tiltZ: -sign * 0.35,
    },
  ]),
  part(
    "growth-tool-shaft",
    "right-forearm",
    "cylinder",
    [0.065, 0.54, 0.065],
    [0.38, 0.74, 0.15],
    "armor",
  ),
  part(
    "growth-tool-grip",
    "right-forearm",
    "cylinder",
    [0.09, 0.2, 0.09],
    [0.38, 0.8, 0.15],
    "dark",
  ),
  ...mirrored((side, sign): Part[] => [
    {
      ...part(
        `growth-tool-${side}-tine`,
        "right-forearm",
        "leaf",
        [0.08, 0.25, 0.08],
        [0.38 + sign * 0.078, 0.49, 0.15],
        "armor",
      ),
      tiltZ: sign * 0.58,
    },
  ]),
  part(
    "growth-tool-focus",
    "right-forearm",
    "leaf",
    [0.1, 0.16, 0.1],
    [0.38, 0.44, 0.15],
    "visor",
  ),
];

const SENTINEL_GEAR: Part[] = [
  ...mirrored((side, sign): Part[] => [
    part(
      `${side}-pauldron`,
      `${side}-arm`,
      "leaf-plate",
      [0.29, 0.45, 0.34],
      [sign * 0.38, 1.48, 0.02],
      "armor",
      -0.15,
      -sign * 0.99,
    ),
    part(
      `${side}-pauldron-overlap`,
      `${side}-arm`,
      "leaf-plate",
      [0.24, 0.32, 0.3],
      [sign * 0.405, 1.36, 0.05],
      "armor",
      -0.2,
      -sign * 1.26,
    ),
    part(
      `${side}-pauldron-mark`,
      `${side}-arm`,
      "leaf-plate",
      [0.15, 0.29, 0.085],
      [sign * 0.39, 1.48, 0.135],
      "owner",
      -0.36,
      -sign * 0.99,
    ),
    part(
      `${side}-cuirass`,
      "spine",
      "leaf-plate",
      [0.26, 0.49, 0.16],
      [sign * 0.121, 1.33, 0.155],
      "armor",
      -0.09,
      -sign * 0.34,
    ),
    part(
      `${side}-bracer`,
      `${side}-forearm`,
      "leaf-plate",
      [0.17, 0.29, 0.19],
      [sign * 0.38, 0.98, 0.15],
      "armor",
      -0.1,
    ),
    part(
      `${side}-hip-guard`,
      "pelvis",
      "leaf-plate",
      [0.18, 0.37, 0.195],
      [sign * 0.2, 0.91, 0.1],
      "armor",
      0.12,
      sign * 0.26,
    ),
    part(
      `${side}-mantle-tail`,
      "spine",
      "leaf-plate",
      [0.36, 0.83, 0.18],
      [sign * 0.165, 0.97, -0.29],
      "cloth",
      0.16,
      sign * 0.14,
    ),
    part(
      `${side}-mantle-fastener`,
      "spine",
      "leaf-plate",
      [0.16, 0.34, 0.14],
      [sign * 0.142, 1.39, -0.19],
      "owner",
      Math.PI,
      sign * 0.31,
    ),
    part(
      `${side}-focus-grip`,
      "spine",
      "sphere",
      [0.13, 0.13, 0.14],
      [sign * 0.235, 1.15, 0.51],
      "dark",
    ),
  ]),
  part(
    "focus-frame",
    "spine",
    "focus-bough",
    [1, 1, 1],
    [0, 1.19, 0.54],
    "armor",
  ),
  part(
    "focus-core",
    "spine",
    "leaf-plate",
    [0.21, 0.3, 0.18],
    [0, 1.22, 0.6],
    "visor",
  ),
];

const WAYFINDER_GEAR: Part[] = [
  part(
    "hood",
    "head",
    "sphere",
    [0.41, 0.39, 0.42],
    [0, 1.897, -0.097],
    "cloth",
  ),
  part(
    "hood-brow",
    "head",
    "leaf-plate",
    [0.37, 0.27, 0.18],
    [0, 1.984, 0.065],
    "cloth",
    0.86,
  ),
  ...mirrored((side, sign) => [
    part(
      `${side}-hood-fold`,
      "head",
      "leaf-plate",
      [0.16, 0.48, 0.22],
      [sign * 0.149, 1.812, -0.094],
      "cloth",
      -0.28,
      sign * 0.3,
    ),
    part(
      `${side}-mantle-fold`,
      "spine",
      "leaf-plate",
      [0.23, 0.51, 0.25],
      [sign * 0.184, 1.385, -0.084],
      "cloth",
      0.42,
      sign * 0.38,
    ),
    part(
      `${side}-mantle-clasp`,
      "spine",
      "leaf-plate",
      [0.13, 0.25, 0.09],
      [sign * 0.158, 1.405, 0.147],
      "armor",
      -0.14,
      sign * 0.34,
    ),
    part(
      `${side}-mantle-tail`,
      "spine",
      "leaf-plate",
      [0.26, 0.67, 0.14],
      [sign * 0.106, 1.005, -0.282],
      "cloth",
      0.23,
      sign * 0.13,
    ),
  ]),
  part(
    "mantle-mark",
    "spine",
    "leaf-plate",
    [0.22, 0.36, 0.12],
    [0, 1.331, -0.279],
    "owner",
    Math.PI + 0.32,
  ),
  part(
    "walking-stave",
    "right-forearm",
    "cylinder",
    [0.063, 1.62, 0.063],
    [0.392, 0.953, 0.178],
    "armor",
    0.045,
    -0.09,
  ),
  part(
    "stave-grip",
    "right-forearm",
    "cylinder",
    [0.081, 0.22, 0.081],
    [0.38, 0.814, 0.172],
    "dark",
    0.045,
    -0.09,
  ),
  part(
    "stave-collar",
    "right-forearm",
    "leaf-plate",
    [0.17, 0.41, 0.15],
    [0.452, 1.71, 0.195],
    "armor",
    -0.17,
    -0.23,
  ),
  part(
    "stave-seed",
    "right-forearm",
    "leaf-plate",
    [0.15, 0.24, 0.135],
    [0.463, 1.812, 0.243],
    "visor",
    0.045,
    -0.09,
  ),
];

const HEALER_GEAR: Part[] = [
  part("stole", "spine", "leaf", [0.36, 0.7, 0.1], [0, 1.2, 0.2], "owner"),
  part(
    "mantle-hem",
    "spine",
    "leaf",
    [0.95, 0.5, 0.36],
    [0, 0.72, -0.3],
    "cloth",
  ),
  part(
    "heart-seed",
    "spine",
    "leaf",
    [0.1, 0.16, 0.08],
    [0, 1.42, 0.24],
    "visor",
  ),
  ...mirrored((side, sign): Part[] => [
    {
      ...part(
        `${side}-shoulder-drape`,
        `${side}-arm`,
        "leaf",
        [0.3, 0.42, 0.26],
        [sign * 0.33, 1.38, 0],
        "cloth",
      ),
      tiltZ: -sign * 0.5,
    },
    part(
      `${side}-palm-glow`,
      `${side}-forearm`,
      "leaf",
      [0.1, 0.17, 0.08],
      [sign * 0.4, 0.76, 0.25],
      "visor",
    ),
  ]),
];

const ARTIFICER_GEAR: Part[] = [
  ...mirrored((side, sign): Part[] => [
    {
      ...part(
        `${side}-harness-strap`,
        "spine",
        "box",
        [0.07, 0.62, 0.05],
        [sign * 0.1, 1.3, 0.23],
        "armor",
      ),
      tiltZ: sign * 0.45,
    },
    part(
      `${side}-tool-pouch`,
      "pelvis",
      "box",
      [0.14, 0.18, 0.12],
      [sign * 0.27, 0.9, 0.12],
      "armor",
    ),
    part(
      `${side}-bracer`,
      `${side}-forearm`,
      "cylinder",
      [0.15, 0.2, 0.15],
      [sign * 0.37, 0.95, 0.11],
      "armor",
    ),
  ]),
  part(
    "harness-buckle",
    "spine",
    "sphere",
    [0.12, 0.12, 0.06],
    [0, 1.3, 0.27],
    "owner",
  ),
  part(
    "tool-belt",
    "pelvis",
    "torus",
    [0.47, 0.1, 0.36],
    [0, 0.93, 0],
    "armor",
  ),
  part(
    "tool-frame",
    "spine",
    "box",
    [0.42, 0.55, 0.14],
    [0, 1.3, -0.3],
    "armor",
  ),
  part(
    "frame-shaper",
    "spine",
    "cylinder",
    [0.04, 0.75, 0.04],
    [0.14, 1.45, -0.38],
    "dark",
  ),
  part(
    "frame-shaper-seed",
    "spine",
    "leaf",
    [0.08, 0.14, 0.08],
    [0.14, 1.86, -0.38],
    "visor",
  ),
  part(
    "shaping-awl",
    "right-forearm",
    "cylinder",
    [0.05, 0.4, 0.05],
    [0.38, 0.72, 0.24],
    "dark",
  ),
  part(
    "awl-tip",
    "right-forearm",
    "leaf",
    [0.07, 0.13, 0.07],
    [0.38, 0.5, 0.27],
    "visor",
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
  tiltZ?: number,
): Part {
  return { name, joint, shape, size, position, finish, tiltX, tiltZ };
}

const ARMS_AT_SIDES: Stance = {
  pitch: 0,
  spread: 0.08,
  forearm: 0,
  swing: 0.19,
};
const FOCUS_HELD: Stance = {
  ...ARMS_AT_SIDES,
  swing: 0,
  ready: {
    "left-arm": [-0.72, 0.23, 0.18],
    "right-arm": [-0.72, -0.23, -0.18],
    "left-forearm": [-0.72, 0, 0],
    "right-forearm": [-0.72, 0, 0],
  },
};
// ARC parts show no skin, but every palette defines each finish.
const ARC_SKIN: Vec3 = [0.83, 0.68, 0.53];
const CIRCLE_TRIM = {
  owner: [0.47, 0.68, 0.85],
  visor: [0.68, 0.35, 0.95],
  skin: [0.86, 0.73, 0.6],
} satisfies Record<string, Vec3>;

/** Shoulders kick back early, then recover; `roll` twists heavier weapons. */
const recoil = (
  clip: string,
  frames: number,
  pitch: number,
  roll = 0,
): Attack => ({
  clip,
  frames,
  joints: ["spine", "head"],
  pose: (joint, phase) => {
    const kick = Math.sin(Math.PI * Math.sqrt(phase / (Math.PI * 2)));
    return joint === "spine"
      ? [-pitch * kick, 0, roll * kick]
      : [(pitch / 2) * kick, 0, 0];
  },
});
const RIFLE_FIRE: Attack = {
  ...recoil("fire", 8, 0.12),
  aim: {
    joints: ["spine", "head"],
    pose: (joint, phase) => {
      const amount = phase / (Math.PI * 2);
      return [amount * (joint === "head" ? 0.14 : 0.035), 0, 0];
    },
  },
};
const LAUNCHER_FIRE = recoil("launch", 20, 0.2, 0.06);
// The hands and focus share the torso so they move together during release.
const FOCUS_CHANNEL: Attack = {
  clip: "channel",
  frames: 24,
  joints: ["spine", "head"],
  pose: (joint, phase) => {
    const release = Math.sin(Math.PI * Math.sqrt(phase / (2 * Math.PI)));
    return [release * (joint === "spine" ? 0.17 : -0.095), 0, 0];
  },
  aim: {
    joints: ["spine", "head"],
    pose: (joint, phase) => {
      const amount = phase / (2 * Math.PI);
      return [amount * (joint === "spine" ? 0.045 : 0.12), 0, 0];
    },
  },
};

/** Work clips override the joints involved in a gesture. */
type WorkPose = (joint: string, phase: number) => Vec3 | undefined;

function toolGesture(strokes: number, forearmTravel: number): WorkPose {
  return (joint, phase) => {
    const pulse = Math.sin(phase * strokes);
    if (joint === "spine") return [0.1 + pulse * 0.03, 0, 0];
    if (joint === "right-arm") return [-0.65 + pulse * 0.12, 0, 0.05];
    if (joint === "right-forearm") return [-0.5 + pulse * forearmTravel, 0, 0];
    if (joint === "left-arm") return [-0.2, 0, -0.1];
  };
}

const WORK_POSES = {
  treat: toolGesture(1, 0.12),
  repair: toolGesture(2, 0.3),
  cultivate: (joint, phase) => {
    const pulse = Math.sin(phase);
    if (joint === "spine") return [0.18 + pulse * 0.04, 0, 0];
    if (joint.endsWith("forearm")) return [-0.6 - pulse * 0.2, 0, 0];
    if (joint.endsWith("arm")) return [-0.4 + pulse * 0.12, 0, 0];
  },
  // Open palms raised toward the patient.
  cast: (joint, phase) => {
    const pulse = Math.sin(phase);
    if (joint === "spine") return [-0.04 + pulse * 0.02, 0, 0];
    if (joint === "left-arm") return [-0.95 + pulse * 0.08, 0, -0.28];
    if (joint === "right-arm") return [-0.95 + pulse * 0.08, 0, 0.28];
    if (joint.endsWith("forearm")) return [-0.3 - pulse * 0.06, 0, 0];
  },
  // A forward lean shaping the construct with the awl.
  mend: (joint, phase) => {
    const stroke = Math.sin(phase * 2);
    if (joint === "spine") return [0.24 + Math.sin(phase) * 0.03, 0, 0];
    if (joint === "right-arm") return [-0.85 + stroke * 0.15, 0, 0.08];
    if (joint === "right-forearm") return [-0.4 + stroke * 0.3, 0, 0];
    if (joint === "left-arm") return [-0.7, 0, -0.12];
    if (joint === "left-forearm") return [-0.45, 0, 0];
  },
} satisfies Record<string, WorkPose>;

const INFANTRY_RECIPES = {
  "circle-cultivator": {
    work: "cultivate",
    scale: 0.94,
    palette: {
      armor: [0.85, 0.73, 0.49],
      cloth: [0.43, 0.49, 0.26],
      ...CIRCLE_TRIM,
    },
    parts: [...elvenParts([0.48, 0.62, 0.21]), ...CULTIVATOR_GEAR],
    stride: 0.8,
    stance: ARMS_AT_SIDES,
  },
  "arc-trooper": {
    scale: 1,
    palette: {
      armor: [0.72, 0.43, 0.23],
      cloth: [0.24, 0.29, 0.32],
      owner: [0.97, 0.71, 0.26],
      visor: [0.19, 0.72, 0.79],
      skin: ARC_SKIN,
    },
    parts: [...arcFieldArmor(TROOPER_PACK), ...ARC_RIFLE],
    stride: 1,
    stance: {
      ...ARMS_AT_SIDES,
      swing: 0,
      ready: {
        "left-arm": [-0.78, 0.84, 0.04],
        "left-forearm": [-0.28, 0, 0],
        "right-arm": [0.24, -0.8, -0.19],
        "right-forearm": [-1.5, 0, 0],
      },
    },
    attack: RIFLE_FIRE,
  },
  "arc-demolition-trooper": {
    scale: 1,
    palette: {
      armor: [0.29, 0.34, 0.39],
      cloth: [0.1, 0.14, 0.17],
      owner: [0.97, 0.71, 0.26],
      visor: [1, 0.56, 0.19],
      skin: ARC_SKIN,
    },
    parts: arcParts({ backpack: [], gear: DEMOLITION_GEAR }),
    stride: 0.9,
    stance: { pitch: -0.65, spread: 0.1, forearm: -0.85, swing: 0.02 },
    attack: LAUNCHER_FIRE,
  },
  "arc-scout": {
    scale: 0.84,
    palette: {
      armor: [0.81, 0.63, 0.41],
      cloth: [0.32, 0.39, 0.4],
      owner: [0.97, 0.71, 0.26],
      visor: [0.32, 0.85, 0.78],
      skin: ARC_SKIN,
    },
    parts: SCOUT_KIT,
    stride: 1,
    stance: { pitch: 0, spread: 0.02, forearm: -0.08, swing: 0.53 },
  },
  "arc-medic": {
    work: "treat",
    scale: 0.97,
    palette: {
      armor: [0.89, 0.93, 0.86],
      cloth: [0.11, 0.35, 0.3],
      owner: [0.64, 0.9, 0.82],
      visor: [0.32, 0.95, 0.73],
      skin: ARC_SKIN,
    },
    parts: [...arcFieldArmor(MEDIC_PACK), ...MEDIC_GEAR],
    stride: 0.9,
    stance: ARMS_AT_SIDES,
  },
  "arc-mechanic": {
    work: "repair",
    scale: 1,
    palette: {
      armor: [0.87, 0.52, 0.16],
      cloth: [0.22, 0.25, 0.26],
      owner: [0.97, 0.71, 0.26],
      visor: [1, 0.9, 0.55],
      skin: ARC_SKIN,
    },
    parts: arcParts({ head: [], backpack: [], gear: MECHANIC_GEAR }),
    stride: 0.85,
    stance: { ...ARMS_AT_SIDES, swing: 0.08 },
  },
  "circle-sentinel": {
    scale: 1.04,
    palette: {
      armor: [0.91, 0.83, 0.63],
      cloth: [0.16, 0.37, 0.31],
      ...CIRCLE_TRIM,
    },
    parts: [...elvenParts([0.66, 0.93, 0.22]), ...SENTINEL_GEAR],
    stride: 0.8,
    stance: FOCUS_HELD,
    attack: FOCUS_CHANNEL,
  },
  "circle-healer": {
    work: "cast",
    scale: 0.96,
    palette: {
      armor: [0.8, 0.77, 0.6],
      cloth: [0.62, 0.78, 0.7],
      ...CIRCLE_TRIM,
    },
    parts: [...elvenParts([0.9, 1.3, 0.34]), ...HEALER_GEAR],
    stride: 0.75,
    stance: ARMS_AT_SIDES,
  },
  "circle-artificer": {
    work: "mend",
    scale: 1,
    palette: {
      armor: [0.45, 0.33, 0.2],
      cloth: [0.36, 0.3, 0.22],
      ...CIRCLE_TRIM,
    },
    parts: [...elvenParts([0.45, 0.6, 0.22]), ...ARTIFICER_GEAR],
    stride: 0.85,
    stance: { ...ARMS_AT_SIDES, swing: 0.12 },
  },
  "circle-wayfinder": {
    scale: 0.88,
    palette: {
      armor: [0.85, 0.77, 0.55],
      cloth: [0.28, 0.56, 0.46],
      ...CIRCLE_TRIM,
    },
    parts: [...elvenParts([0.48, 0.69, 0.23]), ...WAYFINDER_GEAR],
    stride: 0.98,
    stance: {
      ...ARMS_AT_SIDES,
      spread: 0.04,
      swing: 0.31,
      ready: { "right-forearm": [-0.06, 0, 0] },
    },
  },
} satisfies Record<string, InfantryRecipe>;

type InfantryId = keyof typeof INFANTRY_RECIPES;
export const INFANTRY_IDS: readonly InfantryId[] = Object.keys(
  INFANTRY_RECIPES,
) as InfantryId[];

/** Exports one recipe's model, skin, and clips as GLB bytes. */
export function exportInfantry(id: InfantryId): Promise<Uint8Array> {
  return exportGlb(id, (scene) =>
    buildInfantry(scene, id, INFANTRY_RECIPES[id]),
  );
}

function buildInfantry(
  scene: Scene,
  name: string,
  recipe: InfantryRecipe,
): void {
  const { parts, stance, attack } = recipe;
  const root = new TransformNode(name, scene);
  root.scaling.setAll(recipe.scale);
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

  // glTF colors are linear. A vertex-colored body, the glowing visor, and
  // owner markings that sessions recolor keep each soldier to three draws.
  const palette = { ...recipe.palette, dark: DARK, metal: METAL };
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
  const owner = new PBRMaterial(`${name}-owner`, scene);
  owner.albedoColor = linear(palette.owner);
  owner.metallic = 0;
  owner.roughness = 0.6;

  // Owner parts take their color from the material, which sessions replace.
  const colorOf = ({ finish }: Part) =>
    finish === "owner" ? Color3.White() : linear(palette[finish]);
  const skinned = (label: string, pieces: Part[], material: PBRMaterial) =>
    rigidSkin(
      `${name}-${label}`,
      pieces.map((each) => ({
        vertices: partVertices(scene, each, colorOf(each)),
        bone: skeleton.bones.indexOf(bones.get(each.joint)!),
      })),
      skeleton,
      material,
      root,
    );
  skinned(
    "body",
    parts.filter(({ finish }) => finish !== "visor" && finish !== "owner"),
    body,
  );
  skinned(
    "visor",
    parts.filter(({ finish }) => finish === "visor"),
    visor,
  );
  skinned(
    "owner",
    parts.filter(({ finish }) => finish === "owner"),
    owner,
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
    const ready = stance.ready?.[joint];
    if (ready) return ready;
    if (joint.endsWith("forearm")) return [stance.forearm, 0, 0];
    if (joint === "left-arm") return [stance.pitch, 0, -stance.spread];
    if (joint === "right-arm") return [stance.pitch, 0, stance.spread];
    return [0, 0, 0];
  };

  const idle = clip("idle", 60, (joint, phase) =>
    joint === "head" ? [Math.sin(phase) * 0.025, 0, 0] : neutral(joint),
  );
  shift(idle, 60, (phase) => [0, (Math.cos(phase) - 1) * 0.004, 0]);
  if (recipe.work) {
    const pose = WORK_POSES[recipe.work];
    const work = clip(
      recipe.work,
      60,
      (joint, phase) => pose(joint, phase) ?? neutral(joint),
    );
    // Keys the pelvis at rest because blending needs idle's channels.
    shift(work, 60, () => [0, 0, 0]);
  }
  const walk = clip("walk", 30, (joint, phase) => {
    const stride = Math.sin(phase) * recipe.stride;
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
      case "right-arm": {
        const [pitch, yaw, roll] = neutral(joint);
        const direction = joint === "left-arm" ? -1 : 1;
        return [pitch + direction * stride * stance.swing, yaw, roll];
      }
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
  if (attack) clip(attack.clip, attack.frames, attack.pose, attack.joints);
  clip(
    "hit",
    10,
    (joint, phase) => {
      const flinch = Math.sin(phase / 2);
      return joint === "spine"
        ? [0.22 * flinch, 0, -0.12 * flinch]
        : [-0.15 * flinch, 0, 0];
    },
    ["spine", "head"],
  );
  if (attack)
    clip(
      "aim",
      10,
      attack.aim?.pose ??
        ((joint, phase) => {
          const amount = phase / (Math.PI * 2);
          if (joint.endsWith("forearm")) return [-0.65 * amount, 0, 0];
          if (joint.endsWith("arm")) return [-0.25 * amount, 0, 0];
          return [-0.08 * amount, 0, 0];
        }),
      attack.aim?.joints ?? [
        "spine",
        "left-arm",
        "right-arm",
        "left-forearm",
        "right-forearm",
      ],
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
      // Held arms relax as the body falls.
      case "left-arm":
      case "right-arm": {
        const [pitch, yaw, roll] = neutral(joint);
        const direction = joint === "left-arm" ? -1 : 1;
        const spread = direction * (stance.spread + 0.5);
        return [
          pitch * (1 - fall),
          yaw * (1 - fall),
          roll + (spread - roll) * fall,
        ];
      }
      case "left-forearm":
      case "right-forearm": {
        const ready = stance.ready?.[joint];
        return ready ? [ready[0] * (1 - fall), 0, 0] : neutral(joint);
      }
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

const SHAPES: Record<Part["shape"], (scene: Scene, name: string) => Mesh> = {
  box: (scene, name) => MeshBuilder.CreateBox(name, { size: 1 }, scene),
  sphere: (scene, name) =>
    MeshBuilder.CreateSphere(name, { diameter: 1, segments: 10 }, scene),
  cylinder: (scene, name) =>
    MeshBuilder.CreateCylinder(
      name,
      { height: 1, diameter: 1, tessellation: 10 },
      scene,
    ),
  torus: (scene, name) =>
    MeshBuilder.CreateTorus(
      name,
      { diameter: 1, thickness: 0.16, tessellation: 16 },
      scene,
    ),
  leaf: leafMesh,
  "leaf-plate": (scene, name) =>
    MeshBuilder.CreatePolyhedron(name, { custom: LEAF_PLATE }, scene),
  "focus-bough": focusBough,
  shell: (scene, name) =>
    MeshBuilder.CreateCylinder(
      name,
      { height: 1, diameterTop: 0.75, diameterBottom: 1, tessellation: 8 },
      scene,
    ).convertToFlatShadedMesh(),
};

// The outline narrows toward its tips, with a raised rib on the front.
const LEAF_PLATE = {
  vertex: [
    [0, 0.5, -0.13],
    [-0.39, 0.24, 0.07],
    [-0.5, -0.05, 0.05],
    [-0.21, -0.31, -0.04],
    [0, -0.5, -0.13],
    [0.21, -0.31, -0.04],
    [0.5, -0.05, 0.05],
    [0.39, 0.24, 0.07],
    [0, 0.1, 0.5],
    [0, -0.02, -0.5],
  ],
  face: Array.from({ length: 8 }, (_, edge) => {
    const next = (edge + 1) % 8;
    return [
      [edge, next, 8],
      [next, edge, 9],
    ];
  }).flat(),
};

function focusBough(scene: Scene, name: string): Mesh {
  const halves = [-1, 1].map((side) =>
    MeshBuilder.CreateTube(
      name,
      {
        path: [
          new Vector3(0, -0.15, 0),
          new Vector3(side * 0.17, -0.13, 0),
          new Vector3(side * 0.233, -0.035, -0.015),
          new Vector3(side * 0.219, 0.092, -0.008),
          new Vector3(side * 0.14, 0.184, 0.034),
          new Vector3(side * 0.058, 0.21, 0.07),
        ],
        radiusFunction: (index) =>
          [0.062, 0.064, 0.062, 0.053, 0.033, 0.008][index]!,
        tessellation: 7,
        cap: Mesh.CAP_ALL,
      },
      scene,
    ),
  );
  return Mesh.MergeMeshes(halves, true)!;
}

/** One part's vertices in the rest pose, colored per vertex. */
function partVertices(
  scene: Scene,
  { name, shape, size, position, tiltX = 0, tiltZ = 0 }: Part,
  color: Color3,
): VertexData {
  const mesh = SHAPES[shape](scene, name);
  mesh.scaling.set(...size);
  mesh.position.set(...position);
  mesh.rotation.x = tiltX;
  mesh.rotation.z = tiltZ;
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

function leafMesh(scene: Scene, name: string): Mesh {
  const data = new VertexData();
  data.positions = [
    0, 0.5, 0, 0.5, 0, 0, 0, -0.5, 0, -0.5, 0, 0, 0, 0, 0.5, 0, 0, -0.5,
  ];
  data.indices = [
    0, 4, 1, 1, 4, 2, 2, 4, 3, 3, 4, 0, 0, 1, 5, 1, 2, 5, 2, 3, 5, 3, 0, 5,
  ];
  data.normals = [];
  data.uvs = [0.5, 1, 1, 0.5, 0.5, 0, 0, 0.5, 0.5, 0.5, 0.5, 0.5];
  VertexData.ComputeNormals(data.positions, data.indices, data.normals);
  const mesh = new Mesh(name, scene);
  data.applyToMesh(mesh);
  return mesh;
}
