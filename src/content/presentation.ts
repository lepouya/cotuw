// Serializable presentation contracts that content validates without loading
// graphics. Renderers implement them and check the loaded assets.
import {
  hasOwn,
  isId,
  isOneOf,
  isPositive,
  isRecord,
} from "../simulation/validation";
import { BUILDING_ACTIVITY_KINDS } from "../simulation/production";

import type { BuildingActivityKind } from "../simulation/production";

/** Built-in presentation names accepted by authored content. */
export const BUILTIN_ACTOR_MODEL_IDS = ["harvester", "wolf"] as const;
export type BuiltinActorModelId = (typeof BUILTIN_ACTOR_MODEL_IDS)[number];
export const BUILTIN_BUILDING_DETAIL_IDS = [
  "barracks",
  "command-center",
  "refinery",
] as const;
export type BuiltinBuildingDetailId =
  (typeof BUILTIN_BUILDING_DETAIL_IDS)[number];

export const PORTRAIT_IDS = [
  "refinery",
  "headquarters",
  "building",
  "harvester",
  "armed",
  "unarmed",
  "circle-cultivator",
  "circle-sentinel",
  "circle-wayfinder",
  "circle-heartgrove",
  "circle-conservatory",
  "circle-musterhall",
] as const;
export type PortraitId = (typeof PORTRAIT_IDS)[number];

export type Rgb = [number, number, number];

export function isRgb(value: unknown): value is Rgb {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every(
      (channel) => Number.isFinite(channel) && channel >= 0 && channel <= 1,
    )
  );
}

/**
 * Committed simulation events an actor's appearance can respond to, such as
 * with a clip or a frame effect. `attack` is each hit the actor deals, `hit`
 * each hit it survives, and `unload` each cargo delivery.
 */
export const ACTOR_TRIGGERS = ["attack", "hit", "unload"] as const;
export type ActorTrigger = (typeof ACTOR_TRIGGERS)[number];

/** Optional clips that replace idle and key exactly its pose channels. */
export const POSE_ROLES = ["run", "work", "deploy", "stow"] as const;
/**
 * Optional clips layered over the others as their difference from their
 * first frame. A trigger's clip plays once each time the trigger fires.
 */
export const LAYERED_ROLES = ["aim", ...ACTOR_TRIGGERS] as const;
/**
 * Every role that names one optional clip. Death plays once on the actor's
 * remains and holds its last frame.
 */
const OPTIONAL_ROLES = [...POSE_ROLES, ...LAYERED_ROLES, "death"] as const;
type OptionalRole = (typeof OPTIONAL_ROLES)[number];
const CLIP_ROLES = ["idle", "locomotion", "turn", ...OPTIONAL_ROLES] as const;
type ClipRole = (typeof CLIP_ROLES)[number];
const RIGS = ["skeletal", "rigid"] as const;

/** Clips by animation role. */
export type ClipRoles<T> = {
  idle: T;
  locomotion: T;
  turn?: { left: T; right: T };
} & Partial<Record<OptionalRole, T>>;

/** Authored GLB and animation configuration for one actor definition. */
export type ActorGraphics = {
  url: string;
  minimapColor?: Rgb;
  bounds: { radius: number; height: number };
  /** Clip names in the GLB. */
  clips: ClipRoles<string>;
  /** Ground units traveled during one locomotion clip cycle. */
  cycleDistance: number;
  rig?: (typeof RIGS)[number];
  scale?: number;
};

/** Maps every clip a model names, keeping its role. */
export function mapClips<T, U>(
  clips: ClipRoles<T>,
  map: (clip: T, role: ClipRole) => U,
): ClipRoles<U> {
  const mapped: ClipRoles<U> = {
    idle: map(clips.idle, "idle"),
    locomotion: map(clips.locomotion, "locomotion"),
  };
  if (clips.turn)
    mapped.turn = {
      left: map(clips.turn.left, "turn"),
      right: map(clips.turn.right, "turn"),
    };
  for (const role of OPTIONAL_ROLES) {
    const clip = clips[role];
    if (clip !== undefined) mapped[role] = map(clip, role);
  }
  return mapped;
}

/** Every clip a model uses, in role order. */
export function clipList<T>(clips: ClipRoles<T>): T[] {
  const list: T[] = [];
  mapClips(clips, (clip) => list.push(clip));
  return list;
}

