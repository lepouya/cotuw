import { deepFreeze } from "../simulation/actor";
import { validateAudioBindings, validateAudioContent } from "./audio";
import type { AudioBindings, AudioContent } from "./audio";
import {
  hasOwn,
  isCount,
  isId,
  isIdList,
  isNonnegative,
  isOneOf,
  isPositive,
  isRecord,
} from "../simulation/validation";
import { validateMovementProfile } from "../simulation/navigation";
import {
  isRgb,
  PORTRAIT_IDS,
  BUILTIN_ACTOR_MODEL_IDS,
  BUILTIN_BUILDING_DETAIL_IDS,
  validateActorGraphics,
  validateModelGraphics,
  validateFrameEffects,
  DAMAGE_EFFECT_STYLES,
  ATTACK_EFFECT_STYLES,
  validateMaterialsStages,
} from "./presentation";
import type {
  PortraitId,
  ActorGraphics,
  ModelGraphics,
  FrameEffects,
  DamageEffectStyle,
  AttackEffectStyle,
  MaterialsStage,
  Rgb,
  BuiltinActorModelId,
  BuiltinBuildingDetailId,
} from "./presentation";
import { validateTextureClip } from "./texture-clip";

import type { ActorDefinition } from "../simulation/actor";
import type { MovementProfile } from "../simulation/navigation";
import type { TerrainStyle } from "../render/terrain-style";
import type { TextureClip } from "./texture-clip";

const FORMAT = "cotuw-content";
export const CONTENT_FORMAT_VERSION = 1;

/** Names a content pack and the version whose rules a mission uses. */
export type ContentReference = { id: string; version: number };

/** A GLB asset, or a built-in procedural model at an optional scale. */
export type ActorModel =
  { glb: ActorGraphics } | { builtin: BuiltinActorModelId; scale?: number };

/** How the player sees and commands one actor definition. */
export type ActorPresentation = {
  audio?: AudioBindings;
  name: string;
  description: string;
  portrait?: PortraitId;
  build?: { id: string; label: string; order?: number };
  train?: { id: string; label: string };
  attackEffect?: AttackEffectStyle;
  /** How damage shows once health drops; absent shows none. */
  damageEffect?: DamageEffectStyle;
  regenerationEffect?: boolean;
  model?: ActorModel;
  frameEffects?: FrameEffects;
  building?: {
    height: number;
    color: Rgb;
    minimapColor?: Rgb;
    /** A built-in set of articulated parts. */
    details?: BuiltinBuildingDetailId;
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
  "cultivation-site",
  "salvage",
  "tracer",
  "bolt",
  "bite",
  "smoke",
  "fire",
  "wound",
  "leaf",
  "bird",
  "regeneration",
] as const;

export type PropId = (typeof PROP_IDS)[number];

/** A faction's display name, if the pack provides one. */
export function factionName(
  pack: Pick<ContentPack, "factionNames">,
  faction: string | undefined,
): string | undefined {
  return faction !== undefined &&
    pack.factionNames &&
    hasOwn(pack.factionNames, faction)
    ? pack.factionNames[faction]
    : undefined;
}

/** Shared rules and presentation that mission files name by ID and version. */
export type ContentPack = ContentReference & {
  audio?: AudioContent;
  name: string;
  /** Player-facing faction names, keyed by simulation faction ID. */
  factionNames?: Readonly<Record<string, string>>;
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
  /** Descending fullness cutoffs; the last stage starts above zero. */
  materialsStages?: readonly MaterialsStage[];
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
  if (
    pack.factionNames !== undefined &&
    (!isRecord(pack.factionNames) ||
      Object.entries(pack.factionNames).some(
        ([id, name]) => !isId(id) || !isId(name),
      ))
  )
    throw invalid("needs faction IDs with nonempty display names");
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
  if (pack.audio !== undefined) validateAudioContent(pack.audio, invalid);
  for (const [id, presentation] of Object.entries(pack.presentation)) {
    if (!isId(id) || !isRecord(presentation))
      throw invalid(`gives ${id} invalid presentation`);
    if (presentation.audio !== undefined)
      validateAudioBindings(
        presentation.audio as AudioBindings,
        pack.audio,
        invalid,
        id,
      );
  }
  for (const actor of pack.actors) {
    const presentation = (
      hasOwn(pack.presentation, actor.id)
        ? pack.presentation[actor.id]
        : undefined
    ) as ActorPresentation;
    if (
      !presentation ||
      !isId(presentation.name) ||
      typeof presentation.description !== "string"
    )
      throw invalid(`needs a name and description for ${actor.id}`);
    if (
      presentation.portrait !== undefined &&
      !isOneOf(PORTRAIT_IDS, presentation.portrait)
    )
      throw invalid(`gives ${actor.id} an unknown portrait`);
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
      presentation.build?.order !== undefined &&
      !isNonnegative(presentation.build.order)
    )
      throw invalid(`gives ${actor.id} an invalid building order`);
    if (presentation.build && !actor.footprint)
      throw invalid(`gives ${actor.id} a build action without a footprint`);
    if (presentation.train && (!actor.movement || actor.footprint))
      throw invalid(`gives ${actor.id} a train action without a mobile unit`);
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
    if (!isOptionalBoolean(presentation.regenerationEffect))
      throw invalid(`gives ${actor.id} an invalid regeneration effect`);
    const model = presentation.model;
    if (model !== undefined) {
      if (!isRecord(model)) throw invalid(`gives ${actor.id} an invalid model`);
      const isGlb = "glb" in model;
      const isBuiltin = "builtin" in model;
      if (isGlb === isBuiltin)
        throw invalid(`gives ${actor.id} an invalid model`);
      if ("glb" in model) validateActorGraphics(model.glb);
      else {
        if (!isOneOf(BUILTIN_ACTOR_MODEL_IDS, model.builtin))
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
        !isOneOf(BUILTIN_BUILDING_DETAIL_IDS, building.details)
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
  if (pack.materialsStages !== undefined)
    validateMaterialsStages(pack.materialsStages);
  validateTerrainStyle(pack.terrain, pack.clips ?? {}, invalid);
  return deepFreeze(pack);
}

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
          (!isId(graphics.clip) || !hasOwn(clips, graphics.clip))) ||
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
        !hasOwn(style.tileTypes, rule.tileType)
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
