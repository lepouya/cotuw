import { Plane } from "@babylonjs/core";

import type { AbstractMesh, TransformNode } from "@babylonjs/core";
import type { TerrainMap, TileCoord } from "../map";
import type { TilePlacedActorState } from "../simulation/placement";
import type { ModelAsset, ModelInstance } from "./glb-model";
import type { createMaterialCopies } from "./material-copies";

/**
 * Visible fraction of the building's height at each construction stage. The
 * scaffold stays half the building's height ahead of it.
 */
const STAGE_HEIGHTS = [0, 0.5, 1] as const;
/** Used for the scaffold until the building's art loads. */
const STAND_IN_BUILDING_HEIGHT = 1;

/** Equal thirds of construction progress, numbered from zero. */
export function constructionStage({
  completedTicks,
  totalTicks,
}: NonNullable<TilePlacedActorState["construction"]>): number {
  return Math.min(
    STAGE_HEIGHTS.length - 1,
    Math.floor((completedTicks / totalTicks) * STAGE_HEIGHTS.length),
  );
}

/**
 * Shows a blueprint's stage: its building parts only up to their built height,
 * inside an optional scaffold around the footprint. Heights are world values;
 * `top` is the finished building's highest point.
 */
export function stageBlueprint(
  {
    root,
    parts,
    tiles,
    roof,
    top,
  }: {
    root: TransformNode;
    parts: readonly AbstractMesh[];
    tiles: readonly TileCoord[];
    roof: number;
    top: number;
  },
  stage: number,
  map: TerrainMap,
  materials: ReturnType<typeof createMaterialCopies>,
  scaffold: ModelAsset | undefined,
): ModelInstance | undefined {
  const fraction = STAGE_HEIGHTS[stage]!;
  const building = top > roof ? top - roof : STAND_IN_BUILDING_HEIGHT;
  if (fraction === 0) for (const mesh of parts) mesh.setEnabled(false);
  else if (fraction < 1)
    materials.edit(parts, "stage", (material) => {
      material.clipPlane = new Plane(0, 1, 0, -(roof + building * fraction));
    });
  if (!scaffold) return undefined;
  const instance = scaffold.instantiate(`${root.name}-scaffold`);
  const xs = tiles.flatMap(({ x }) => [x, x + 1]);
  const zs = tiles.flatMap(({ z }) => [z, z + 1]);
  const low = map.worldPoint(Math.min(...xs), Math.min(...zs), 0);
  const high = map.worldPoint(Math.max(...xs), Math.max(...zs), 0);
  const height = building * Math.min(1, fraction + STAGE_HEIGHTS[1]);
  instance.root.parent = root;
  instance.root.scaling.set(high.x - low.x, height, high.z - low.z);
  instance.root.position.set(
    (low.x + high.x) / 2,
    roof + height / 2,
    (low.z + high.z) / 2,
  );
  for (const mesh of instance.root.getChildMeshes()) mesh.isPickable = false;
  return instance;
}

/** Living models expose authored roots, ribs, and canopy layers. */
export function stageGrowth(parts: readonly AbstractMesh[], stage: number) {
  for (const mesh of parts) {
    const layer = mesh.name.includes("growth-canopy")
      ? 2
      : mesh.name.includes("growth-ribs")
        ? 1
        : 0;
    mesh.setEnabled(layer <= stage);
    mesh.visibility = 0.85;
  }
}