export function validateActorGraphics(
  value: unknown,
): asserts value is ActorGraphics {
  const graphics: Partial<ActorGraphics> = isRecord(value) ? value : {};
  const { url, bounds, cycleDistance, minimapColor, clips } = graphics;
  if (
    !isId(url) ||
    !isRecord(clips) ||
    !isId(clips.idle) ||
    !isId(clips.locomotion) ||
    Object.keys(clips).some((role) => !isOneOf(CLIP_ROLES, role)) ||
    (clips.turn !== undefined &&
      !(isId(clips.turn?.left) && isId(clips.turn?.right))) ||
    OPTIONAL_ROLES.some(
      (role) => clips[role] !== undefined && !isId(clips[role]),
    )
  )
    throw new RangeError(`Actor model ${url} needs a URL and named clips`);
  if (!!clips.deploy !== !!clips.stow || (clips.deploy && !clips.work))
    throw new RangeError(
      `Actor model ${url} needs work, deploy, and stow together`,
    );
  const names = clipList(clips);
  if (new Set(names).size !== names.length)
    throw new RangeError(
      `Actor model ${url} uses one clip for multiple animation roles`,
    );
  if (graphics.rig !== undefined && !isOneOf(RIGS, graphics.rig))
    throw new RangeError(`Actor model ${url} needs a valid rig type`);
  if (graphics.scale !== undefined && !isPositive(graphics.scale))
    throw new RangeError(`Actor model ${url} needs a positive model scale`);
  if (!isPositive(cycleDistance))
    throw new RangeError(`Actor model ${url} needs a positive cycle distance`);
  if (!bounds || !isPositive(bounds.radius) || !isPositive(bounds.height))
    throw new RangeError(`Actor model ${url} needs positive finite bounds`);
  if (minimapColor !== undefined && !isRgb(minimapColor))
    throw new RangeError(`Actor model ${url} needs a valid minimap color`);
}

export type ModelGraphics = {
  url: string;
  idle?: string;
  /**
   * Clips that play once per building activity. Each starts and ends at rest
   * and keys no channel that idle keys.
   */
  activities?: Partial<Record<BuildingActivityKind, string>>;
};

export function validateModelGraphics(
  graphics: unknown,
): asserts graphics is ModelGraphics {
  if (
    !isRecord(graphics) ||
    !isId(graphics.url) ||
    (graphics.idle !== undefined && !isId(graphics.idle))
  )
    throw new RangeError("A model needs a URL and a valid idle clip name");
  const activities = graphics.activities;
  if (
    activities !== undefined &&
    (!isRecord(activities) ||
      Object.entries(activities).some(
        ([kind, clip]) =>
          !isOneOf(BUILDING_ACTIVITY_KINDS, kind) || !isId(clip),
      ))
  )
    throw new RangeError(
      `Model ${graphics.url} needs activity clips named by activity kind`,
    );
}

/** A content pack clip shown once on a camera-facing square. */
export type FrameEffect = {
  clip: string;
  /** The clip's sprite sheet. */
  url: string;
  /** Edge length in world units. */
  size: number;
  /** In the actor's model space: from its ground point, facing +Z. */
  anchor: [number, number, number];
};

export type FrameEffects = Partial<Record<ActorTrigger, FrameEffect>>;

/** Throws unless each effect names a trigger, a known clip, and a placement. */
export function validateFrameEffects(
  actorId: string,
  effects: unknown,
  clips: Readonly<Record<string, unknown>>,
): asserts effects is FrameEffects {
  if (!isRecord(effects))
    throw new RangeError(`Frame effects for ${actorId} are invalid.`);
  for (const [trigger, effect] of Object.entries(effects))
    if (
      !isOneOf(ACTOR_TRIGGERS, trigger) ||
      !isRecord(effect) ||
      !isId(effect.clip) ||
      !hasOwn(clips, effect.clip) ||
      !isId(effect.url) ||
      !isPositive(effect.size) ||
      !Array.isArray(effect.anchor) ||
      effect.anchor.length !== 3 ||
      !effect.anchor.every(Number.isFinite)
    )
      throw new RangeError(
        `The ${trigger} frame effect for ${actorId} is invalid.`,
      );
}

/** How an attacker's hits are drawn. */
export const ATTACK_EFFECT_STYLES = ["tracer", "bite", "bolt"] as const;
export type AttackEffectStyle = (typeof ATTACK_EFFECT_STYLES)[number];

/** How damage on an actor is drawn. */
export const DAMAGE_EFFECT_STYLES = [
  "mechanical",
  "biological",
  "living",
] as const;
export type DamageEffectStyle = (typeof DAMAGE_EFFECT_STYLES)[number];

/** A marker scale for remaining fractions strictly greater than `above`. */
export type MaterialsStage = { readonly above: number; readonly scale: number };

export const DEFAULT_MATERIALS_STAGES: readonly MaterialsStage[] =
  Object.freeze([
    Object.freeze({ above: 0.75, scale: 1 }),
    Object.freeze({ above: 0.5, scale: 0.8375 }),
    Object.freeze({ above: 0.25, scale: 0.675 }),
    Object.freeze({ above: 0, scale: 0.5125 }),
  ]);

/** Cutoffs in [0, 1) descend to zero while scales shrink. */
export function validateMaterialsStages(
  stages: unknown,
): asserts stages is MaterialsStage[] {
  if (
    !Array.isArray(stages) ||
    stages[stages.length - 1]?.above !== 0 ||
    stages.some(
      (stage, index) =>
        !isRecord(stage) ||
        !isFraction(stage.above) ||
        !isPositive(stage.scale) ||
        (index > 0 &&
          (stage.above >= stages[index - 1].above ||
            stage.scale >= stages[index - 1].scale)),
    )
  )
    throw new RangeError(
      "Materials stages need descending thresholds ending at zero and positive descending scales.",
    );
}

const isFraction = (value: unknown): value is number =>
  typeof value === "number" && value >= 0 && value < 1;
