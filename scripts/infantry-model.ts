// Builds the infantry GLBs. The asset tests rebuild them to check
// the committed files are current.
import {
  Color3,
  Mesh,
  MeshBuilder,
  PBRMaterial,
  TransformNode,
  VertexData,
} from "@babylonjs/core";

import { exportGlb, FRAMES_PER_SECOND } from "./glb-export.ts";
import {
  clip,
  foldedBlade,
  paint,
  place,
  skin,
  tube,
} from "./model-toolkit.ts";
import { mix } from "./sprite-sheet.ts";

import type { Scene } from "@babylonjs/core";
import type { Vec3 } from "./model-toolkit.ts";

type Finish = "armor" | "cloth" | "owner" | "visor" | "dark" | "skin" | "metal";
type Joint = { name: string; parent?: string; offset: Vec3 };
type Part = {
  name: string;
  joint: string;
  shape:
    | "box"
    | "sphere"
    | "hand"
    | "cylinder"
    | "torus"
    | "leaf"
    | "shell"
    | "leaf-plate"
    | "mantle-fold"
    | "focus-bough";
  size: Vec3;
  position: Vec3;
  finish: Finish;
  tiltX?: number;
  tiltZ?: number;
};
type Pose = (joint: string, phase: number) => Vec3;

/** Frames between animation keys; poses change slowly enough to halve them. */
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
  joints?: readonly Joint[];
  walkPose?: WorkPose;
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

const ARC_FIELD_HELMET: Part[] = [
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
];

