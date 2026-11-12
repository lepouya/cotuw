import { deepFreeze } from "../simulation/actor";
import { validateAiProfile } from "../simulation/director";
import { validateMovementProfile } from "../simulation/navigation";
import {
  hasOwn,
  isCount,
  isId,
  isIdList,
  isNonnegative,
  isOneOf,
  isRecord,
} from "../simulation/validation";
import { validateAudioBindings, validateAudioContent } from "./audio";
import {
  isRgb,
  validateActorPresentation,
  validateMaterialsStages,
  validateModelGraphics,
} from "./presentation";
import { validateTerrainStyle } from "./terrain-style";
import { validateTextureClip } from "./texture-clip";

import type { ActorDefinition } from "../simulation/actor";
import type { AiProfile } from "../simulation/director";
import type { MovementProfile } from "../simulation/navigation";
import type { AudioBindings, AudioContent } from "./audio";
import type {
  ActorPresentation,
  MaterialsStage,
  ModelGraphics,
  Rgb,
} from "./presentation";
import type { TerrainStyle } from "./terrain-style";
import type { TextureClip } from "./texture-clip";

const FORMAT = "cotuw-content";
const CONTENT_FORMAT_VERSION = 3;

/** Names a content pack and the version whose rules a mission uses. */
export type ContentReference = { id: string; version: number };

export type ViewStyle = {
  clearColor: Rgb;
  /** Distinct colors that mark each owner's actors, in mission owner order. */
  ownerColors: readonly Rgb[];
  lighting: {
    skyColor: Rgb;
    groundColor: Rgb;
    sunColor: Rgb;
    sunDirection: [number, number, number];
    skyIntensity: number;
    sunIntensity: number;
  };
};

const PROP_IDS = [
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

/** Shared rules and presentation that mission files name by ID and version. */
export type ContentPack = ContentReference & {
  audio?: AudioContent;
  name: string;
  /** Player-facing faction names, keyed by simulation faction ID. */
  factionNames?: Readonly<Record<string, string>>;
  actors: readonly ActorDefinition[];
  movementProfiles: readonly MovementProfile[];
  /** Behavior that scenarios assign to AI-controlled owners. */
  aiProfiles?: readonly AiProfile[];
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

/** Each owner's distinct color, in mission owner order. */
export function ownerColors(
  owners: readonly { id: string }[],
  { ownerColors: colors }: Pick<ViewStyle, "ownerColors">,
): ReadonlyMap<string, Rgb> {
  if (owners.length > colors.length)
    throw new RangeError("The owner palette needs a color for every owner.");
  return new Map(owners.map(({ id }, index) => [id, colors[index]!]));
}

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
    pack.aiProfiles !== undefined &&
    (!Array.isArray(pack.aiProfiles) ||
      !isIdList(pack.aiProfiles.map((profile: AiProfile) => profile?.id)))
  )
    throw invalid("needs aiProfiles with distinct IDs");
  for (const profile of pack.aiProfiles ?? []) validateAiProfile(profile);
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
  const colors = pack.view.ownerColors;
  if (
    !Array.isArray(colors) ||
    colors.length < 2 ||
    !colors.every(isRgb) ||
    new Set(colors.map(String)).size !== colors.length
  )
    throw invalid("needs at least two distinct owner colors");

  if (pack.clips !== undefined && !isRecord(pack.clips))
    throw invalid("needs clips keyed by ID");
  for (const [id, clip] of Object.entries(pack.clips ?? {}))
    validateTextureClip(id, clip);
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
  for (const actor of pack.actors)
    validateActorPresentation(
      actor,
      hasOwn(pack.presentation, actor.id)
        ? pack.presentation[actor.id]
        : undefined,
      pack.clips ?? {},
      buttonIds,
      invalid,
    );
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
