import {
  Color3,
  MeshBuilder,
  StandardMaterial,
  TransformNode,
} from "@babylonjs/core";

import { occupiedTilesFor } from "../simulation/placement";
import { createViewRegistry } from "./view-registry";
import { isRgb } from "./color";

import type { Scene } from "@babylonjs/core";
import type { TerrainMap, TileCoord } from "../map";
import type { ActorDefinition } from "../simulation/actor";
import type { TilePlacedActorState } from "../simulation/placement";
import type { Rgb } from "./color";

/** Gap left on footprint sides that face unoccupied tiles. */
const EDGE_INSET_TILES = 0.06;
const DEFAULT_HEIGHT = 1.5;
const DEFAULT_COLOR: Rgb = [0.35, 0.42, 0.46];

/** Renderer-owned presentation for one tile-placed actor definition. */
export type TilePlacedActorAppearance = {
  height: number;
  color: Rgb;
  minimapColor?: Rgb;
};

export type TilePlacedActorAppearanceCatalog = ReadonlyMap<
  string,
  TilePlacedActorAppearance
>;

export type TilePlacedActorViewRegistry = {
  update: (actors: readonly TilePlacedActorState[]) => void;
  dispose: () => void;
};

/**
 * Draws tile-placed actors from renderer-owned appearances. Definitions and
 * appearances are read once per view, so they must not change afterwards.
 */
export function createTilePlacedActorViewRegistry(
  scene: Scene,
  map: TerrainMap,
  definitions: readonly ActorDefinition[],
  appearances: TilePlacedActorAppearanceCatalog,
): TilePlacedActorViewRegistry {
  for (const [definitionId, appearance] of appearances) {
    if (
      !(appearance.height > 0) ||
      !Number.isFinite(appearance.height) ||
      !isRgb(appearance.color) ||
      (appearance.minimapColor !== undefined && !isRgb(appearance.minimapColor))
    ) {
      throw new RangeError(
        `Invalid tile-placed actor appearance: ${definitionId}.`,
      );
    }
  }
  const definitionsById = new Map(
    definitions.map((definition) => [definition.id, definition]),
  );
  const materials = new Map<string, StandardMaterial>();

  const materialFor = (definitionId: string) => {
    let material = materials.get(definitionId);
    if (!material) {
      material = new StandardMaterial(
        `tile-placed-actor-${definitionId}-material`,
        scene,
      );
      material.diffuseColor = new Color3(
        ...(appearances.get(definitionId)?.color ?? DEFAULT_COLOR),
      );
      material.specularColor = new Color3(0.16, 0.18, 0.19);
      materials.set(definitionId, material);
    }
    return material;
  };
  const cornerHeights = ({ x, z }: TileCoord) => [
    map.heightAt(x, z),
    map.heightAt(x + 1, z),
    map.heightAt(x, z + 1),
    map.heightAt(x + 1, z + 1),
  ];

  // One column per occupied tile, from its lowest corner to a shared roof, so
  // the body matches the footprint's shape and never floats on a slope.
  const create = (actor: TilePlacedActorState) => {
    const definition = definitionsById.get(actor.definitionId);
    if (!definition) {
      throw new Error(
        `Unknown tile-placed actor definition: ${actor.definitionId}.`,
      );
    }
    const root = new TransformNode(`tile-placed-actor-${actor.id}-root`, scene);
    const material = materialFor(definition.id);
    const tiles = occupiedTilesFor(actor, definition);
    const occupied = new Set(tiles.map(({ x, z }) => `${x},${z}`));
    const roof =
      Math.max(...tiles.flatMap(cornerHeights)) +
      (appearances.get(definition.id)?.height ?? DEFAULT_HEIGHT);
    for (const tile of tiles) {
      const inset = (dx: number, dz: number) =>
        occupied.has(`${tile.x + dx},${tile.z + dz}`)
          ? 0
          : EDGE_INSET_TILES * map.tileSize;
      const low = map.worldPoint(
        tile.x,
        tile.z,
        Math.min(...cornerHeights(tile)),
      );
      const minX = low.x + inset(-1, 0);
      const maxX = low.x + map.tileSize - inset(1, 0);
      const minZ = low.z + inset(0, -1);
      const maxZ = low.z + map.tileSize - inset(0, 1);
      const column = MeshBuilder.CreateBox(
        `tile-placed-actor-${actor.id}-tile-${tile.x}-${tile.z}`,
        { width: maxX - minX, depth: maxZ - minZ, height: roof - low.y },
        scene,
      );
      column.parent = root;
      column.position.set(
        (minX + maxX) / 2,
        (low.y + roof) / 2,
        (minZ + maxZ) / 2,
      );
      column.material = material;
    }
    return root;
  };
  // Restoration can reuse an ID at another placement or change its terrain.
  const roots = createViewRegistry({
    keyFor: ({ definitionId, tilePlacement }: TilePlacedActorState) =>
      JSON.stringify([
        definitionId,
        tilePlacement,
        map.navigationChanges.generation,
      ]),
    create,
  });

  return {
    update: roots.sync,
    dispose: () => {
      roots.dispose();
      for (const material of materials.values()) {
        material.dispose();
      }
      materials.clear();
    },
  };
}
