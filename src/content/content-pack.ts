import { deepFreeze } from "../simulation/actor";
import {
  isCount,
  isId,
  isIdList,
  isOneOf,
  isPositive,
  isRecord,
} from "../simulation/validation";
import { validateMovementProfile } from "../simulation/navigation";
import { isRgb } from "../render/color";
import {
  BUILTIN_ACTOR_MODELS,
  BUILTIN_BUILDING_DETAILS,
} from "../render/builtin-models";
import { validateActorGraphics } from "../render/skinned-actor-appearance";
import { validateModelGraphics } from "../render/glb-model";
import type { ModelGraphics } from "../render/glb-model";
import { validateFrameEffects } from "../render/frame-effects";
import { DAMAGE_EFFECT_STYLES } from "../render/damage-effects";
import { ATTACK_EFFECT_STYLES } from "../render/combat-effects";
import { validateTextureClip } from "./texture-clip";

import type { ActorDefinition } from "../simulation/actor";
import type { MovementProfile } from "../simulation/navigation";
import type { AttackEffectStyle } from "../render/combat-effects";
import type { DamageEffectStyle } from "../render/damage-effects";
import type { FrameEffects } from "../render/frame-effects";
import type { Rgb } from "../render/color";
import type { TerrainStyle } from "../render/terrain-style";
import type { ActorGraphics } from "../render/skinned-actor-appearance";
import type { TextureClip } from "./texture-clip";

const FORMAT = "cotuw-content";
export const CONTENT_FORMAT_VERSION = 1;

/** Names a content pack and the version whose rules a mission uses. */
export type ContentReference = { id: string; version: number };

/** A GLB asset, or a built-in procedural model at an optional scale. */
export type ActorModel =
  { glb: ActorGraphics } | { builtin: string; scale?: number };

/** How the player sees and commands one actor definition. */
export type ActorPresentation = {
  name: string;
  description: string;
  build?: { id: string; label: string };
  train?: { id: string; label: string };
  attackEffect?: AttackEffectStyle;
  /** How damage shows once health drops; absent shows none. */
  damageEffect?: DamageEffectStyle;
  model?: ActorModel;
  frameEffects?: FrameEffects;
  building?: {
    height: number;
    color: Rgb;
    minimapColor?: Rgb;
    /** A built-in set of articulated parts. */
    details?: string;
    glb?: ModelGraphics;
  };
};

export type ViewStyle = {
  clearColor: Rgb;
  lighting: {
    skyColor: Rgb;
    groundColor: Rgb;
    sunColor: Rgb;
    sunDirection: [number, number, number];
    skyIntensity: number;
    sunIntensity: number;
  };
};

export const PROP_IDS = [
  "foundation",
  "scaffold",
  "rubble",
  "materials-mound",
  "salvage",
  "tracer",
  "bite",
  "smoke",
  "fire",
  "wound",
  "bird",
] as const;

export type PropId = (typeof PROP_IDS)[number];

/** Shared rules and presentation that mission files name by ID and version. */
export type ContentPack = ContentReference & {
  name: string;
  actors: readonly ActorDefinition[];
  movementProfiles: readonly MovementProfile[];
  presentation: Readonly<Record<string, ActorPresentation>>;
  /** Sprite-sheet frame sequences that textures name by ID. */
  clips?: Readonly<Record<string, TextureClip>>;
  /**
   * Shared meshes for foundations, scaffolds, resources, salvage, debris,
   * weapon and damage effects, and ambient birds.
   */
  props?: Partial<Record<PropId, ModelGraphics>>;
  terrain: TerrainStyle;
  view: ViewStyle;
};

