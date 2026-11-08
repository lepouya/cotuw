import { Color4 } from "@babylonjs/core";

import { TerrainMap } from "../map";
import type { TerrainMapOptions } from "../map";
import { createScenarioMap } from "../simulation/scenario";
import type { ScenarioTerrain } from "../simulation/scenario";
import type { TerrainStyle } from "../content/terrain-style";
import type { TerrainGridOptions, TerrainView } from "../simulation/terrain";

/** Builds each tile's layers from its terrain type, so saved terrain keeps its look. */
export function terrainLayers(
  style: TerrainStyle,
): NonNullable<TerrainMapOptions["createLayers"]> {
  const tileTypes = new Map(
    Object.entries(style.tileTypes).map(([id, type]) => [id, { ...type, id }]),
  );
  const layers = new Map(Object.entries(style.layers));
  return (x, z, { typeId }, map) => {
    let depth: number | undefined;
    return (layers.get(typeId) ?? []).flatMap((rule) => {
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

/** Builds a rendered terrain map with optional layer styles. */
export function createSessionMap(
  scenario: ScenarioTerrain,
  style?: TerrainStyle,
): TerrainMap {
  const createLayers = style ? terrainLayers(style) : undefined;
  return createScenarioMap(
    scenario,
    (options: TerrainGridOptions) =>
      new TerrainMap({
        ...options,
        createLayers,
        layerUpdateRadius: style?.shore?.depthTiles,
      }),
  );
}
