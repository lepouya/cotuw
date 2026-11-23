import type { TerrainGridOptions } from "../simulation/terrain.ts";

/** Heights climb `faceHeight` over the first border tile, then `risePerTile`. */
const BORDER_SCENERY = {
  rock: { typeId: "rough", faceHeight: 0.5, risePerTile: 0.5 },
  mountain: { typeId: "rough", faceHeight: 3, risePerTile: 1 },
  water: { typeId: "water", faceHeight: 0, risePerTile: 0 },
} as const;

/** Out-of-bounds scenery that frames a map without adding playable ground. */
export type BorderScenery = keyof typeof BORDER_SCENERY;

/** Out-of-bounds tiles every map keeps beyond its playable ground. */
export const MAP_BORDER_TILES = 4;

/**
 * Makes every tile that reaches beyond the playable boundary out of bounds and
 * dresses it with `sceneryAt`, sampled at tile centers and corners. Corners on
 * the boundary keep their heights, so playable ground is unchanged.
 * `extraDepth` deepens the border, in tiles, such as where a map cuts its
 * corners.
 */
export function withScenicBorder(
  terrain: TerrainGridOptions,
  sceneryAt: (x: number, z: number) => BorderScenery,
  extraDepth: (x: number, z: number) => number = () => 0,
): TerrainGridOptions {
  const { width, height, createHeight, createTerrain, terrainTypeIds } =
    terrain;
  const depth = (x: number, z: number) =>
    Math.max(
      MAP_BORDER_TILES - Math.min(x, width - x),
      MAP_BORDER_TILES - Math.min(z, height - z),
      extraDepth(x, z),
      0,
    );

  return {
    ...terrain,
    ...(terrainTypeIds && {
      terrainTypeIds: [
        ...new Set([
          ...terrainTypeIds,
          ...Object.values(BORDER_SCENERY).map(({ typeId }) => typeId),
        ]),
      ],
    }),
    createHeight: (x, z) => {
      const base = createHeight?.(x, z) ?? 0;
      const borderDepth = depth(x, z);
      if (!borderDepth) return base;
      const { faceHeight, risePerTile } = BORDER_SCENERY[sceneryAt(x, z)];
      return (
        base +
        faceHeight * Math.min(borderDepth, 1) +
        risePerTile * Math.max(borderDepth - 1, 0)
      );
    },
    createTerrain: (x, z) => {
      const tile = createTerrain?.(x, z) ?? { typeId: "plain" };
      if (
        depth(x, z) === 0 &&
        depth(x + 1, z) === 0 &&
        depth(x, z + 1) === 0 &&
        depth(x + 1, z + 1) === 0
      )
        return tile;
      return {
        ...tile,
        typeId: BORDER_SCENERY[sceneryAt(x + 0.5, z + 0.5)].typeId,
        outOfBounds: true,
      };
    },
  };
}
