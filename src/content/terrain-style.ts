import {
  hasOwn,
  isCount,
  isId,
  isNonnegative,
  isPositive,
  isRecord,
} from "../simulation/validation";

/** How a tile type is drawn. */
export type TileGraphics = {
  /** An image that repeats once per tile, or a clip's sprite sheet. */
  url: string;
  /** Names a content-pack texture clip that plays cells of `url`. */
  clip?: string;
  /**
   * Seconds each tile's clip lags its neighbor toward negative x and z, so
   * motion rolls across the terrain instead of playing in unison.
   */
  clipPhase?: { u: number; v: number };
  hasAlpha: boolean;
  /** Ignores the image's alpha, so the layer color alone sets opacity. */
  layerAlphaOnly?: boolean;
  /** Image repeats per tile. */
  scale?: { u: number; v: number };
  /** Image repeats per second. */
  scrollSpeed?: { u: number; v: number };
  /** The image's mean color, with alpha as the share of a tile it covers. */
  minimapColor: readonly [number, number, number, number];
};

/** A kind of terrain layer, shared by every tile that carries it. */
export type TileType = {
  /** Layers whose types share an ID render and blend as one type. */
  id: string;
  /**
   * Fixed stack position, overriding the layer's array index. Optional types
   * need it so neighboring tiles keep the same height and blend order.
   */
  slot?: number;
  /** Fades alpha at corners shared with tiles that lack this type. */
  featherEdges?: boolean;
  /**
   * Fades alpha from full at grade `start` to none at grade `end`, as rise
   * over horizontal run. An `end` below `start` shows the layer on steep
   * ground only.
   */
  slopeFade?: { start: number; end: number };
  /** Absent for a plain surface drawn in the layer color alone. */
  graphics?: TileGraphics;
};

/** One visual layer that tiles of a terrain type carry. */
type TerrainLayerRule = {
  tileType: string;
  color: [number, number, number, number];
  /** Adds a gentle per-tile tint so large areas do not look flat. */
  variation?: boolean;
  /** Shows on this share of tiles, in a fixed pattern; absent shows on all. */
  coverage?: number;
  /** Fades from the edge of its terrain to full opacity deeper inside. */
  shoreFade?: boolean;
};

/** Content-defined terrain presentation, independent of simulation terrain. */
export type TerrainStyle = {
  tileTypes: Readonly<Record<string, Omit<TileType, "id">>>;
  /** Opacity at the edge and the center of shore-faded layers. */
  shore?: { shoreAlpha: number; deepAlpha: number; depthTiles: number };
  /** Layers by terrain type ID, bottom first. */
  layers: Readonly<Record<string, readonly TerrainLayerRule[]>>;
};

const isAlpha = (value: unknown) => isNonnegative(value) && value <= 1;
const isRgba = (value: unknown) =>
  Array.isArray(value) &&
  value.length === 4 &&
  value.every(isNonnegative) &&
  isAlpha(value[3]);
const isOptionalBoolean = (value: unknown) =>
  value === undefined || typeof value === "boolean";

/** Two distinct, non-negative grades; either may be the steeper. */
const isSlopeFade = (value: unknown) =>
  isRecord(value) &&
  isNonnegative(value.start) &&
  isNonnegative(value.end) &&
  value.start !== value.end;

const isOptionalUv = (value: unknown, valid: (part: unknown) => boolean) =>
  value === undefined || (isRecord(value) && valid(value.u) && valid(value.v));

/** Checks a parsed style; `clips` holds the pack's texture clips by ID. */
export function validateTerrainStyle(
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
      if (
        !isOptionalUv(graphics.scale, isPositive) ||
        !isOptionalUv(graphics.scrollSpeed, Number.isFinite) ||
        !isOptionalUv(graphics.clipPhase, Number.isFinite)
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
