import { Color4 } from "@babylonjs/core";

import type { TerrainMapOptions, TileType } from "../map";
import type { TerrainView } from "../simulation/terrain";

/** One visual layer that tiles of a terrain type carry. */
export type TerrainLayerRule = {
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

/** Builds each tile's layers from its terrain type, so saved terrain keeps its look. */
export function terrainLayers(
  style: TerrainStyle,
): NonNullable<TerrainMapOptions["createLayers"]> {
  const tileTypes = new Map(
    Object.entries(style.tileTypes).map(([id, type]) => [id, { ...type, id }]),
  );
  return (x, z, { typeId }, map) => {
    let depth: number | undefined;
    return (style.layers[typeId] ?? []).flatMap((rule) => {
      if (
        rule.coverage !== undefined &&
        !(Math.sin(x * 0.47 - z * 0.29) > Math.cos(Math.PI * rule.coverage))
      )
        return [];
      if (rule.shoreFade && style.shore && depth === undefined)
        depth = shoreDepth(style.shore.depthTiles, map, x, z, typeId);
      const [red, green, blue, alpha] = rule.color;
      const tint = rule.variation
        ? Math.sin(x * 0.23) * 0.025 + Math.cos(z * 0.19) * 0.02
        : 0;

      return [
        {
          type: tileTypes.get(rule.tileType),
          color: new Color4(
            red + tint,
            green + tint,
            blue + tint,
            rule.shoreFade && style.shore
              ? alpha * shoreAlpha(style.shore, depth!)
              : alpha,
          ),
        },
      ];
    });
  };
}

/** Depth from the nearest tile of another type, using current terrain. */
function shoreDepth(
  reach: number,
  map: TerrainView,
  x: number,
  z: number,
  typeId: string,
): number {
  let edge = reach + 0.5;
  for (
    let dz = Math.max(-reach, -z);
    dz <= Math.min(reach, map.height - 1 - z);
    dz++
  )
    for (
      let dx = Math.max(-reach, -x);
      dx <= Math.min(reach, map.width - 1 - x);
      dx++
    ) {
      const [nx, nz] = [x + dx, z + dz];
      if (map.terrainAt(nx, nz).typeId !== typeId)
        edge = Math.min(edge, Math.hypot(dx, dz));
    }
  return Math.min(1, (edge - 0.5) / reach);
}

/** Eases opacity from the shore so the edge reads as a shoreline. */
function shoreAlpha(
  { shoreAlpha, deepAlpha }: NonNullable<TerrainStyle["shore"]>,
  depth: number,
): number {
  const eased = depth * depth * (3 - 2 * depth);
  return shoreAlpha + (deepAlpha - shoreAlpha) * eased;
}