/** Checks presentation eagerly; missions validate the actor rules they use. */
export function parseContentPack(source: string): ContentPack {
  let pack;
  try {
    pack = JSON.parse(source);
  } catch {
    throw new RangeError("This content pack is not valid JSON.");
  }
  if (pack?.format !== FORMAT || pack.formatVersion !== CONTENT_FORMAT_VERSION)
    throw new RangeError(
      `Content packs use format "${FORMAT}" version ${CONTENT_FORMAT_VERSION}.`,
    );
  const invalid = (problem: string) =>
    new RangeError(`Content pack ${pack.id} ${problem}.`);
  if (
    !isId(pack.id) ||
    !isCount(pack.version) ||
    !isId(pack.name) ||
    !Array.isArray(pack.actors) ||
    pack.actors.some(
      (actor: ActorDefinition) => !actor || !isId(actor.behaviorId),
    ) ||
    !isIdList(pack.actors.map((actor: ActorDefinition) => actor.id)) ||
    !Array.isArray(pack.movementProfiles) ||
    pack.movementProfiles.some((profile: MovementProfile) => !profile) ||
    !isIdList(
      pack.movementProfiles.map((profile: MovementProfile) => profile.id),
    ) ||
    !isRecord(pack.presentation) ||
    !isRecord(pack.terrain?.tileTypes) ||
    !isRecord(pack.terrain?.layers) ||
    !isRgb(pack.view?.clearColor)
  )
    throw invalid(
      "needs an id, version, actors, movementProfiles, presentation, terrain, and view",
    );
  for (const profile of pack.movementProfiles) validateMovementProfile(profile);
  const lighting = pack.view.lighting;
  if (
    !lighting ||
    ![lighting.skyColor, lighting.groundColor, lighting.sunColor].every(
      isRgb,
    ) ||
    !Array.isArray(lighting.sunDirection) ||
    lighting.sunDirection.length !== 3 ||
    !lighting.sunDirection.every(Number.isFinite) ||
    lighting.sunDirection.every((value: number) => value === 0) ||
    !isNonnegative(lighting.skyIntensity) ||
    !isNonnegative(lighting.sunIntensity)
  )
    throw invalid(
      "needs valid lighting colors, intensities, and sun direction",
    );

  const buttonIds = new Set<string>();
  for (const actor of pack.actors) {
    const presentation = pack.presentation[actor.id] as ActorPresentation;
    if (
      !presentation ||
      !isId(presentation.name) ||
      typeof presentation.description !== "string"
    )
      throw invalid(`needs a name and description for ${actor.id}`);
    for (const action of [presentation.build, presentation.train]) {
      if (
        action !== undefined &&
        (!action ||
          !isId(action.id) ||
          !isId(action.label) ||
          buttonIds.has(action.id))
      )
        throw invalid(`gives ${actor.id} an invalid or duplicate button ID`);
      if (action) buttonIds.add(action.id);
    }
    if (
      presentation.attackEffect !== undefined &&
      !isOneOf(ATTACK_EFFECT_STYLES, presentation.attackEffect)
    )
      throw invalid(`gives ${actor.id} an unknown attack effect`);
    if (
      presentation.damageEffect !== undefined &&
      !isOneOf(DAMAGE_EFFECT_STYLES, presentation.damageEffect)
    )
      throw invalid(`gives ${actor.id} an unknown damage effect`);
    const model = presentation.model;
    if (model !== undefined) {
      if (!isRecord(model)) throw invalid(`gives ${actor.id} an invalid model`);
      const isGlb = "glb" in model;
      const isBuiltin = "builtin" in model;
      if (isGlb === isBuiltin)
        throw invalid(`gives ${actor.id} an invalid model`);
      if ("glb" in model) validateActorGraphics(model.glb as ActorGraphics);
      else {
        if (
          !Object.prototype.hasOwnProperty.call(
            BUILTIN_ACTOR_MODELS,
            model.builtin as string,
          )
        )
          throw invalid(
            `gives ${actor.id} an unknown built-in model "${model.builtin}"`,
          );
        if (model.scale !== undefined && !isPositive(model.scale))
          throw invalid(`gives ${actor.id} an invalid model scale`);
      }
    }
    if (presentation.frameEffects !== undefined) {
      if (!model || actor.footprint)
        throw invalid(`needs a mobile model for ${actor.id}'s frame effects`);
      validateFrameEffects(
        actor.id,
        presentation.frameEffects,
        pack.clips ?? {},
      );
    }
    const building = presentation.building;
    if (building !== undefined) {
      if (
        !building ||
        !isPositive(building.height) ||
        !isRgb(building.color) ||
        (building.minimapColor !== undefined && !isRgb(building.minimapColor))
      )
        throw invalid(`gives ${actor.id} invalid building colors or height`);
      if (
        building.details !== undefined &&
        !Object.prototype.hasOwnProperty.call(
          BUILTIN_BUILDING_DETAILS,
          building.details,
        )
      )
        throw invalid(
          `gives ${actor.id} unknown building details "${building.details}"`,
        );
      if (building.glb !== undefined) {
        validateModelGraphics(building.glb);
        if (building.details !== undefined)
          throw invalid(`gives ${actor.id} multiple building models`);
      }
    }
    if (actor.footprint ? !building : actor.movement && !model)
      throw invalid(`needs presentation for ${actor.id}'s geometry`);
  }
  if (pack.clips !== undefined && !isRecord(pack.clips))
    throw invalid("needs clips keyed by ID");
  for (const [id, clip] of Object.entries(pack.clips ?? {}))
    validateTextureClip(id, clip);
  if (pack.props !== undefined && !isRecord(pack.props))
    throw invalid("needs props keyed by ID");
  for (const [id, graphics] of Object.entries(pack.props ?? {})) {
    if (!isOneOf(PROP_IDS, id)) throw invalid(`has an unknown prop ${id}`);
    validateModelGraphics(graphics);
  }
  validateTerrainStyle(pack.terrain, pack.clips ?? {}, invalid);
  return deepFreeze(pack);
}