const arcFieldArmor = (
  pack: readonly Part[],
  helmet: readonly Part[] = ARC_FIELD_HELMET,
): Part[] => [
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
  ...helmet,
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

const DEMOLITION_PACK: Part[] = [
  part(
    "rack-frame",
    "spine",
    "shell",
    [0.64, 0.52, 0.24],
    [0, 1.32, -0.28],
    "armor",
  ),
  part(
    "rack-back",
    "spine",
    "shell",
    [0.52, 0.42, 0.1],
    [0, 1.31, -0.42],
    "dark",
  ),
  ...mirrored((side, sign) => [
    part(
      `${side}-rocket-tube`,
      "spine",
      "cylinder",
      [0.22, 0.57, 0.22],
      [sign * 0.185, 1.42, -0.46],
      "metal",
    ),
    part(
      `${side}-rocket-cap`,
      "spine",
      "shell",
      [0.24, 0.18, 0.24],
      [sign * 0.185, 1.785, -0.46],
      "armor",
    ),
  ]),
  part(
    "rack-band",
    "spine",
    "shell",
    [0.63, 0.13, 0.14],
    [0, 1.39, -0.53],
    "dark",
  ),
  part(
    "rack-mark",
    "spine",
    "box",
    [0.46, 0.073, 0.032],
    [0, 1.4, -0.6],
    "owner",
  ),
];

const DEMOLITION_GEAR: Part[] = [
  part(
    "launcher-tube",
    "spine",
    "cylinder",
    [0.32, 1.4, 0.32],
    [0.43, 1.46, 0.35],
    "dark",
    Math.PI / 2,
  ),
  part(
    "launcher-shroud",
    "spine",
    "shell",
    [0.41, 0.81, 0.41],
    [0.43, 1.46, 0.48],
    "armor",
    Math.PI / 2,
  ),
  part(
    "launcher-rear-collar",
    "spine",
    "cylinder",
    [0.37, 0.15, 0.37],
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
    "launcher-rail",
    "spine",
    "box",
    [0.14, 0.075, 0.56],
    [0.43, 1.662, 0.49],
    "metal",
  ),
  part(
    "launcher-sight",
    "spine",
    "shell",
    [0.13, 0.12, 0.18],
    [0.43, 1.738, 0.68],
    "dark",
  ),
  part(
    "sight-window",
    "spine",
    "box",
    [0.08, 0.055, 0.04],
    [0.43, 1.75, 0.6],
    "visor",
  ),
  part(
    "launcher-mark",
    "spine",
    "shell",
    [0.055, 0.15, 0.26],
    [0.635, 1.51, 0.67],
    "owner",
    Math.PI / 2,
  ),
];

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

const MECHANIC_HELMET: Part[] = [
  part(
    "hard-hat",
    "head",
    "shell",
    [0.51, 0.22, 0.46],
    [0, 1.78, -0.016],
    "armor",
  ),
  part(
    "hat-brim",
    "head",
    "cylinder",
    [0.61, 0.05, 0.55],
    [0, 1.67, 0.061],
    "armor",
  ),
  part(
    "hat-stripe",
    "head",
    "box",
    [0.12, 0.035, 0.29],
    [0, 1.891, -0.025],
    "owner",
  ),
  part(
    "face-shield",
    "head",
    "shell",
    [0.43, 0.2, 0.43],
    [0, 1.596, 0.024],
    "dark",
    Math.PI,
  ),
  part(
    "headlamp-housing",
    "head",
    "shell",
    [0.23, 0.1, 0.135],
    [0, 1.736, 0.237],
    "dark",
    Math.PI / 2,
  ),
  part(
    "headlamp",
    "head",
    "box",
    [0.145, 0.07, 0.026],
    [0, 1.736, 0.293],
    "visor",
  ),
];

const MECHANIC_PACK: Part[] = [
  part(
    "tool-pack",
    "spine",
    "shell",
    [0.59, 0.5, 0.26],
    [0, 1.3, -0.3],
    "dark",
  ),
  part(
    "pack-owner-tab",
    "spine",
    "box",
    [0.245, 0.087, 0.055],
    [0, 1.498, -0.456],
    "owner",
  ),
  ...mirrored((side, sign) => [
    part(
      `${side}-service-tank`,
      "spine",
      "cylinder",
      [0.205, 0.57, 0.205],
      [sign * 0.234, 1.391, -0.414],
      "metal",
    ),
    part(
      `${side}-tank-cap`,
      "spine",
      "cylinder",
      [0.224, 0.102, 0.224],
      [sign * 0.234, 1.714, -0.414],
      "armor",
    ),
    part(
      `${side}-tank-band`,
      "spine",
      "cylinder",
      [0.22, 0.095, 0.22],
      [sign * 0.234, 1.19, -0.414],
      "dark",
    ),
  ]),
];

const MECHANIC_GEAR: Part[] = [
  ...mirrored((side, sign) => [
    part(
      `${side}-vest-strap`,
      "spine",
      "box",
      [0.073, 0.392, 0.042],
      [sign * 0.153, 1.337, 0.305],
      "dark",
      0.15,
      sign * -0.12,
    ),
    part(
      `${side}-strap-buckle`,
      "spine",
      "box",
      [0.093, 0.067, 0.036],
      [sign * 0.146, 1.278, 0.335],
      "metal",
    ),
    part(
      `${side}-tool-pouch`,
      "pelvis",
      "shell",
      [0.235, 0.24, 0.205],
      [sign * 0.265, 0.889, 0.042],
      "dark",
    ),
    part(
      `${side}-pouch-flap`,
      "pelvis",
      "box",
      [0.158, 0.08, 0.08],
      [sign * 0.278, 0.95, 0.127],
      "armor",
    ),
  ]),
  part(
    "wrench-shaft",
    "right-forearm",
    "box",
    [0.088, 0.49, 0.09],
    [0.445, 1.062, 0.22],
    "metal",
    0,
    -0.15,
  ),
  part(
    "wrench-grip",
    "right-forearm",
    "box",
    [0.123, 0.188, 0.122],
    [0.417, 0.872, 0.22],
    "dark",
    0,
    -0.15,
  ),
  part(
    "wrench-jaw-base",
    "right-forearm",
    "shell",
    [0.284, 0.14, 0.105],
    [0.481, 1.306, 0.22],
    "metal",
    Math.PI,
  ),
  ...mirrored((side, sign) => [
    part(
      `wrench-${side}-jaw`,
      "right-forearm",
      "shell",
      [0.088, 0.192, 0.111],
      [0.481 + sign * 0.092, 1.41, 0.22],
      "metal",
      0,
      0.09 - sign * 0.21,
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
  part(
    "heart-seed",
    "spine",
    "leaf-plate",
    [0.105, 0.15, 0.08],
    [0, 1.37, 0.219],
    "visor",
  ),
  ...mirrored((side, sign): Part[] => [
    part(
      `${side}-mantle-collar`,
      "spine",
      "mantle-fold",
      [0.31, 0.48, 0.21],
      [sign * 0.19, 1.38, -0.012],
      "armor",
      -0.46,
      sign * 0.47,
    ),
    part(
      `${side}-stole`,
      "spine",
      "mantle-fold",
      [0.13, 0.53, 0.12],
      [sign * 0.145, 1.22, 0.18],
      "owner",
      -0.085,
      -sign * 0.22,
    ),
    part(
      `${side}-mantle-lining`,
      `${side}-mantle`,
      "mantle-fold",
      [0.39, 1.13, 0.2],
      [sign * 0.272, 0.902, -0.255],
      "cloth",
      0.22,
      sign * 0.24,
    ),
    part(
      `${side}-mantle-fold`,
      `${side}-mantle`,
      "mantle-fold",
      [0.34, 1.09, 0.19],
      [sign * 0.235, 0.953, -0.304],
      "armor",
      0.23,
      sign * 0.22,
    ),
    part(
      `${side}-mantle-mark`,
      `${side}-mantle`,
      "mantle-fold",
      [0.123, 0.77, 0.085],
      [sign * 0.255, 0.998, -0.386],
      "owner",
      0.23,
      sign * 0.22,
    ),
    part(
      `${side}-split-skirt`,
      `${side}-leg`,
      "mantle-fold",
      [0.3, 0.8, 0.15],
      [sign * 0.156, 0.646, 0.145],
      "armor",
      -0.1,
      sign * 0.11,
    ),
    part(
      `${side}-sleeve-flare`,
      `${side}-forearm`,
      "mantle-fold",
      [0.225, 0.32, 0.21],
      [sign * 0.377, 0.994, 0.1],
      "cloth",
      0.1,
      sign * 0.14,
    ),
    part(
      `${side}-cuff`,
      `${side}-forearm`,
      "shell",
      [0.157, 0.098, 0.157],
      [sign * 0.386, 0.9, 0.145],
      "armor",
      -0.13,
    ),
    part(
      `${side}-palm`,
      `${side}-forearm`,
      "hand",
      [0.113, 0.147, 0.068],
      [sign * 0.395, 0.813, 0.157],
      "skin",
    ),
    ...[-1, 0, 1].map((finger) =>
      part(
        `${side}-fingers-${finger}`,
        `${side}-forearm`,
        "hand",
        [0.032, 0.104 - 0.012 * Math.abs(finger), 0.037],
        [sign * (0.395 + finger * 0.039), 0.727, 0.167],
        "skin",
        -0.12,
        sign * finger * 0.16,
      ),
    ),
    part(
      `${side}-thumb`,
      `${side}-forearm`,
      "hand",
      [0.043, 0.091, 0.041],
      [sign * 0.333, 0.794, 0.166],
      "skin",
      -0.07,
      -sign * 0.6,
    ),
    part(
      `${side}-palm-glow`,
      `${side}-forearm`,
      "leaf-plate",
      [0.054, 0.083, 0.027],
      [sign * 0.393, 0.81, 0.194],
      "visor",
    ),
  ]),
];

const ARTIFICER_GEAR: Part[] = [
  ...mirrored((side, sign): Part[] => [
    part(
      `${side}-harness-strap`,
      "spine",
      "leaf-plate",
      [0.122, 0.53, 0.09],
      [sign * 0.119, 1.27, 0.197],
      "armor",
      -0.12,
      -sign * 0.46,
    ),
    part(
      `${side}-harness-fastener`,
      "spine",
      "leaf-plate",
      [0.13, 0.21, 0.12],
      [sign * 0.197, 1.466, 0.137],
      "owner",
      -0.58,
      -sign * 0.43,
    ),
    part(
      `${side}-work-tab`,
      `${side}-leg`,
      "mantle-fold",
      [0.28, 0.53, 0.13],
      [sign * 0.14, 0.74, 0.14],
      "cloth",
      -0.08,
      sign * 0.09,
    ),
    part(
      `${side}-tool-pouch`,
      "pelvis",
      "shell",
      [0.165, 0.21, 0.155],
      [sign * 0.194, 0.92, 0.19],
      "armor",
      -0.08,
      -sign * 0.17,
    ),
    part(
      `${side}-bracer`,
      `${side}-forearm`,
      "leaf-plate",
      [0.185, 0.25, 0.19],
      [sign * 0.37, 0.95, 0.11],
      "armor",
      -0.16,
    ),
    part(
      `${side}-frame-rib`,
      "spine",
      "leaf-plate",
      [0.155, 0.59, 0.17],
      [sign * 0.194, 1.246, -0.308],
      "armor",
      Math.PI + 0.14,
      -sign * 0.23,
    ),
    part(
      `${side}-frame-branch`,
      "spine",
      "leaf-plate",
      [0.135, 0.34, 0.15],
      [sign * 0.193, 1.469, -0.267],
      "armor",
      Math.PI - 0.23,
      sign * 0.49,
    ),
    part(
      `${side}-frame-band`,
      "spine",
      "leaf-plate",
      [0.148, 0.24, 0.115],
      [sign * 0.209, 1.435, -0.351],
      "owner",
      Math.PI + 0.12,
      -sign * 0.18,
    ),
  ]),
  part(
    "harness-buckle",
    "spine",
    "leaf-plate",
    [0.145, 0.18, 0.1],
    [0, 1.049, 0.199],
    "owner",
  ),
  part(
    "grafting-pod",
    "spine",
    "leaf-plate",
    [0.3, 0.56, 0.23],
    [0, 1.22, -0.306],
    "dark",
    Math.PI - 0.14,
  ),
  part(
    "pod-window",
    "spine",
    "leaf-plate",
    [0.13, 0.29, 0.065],
    [0, 1.258, -0.426],
    "visor",
    Math.PI - 0.14,
  ),
  part(
    "frame-crosspiece",
    "spine",
    "leaf-plate",
    [0.14, 0.48, 0.16],
    [0, 1.082, -0.366],
    "armor",
    Math.PI,
    Math.PI / 2,
  ),
  part(
    "awl-grip",
    "right-forearm",
    "shell",
    [0.069, 0.18, 0.075],
    [0.376, 0.793, 0.176],
    "dark",
    -0.21,
    -0.12,
  ),
  part(
    "awl-shaft",
    "right-forearm",
    "leaf-plate",
    [0.092, 0.29, 0.075],
    [0.354, 0.643, 0.211],
    "armor",
    -0.24,
    -0.11,
  ),
  part(
    "awl-inlay",
    "right-forearm",
    "leaf-plate",
    [0.062, 0.103, 0.043],
    [0.34, 0.558, 0.245],
    "visor",
    -0.24,
    -0.11,
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
  cast: (joint, phase) => {
    const lift = (1 - Math.cos(phase)) / 2;
    if (joint === "spine") return [0.045 - lift * 0.075, 0, 0];
    if (joint === "head") return [0.075 - lift * 0.14, 0, 0];
    const side = joint.startsWith("left-") ? -1 : 1;
    // Raise the palms together and open the elbows at the top of the reach.
    if (joint.endsWith("-arm"))
      return [-0.73 - lift * 0.56, 0, side * (0.54 + lift * 0.14)];
    if (joint.endsWith("-forearm"))
      return [-0.62 - lift * 0.1, side * 0.12, -side * 0.14];
    if (joint.endsWith("-mantle"))
      return [0.045 + lift * 0.12, 0, side * lift * 0.045];
  },
  mend: (joint, phase) => {
    // Brace with the left hand and make two measured passes with the awl.
    const press = (1 - Math.cos(phase * 2)) / 2;
    if (joint === "spine") return [0.19 + press * 0.08, -0.07, 0];
    if (joint === "head") return [0.13 - press * 0.07, 0.08, 0];
    if (joint === "right-arm") return [-1.24 - press * 0.14, -0.08, 0.12];
    if (joint === "right-forearm") return [-0.44 + press * 0.35, -0.08, 0.08];
    if (joint === "left-arm") return [-0.97, 0.06, -0.2];
    if (joint === "left-forearm") return [-0.67, 0.12, 0.06];
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
      armor: [0.37, 0.42, 0.46],
      cloth: [0.21, 0.24, 0.27],
      owner: [0.97, 0.71, 0.26],
      visor: [1, 0.56, 0.19],
      skin: ARC_SKIN,
    },
    parts: [...arcFieldArmor(DEMOLITION_PACK), ...DEMOLITION_GEAR],
    stride: 0.9,
    stance: {
      pitch: -0.65,
      spread: 0.1,
      forearm: -0.85,
      swing: 0.02,
      ready: {
        "left-arm": [-0.76, 1.14, 0.04],
        "left-forearm": [-0.75, 0, 0],
        "right-arm": [-0.65, 0, 0.05],
        "right-forearm": [-0.85, 0, 0],
      },
    },
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
      armor: [0.91, 0.61, 0.19],
      cloth: [0.24, 0.28, 0.28],
      owner: [0.97, 0.71, 0.26],
      visor: [1, 0.9, 0.55],
      skin: ARC_SKIN,
    },
    parts: [...arcFieldArmor(MECHANIC_PACK, MECHANIC_HELMET), ...MECHANIC_GEAR],
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
      armor: [0.83, 0.9, 0.75],
      cloth: [0.25, 0.48, 0.43],
      ...CIRCLE_TRIM,
    },
    parts: [
      ...elvenParts([0.7, 0.9, 0.2]).filter(
        ({ name }) =>
          name !== "mantle" && !/-(hand|sleeve|tabard|tabard-trim)$/.test(name),
      ),
      ...HEALER_GEAR,
    ],
    joints: mirrored((side, sign): Joint[] => [
      {
        name: `${side}-mantle`,
        parent: "spine",
        offset: [sign * 0.156, 0.36, -0.18],
      },
    ]),
    walkPose: (joint, phase) => {
      if (joint.endsWith("-mantle")) {
        const side = joint.startsWith("left-") ? -1 : 1;
        return [0.11 + side * Math.sin(phase - 0.6) * 0.09, 0, side * 0.06];
      }
    },
    stride: 0.75,
    stance: { pitch: -0.07, spread: 0.145, forearm: -0.16, swing: 0.23 },
  },
  "circle-artificer": {
    work: "mend",
    scale: 0.96,
    palette: {
      armor: [0.82, 0.67, 0.44],
      cloth: [0.51, 0.32, 0.2],
      ...CIRCLE_TRIM,
    },
    parts: [
      ...elvenParts([0.39, 0.42, 0.16]).filter(
        ({ name }) => !/-tabard(-trim)?$/.test(name),
      ),
      ...ARTIFICER_GEAR,
    ],
    stride: 0.85,
    stance: {
      ...ARMS_AT_SIDES,
      spread: 0.04,
      swing: 0.18,
      ready: { "right-forearm": [-0.045, 0, 0] },
    },
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
  const joints = new Map<string, TransformNode>();
  for (const { name: label, parent, offset } of [
    ...JOINTS,
    ...(recipe.joints ?? []),
  ]) {
    const joint = new TransformNode(label, scene);
    joint.parent = parent ? joints.get(parent)! : root;
    joint.position.set(...offset);
    joints.set(label, joint);
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

  // Parts are authored in model space, then ride their joint.
  for (const {
    name: label,
    joint,
    shape,
    size,
    position,
    finish,
    tiltX = 0,
    tiltZ = 0,
  } of parts) {
    const mesh = place(SHAPES[shape](scene, label), {
      parent: root,
      material: finish === "visor" ? visor : finish === "owner" ? owner : body,
      position,
      rotation: [tiltX, 0, tiltZ],
      scaling: size,
    });
    // Owner parts take their color from the material, which sessions replace.
    const color = finish === "owner" ? Color3.White() : linear(palette[finish]);
    paint(mesh, () => color);
    mesh.setParent(joints.get(joint)!);
  }
  skin(root);

  /** Keys each joint's pose over one cycle, where phase runs from 0 to 2π. */
  const cycle = (
    clipName: string,
    frames: number,
    pose: Pose,
    {
      joints: posed = [...joints.keys()],
      shift,
      layered = false,
    }: {
      joints?: readonly string[];
      /** Moves the pelvis from its rest position. */
      shift?: (phase: number) => Vec3;
      /** Keys only the joints that move, for additive layers. */
      layered?: boolean;
    } = {},
  ) =>
    clip(
      root,
      clipName,
      frames / FRAMES_PER_SECOND,
      (seconds) => {
        const phase = ((seconds * FRAMES_PER_SECOND) / frames) * Math.PI * 2;
        for (const joint of posed)
          joints.get(joint)!.rotation.set(...pose(joint, phase));
        if (shift)
          joints.get("pelvis")!.position.addInPlaceFromFloats(...shift(phase));
      },
      // Complete poses key every joint's rotation and the pelvis position.
      !layered &&
        ((node, property) =>
          joints.get(node.name) === node &&
          (property === "rotationQuaternion" ||
            (property === "position" && node.name === "pelvis"))),
      KEY_STEP,
    );
  const neutral = (joint: string): Vec3 => {
    const ready = stance.ready?.[joint];
    if (ready) return ready;
    if (joint.endsWith("forearm")) return [stance.forearm, 0, 0];
    if (joint === "left-arm") return [stance.pitch, 0, -stance.spread];
    if (joint === "right-arm") return [stance.pitch, 0, stance.spread];
    return [0, 0, 0];
  };

  cycle(
    "idle",
    60,
    (joint, phase) =>
      joint === "head" ? [Math.sin(phase) * 0.025, 0, 0] : neutral(joint),
    { shift: (phase) => [0, (Math.cos(phase) - 1) * 0.004, 0] },
  );
  if (recipe.work) {
    const pose = WORK_POSES[recipe.work];
    cycle(
      recipe.work,
      60,
      (joint, phase) => pose(joint, phase) ?? neutral(joint),
    );
  }
  cycle(
    "walk",
    30,
    (joint, phase) => {
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
          return recipe.walkPose?.(joint, phase) ?? neutral(joint);
      }
    },
    // Lowest with the legs apart, highest as they pass.
    { shift: (phase) => [0, (Math.cos(phase * 2) - 1) * 0.015, 0] },
  );
  // Turn clips are additive: neutral at the first frame, full lean at the last.
  for (const [clipName, direction] of [
    ["turn-left", -1],
    ["turn-right", 1],
  ] as const) {
    cycle(
      clipName,
      10,
      (joint, phase) => {
        const lean = phase / (Math.PI * 2);
        return joint === "spine"
          ? [0, direction * 0.14 * lean, 0]
          : [0, direction * 0.08 * lean, 0];
      },
      { joints: ["spine", "head"], layered: true },
    );
  }
  if (attack)
    cycle(attack.clip, attack.frames, attack.pose, {
      joints: attack.joints,
      layered: true,
    });
  cycle(
    "hit",
    10,
    (joint, phase) => {
      const flinch = Math.sin(phase / 2);
      return joint === "spine"
        ? [0.22 * flinch, 0, -0.12 * flinch]
        : [-0.15 * flinch, 0, 0];
    },
    { joints: ["spine", "head"], layered: true },
  );
  if (attack)
    cycle(
      "aim",
      10,
      attack.aim?.pose ??
        ((joint, phase) => {
          const amount = phase / (Math.PI * 2);
          if (joint.endsWith("forearm")) return [-0.65 * amount, 0, 0];
          if (joint.endsWith("arm")) return [-0.25 * amount, 0, 0];
          return [-0.08 * amount, 0, 0];
        }),
      {
        joints: attack.aim?.joints ?? [
          "spine",
          "left-arm",
          "right-arm",
          "left-forearm",
          "right-forearm",
        ],
        layered: true,
      },
    );
  // Knees buckle, then the body collapses into a grounded asymmetric slump.
  const fallen = (phase: number) => (phase / (Math.PI * 2)) ** 2;
  cycle(
    "death",
    24,
    (joint, phase) => {
      const fall = fallen(phase);
      const buckle = Math.sin(phase / 2);
      switch (joint) {
        case "pelvis":
          return [-1.48 * fall, 0.14 * fall, 0.22 * fall];
        case "left-leg":
          return [0.36 * fall - 0.3 * buckle, 0.12 * fall, -0.18 * fall];
        case "right-leg":
          return [0.08 * fall - 0.24 * buckle, -0.08 * fall, 0.14 * fall];
        case "left-shin":
          return [0.58 * fall + 0.45 * buckle, 0, 0];
        case "right-shin":
          return [0.18 * fall + 0.45 * buckle, 0, 0];
        // Arms drape asymmetrically so held gear settles low instead of upright.
        case "left-arm":
          return settle(
            neutral(joint),
            [0.28, -0.25, -(stance.spread + 0.65)],
            fall,
          );
        case "right-arm":
          return settle(
            neutral(joint),
            [0.72, 0.38, stance.spread + 0.32],
            fall,
          );
        case "left-forearm":
        case "right-forearm":
          return settle(
            neutral(joint),
            [joint === "left-forearm" ? -0.35 : -0.65, 0, 0],
            fall,
          );
        case "head":
          return [-0.18 * fall, 0.32 * fall, 0.26 * fall];
        default:
          return neutral(joint);
      }
    },
    { shift: (phase) => [0, -0.66 * fallen(phase), -0.25 * fallen(phase)] },
  );
}

/** Moves each angle of `from` toward `to` by `amount`. */
function settle(from: Vec3, to: Vec3, amount: number): Vec3 {
  return [
    mix(from[0], to[0], amount),
    mix(from[1], to[1], amount),
    mix(from[2], to[2], amount),
  ];
}

const SHAPES: Record<Part["shape"], (scene: Scene, name: string) => Mesh> = {
  box: (scene, name) => MeshBuilder.CreateBox(name, { size: 1 }, scene),
  sphere: (scene, name) =>
    MeshBuilder.CreateSphere(name, { diameter: 1, segments: 10 }, scene),
  hand: (scene, name) =>
    MeshBuilder.CreateSphere(name, { diameter: 1, segments: 4 }, scene),
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
  "mantle-fold": (scene, name) =>
    MeshBuilder.CreatePolyhedron(name, { custom: MANTLE_FOLD }, scene),
  "focus-bough": focusBough,
  shell: (scene, name) =>
    MeshBuilder.CreateCylinder(
      name,
      { height: 1, diameterTop: 0.75, diameterBottom: 1, tessellation: 8 },
      scene,
    ).convertToFlatShadedMesh(),
};

// The outline narrows toward its tips, with a raised rib on the front.
const LEAF_PLATE = foldedBlade([
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
]);

// A broad shoulder seam and a tapered hem share the raised fold.
const MANTLE_FOLD = foldedBlade([
  [0, 0.5, -0.06],
  [-0.37, 0.45, 0],
  [-0.5, 0.04, 0.17],
  [-0.39, -0.31, 0.03],
  [0, -0.5, -0.18],
  [0.39, -0.31, 0.03],
  [0.5, 0.04, 0.17],
  [0.37, 0.45, 0],
  [0, 0.06, 0.46],
  [0, -0.02, -0.37],
]);

function focusBough(scene: Scene, name: string): Mesh {
  const halves = [-1, 1].map((side) =>
    tube(
      scene,
      name,
      [
        [0, -0.15, 0],
        [side * 0.17, -0.13, 0],
        [side * 0.233, -0.035, -0.015],
        [side * 0.219, 0.092, -0.008],
        [side * 0.14, 0.184, 0.034],
        [side * 0.058, 0.21, 0.07],
      ],
      [0.062, 0.064, 0.062, 0.053, 0.033, 0.008],
      7,
    ),
  );
  return Mesh.MergeMeshes(halves, true)!;
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