const isNonnegative = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;
const isAlpha = (value: unknown) => isNonnegative(value) && value <= 1;
const isRgba = (value: unknown) =>
  Array.isArray(value) &&
  value.length === 4 &&
  value.every(isNonnegative) &&
  isAlpha(value[3]);
const isOptionalBoolean = (value: unknown) =>
  value === undefined || typeof value === "boolean";

/** Two distinct, non-negative grades; either may be the steeper. */
function isSlopeFade(value: unknown): boolean {
  const isGrade = (grade: unknown) =>
    typeof grade === "number" && Number.isFinite(grade) && grade >= 0;
  return (
    isRecord(value) &&
    isGrade(value.start) &&
    isGrade(value.end) &&
    value.start !== value.end
  );
}

function validateTerrainStyle(
  style: TerrainStyle,
  clips: Readonly<Record<string, unknown>>,
  invalid: (problem: string) => Error,
): void {
  for (const [id, type] of Object.entries(style.tileTypes)) {
    if (
      !isRecord(type) ||
      (type.slot !== undefined && !isCount(type.slot)) ||
      !isOptionalBoolean(type.featherEdges) ||
      (type.slopeFade !== undefined && !isSlopeFade(type.slopeFade))
    )
      throw invalid(`has invalid terrain tile type "${id}"`);
    const graphics = type.graphics;
    if (graphics !== undefined) {
      if (
        !graphics ||
        !isId(graphics.url) ||
        typeof graphics.hasAlpha !== "boolean" ||
        !isOptionalBoolean(graphics.layerAlphaOnly) ||
        !isRgba(graphics.minimapColor) ||
        (graphics.clip !== undefined &&
          (!isId(graphics.clip) ||
            !Object.prototype.hasOwnProperty.call(clips, graphics.clip))) ||
        (graphics.clipPhase !== undefined && graphics.clip === undefined)
      )
        throw invalid(`has invalid graphics for terrain tile type "${id}"`);
      for (const [value, positive] of [
        [graphics.scale, true],
        [graphics.scrollSpeed, false],
        [graphics.clipPhase, false],
      ] as const)
        if (
          value !== undefined &&
          (!value ||
            !(positive
              ? isPositive(value.u) && isPositive(value.v)
              : Number.isFinite(value.u) && Number.isFinite(value.v)))
        )
          throw invalid(`has invalid texture coordinates for "${id}"`);
    }
  }
  const shore = style.shore;
  if (
    shore !== undefined &&
    (!shore ||
      !isAlpha(shore.shoreAlpha) ||
      !isAlpha(shore.deepAlpha) ||
      !isCount(shore.depthTiles) ||
      shore.depthTiles === 0)
  )
    throw invalid("has invalid shore settings");
  for (const [typeId, rules] of Object.entries(style.layers)) {
    if (!Array.isArray(rules))
      throw invalid(`needs a layer list for ${typeId}`);
    for (const rule of rules) {
      if (
        !rule ||
        !isId(rule.tileType) ||
        !Object.prototype.hasOwnProperty.call(style.tileTypes, rule.tileType)
      )
        throw invalid(
          `styles ${typeId} with unknown tile type "${rule?.tileType}"`,
        );
      if (
        !isRgba(rule.color) ||
        !isOptionalBoolean(rule.variation) ||
        !isOptionalBoolean(rule.shoreFade) ||
        (rule.coverage !== undefined && !isAlpha(rule.coverage)) ||
        (rule.shoreFade && !shore)
      )
        throw invalid(`has invalid layer settings for ${typeId}`);
    }
  }
}
