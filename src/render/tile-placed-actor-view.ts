import {
  Color3,
  MeshBuilder,
  StandardMaterial,
  TransformNode,
  Vector3,
} from "@babylonjs/core";

import { createProductionExitMarker } from "./production-exit";
import { occupiedTilesFor, tilePlacedPose } from "../simulation/placement";
import { tileKey } from "../simulation/grid";
import { createViewRegistry } from "./view-registry";
import { isRgb } from "./color";
import { createFootprintOverlay } from "./footprint-overlay";
import { createScreenBar } from "./screen-bar";

import type { AbstractMesh, Scene } from "@babylonjs/core";
import type { TerrainMap, TileCoord } from "../map";
import type { ActorDefinition } from "../simulation/actor";
import type { TilePlacedActorState } from "../simulation/placement";
import type { Rgb } from "./color";

/** Gap left on footprint sides that face unoccupied tiles. */
const EDGE_INSET_TILES = 0.06;
const DEFAULT_HEIGHT = 1.5;
/** Below the building health bar, which sits higher above the ground. */
const CONSTRUCTION_BAR_HEIGHT = 1.9;
const DEFAULT_COLOR: Rgb = [0.35, 0.42, 0.46];

/**
 * Returns the registry's material for this definition and name, calling
 * `configure` only when first creating it. The registry disposes it.
 */
export type SharedMaterial = (
  name: string,
  configure: (material: StandardMaterial) => void,
) => StandardMaterial;

/** The root is untransformed; center and roof use world coordinates. */
export type TilePlacedActorDetailsFactory = (
  root: TransformNode,
  placement: {
    center: Vector3;
    roof: number;
    tileSize: number;
    facing: number;
  },
  material: SharedMaterial,
) => { update: (elapsedSeconds: number) => void; dispose: () => void };

/** Renderer-owned presentation for one tile-placed actor definition. */
export type TilePlacedActorAppearance = {
  height: number;
  color: Rgb;
  minimapColor?: Rgb;
  createDetails?: TilePlacedActorDetailsFactory;
};

export type TilePlacedActorAppearanceCatalog = ReadonlyMap<
  string,
  TilePlacedActorAppearance
>;

export type TilePlacedActorViewRegistry = {
  update: (
    actors: readonly TilePlacedActorState[],
    disconnected?: ReadonlySet<string>,
  ) => void;
  animate: (elapsedSeconds: number) => void;
  actorIdForMesh: (mesh: AbstractMesh | null) => string | undefined;
  setSelectedActor: (actorId: string | undefined) => void;
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
  { preview = false }: { preview?: boolean } = {},
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
  const actorIds = new WeakMap<TransformNode, string>();
  let actors: readonly TilePlacedActorState[] = [];
  let disconnectedIds: ReadonlySet<string> = new Set();
  let selectedActorId: string | undefined;
  let selection: ReturnType<typeof createFootprintOverlay> | undefined;
  let selectionKey = "";
  const terrainRevisions = new Map<string, number>();
  let terrainRevision = 0;
  let terrainDirty = false;
  const terrainObserver = map.onChangedObservable.add((bounds) => {
    terrainRevision += 1;
    for (const actor of actors) {
      const tiles = occupiedTilesFor(
        actor,
        definitionsById.get(actor.definitionId)!,
      );
      if (
        preview ||
        tiles.some(
          ({ x, z }) =>
            x >= bounds.minX &&
            x <= bounds.maxX &&
            z >= bounds.minZ &&
            z <= bounds.maxZ,
        )
      ) {
        terrainRevisions.set(actor.id, terrainRevision);
        terrainDirty = true;
      }
    }
  });
  const refreshSelection = () => {
    const actor = actors.find(({ id }) => id === selectedActorId);
    const key = actor
      ? JSON.stringify([
          actor.id,
          actor.definitionId,
          actor.tilePlacement,
          map.navigationChanges.generation,
          terrainRevisions.get(actor.id),
        ])
      : "";
    if (key === selectionKey) return;
    selection?.dispose();
    selection = actor
      ? createFootprintOverlay(
          scene,
          map,
          occupiedTilesFor(actor, definitionsById.get(actor.definitionId)!),
          { name: "building-selection", color: new Color3(1, 0.78, 0.24) },
        )
      : undefined;
    selectionKey = key;
  };

  const materialFor =
    (definitionId: string): SharedMaterial =>
    (name, configure) => {
      const key = JSON.stringify([definitionId, name]);
      let material = materials.get(key);
      if (!material) {
        material = new StandardMaterial(
          `tile-placed-actor-${definitionId}-${name}`,
          scene,
        );
        configure(material);
        materials.set(key, material);
      }
      return material;
    };
  // Extend edge heights so rejected off-map previews can still be drawn.
  const heightAt = (x: number, z: number) =>
    map.heightAt(
      preview ? Math.max(0, Math.min(map.width, x)) : x,
      preview ? Math.max(0, Math.min(map.height, z)) : z,
    );
  const cornerHeights = ({ x, z }: TileCoord) => [
    heightAt(x, z),
    heightAt(x + 1, z),
    heightAt(x, z + 1),
    heightAt(x + 1, z + 1),
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
    if (!preview) actorIds.set(root, actor.id);
    const shared = materialFor(definition.id);
    const body = shared("material", (material) => {
      material.diffuseColor = new Color3(
        ...(appearances.get(definition.id)?.color ?? DEFAULT_COLOR),
      );
      material.specularColor = new Color3(0.16, 0.18, 0.19);
    });
    const tiles = occupiedTilesFor(actor, definition);
    const occupied = new Set(tiles.map(tileKey));
    const roof =
      Math.max(...tiles.flatMap(cornerHeights)) +
      (appearances.get(definition.id)?.height ?? DEFAULT_HEIGHT);
    for (const tile of tiles) {
      const inset = (dx: number, dz: number) =>
        occupied.has(tileKey({ x: tile.x + dx, z: tile.z + dz }))
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
      column.material = body;
    }
    const { worldPosition, facing } = tilePlacedPose(map, actor, definition);
    const details = appearances.get(definition.id)?.createDetails?.(
      root,
      {
        center: new Vector3(worldPosition.x, roof, worldPosition.z),
        roof,
        tileSize: map.tileSize,
        facing,
      },
      shared,
    );
    if (preview) {
      for (const mesh of root.getChildMeshes()) {
        mesh.isPickable = false;
        if (mesh.material) mesh.material.alpha = 0.42;
      }
    }
    const exit =
      preview && definition.production
        ? createProductionExitMarker(scene, map, root, tiles, facing)
        : undefined;
    // The view key includes construction, so completion rebuilds the view.
    const disconnected = !preview && disconnectedIds.has(actor.id);
    const constructing = !preview && actor.construction !== undefined;
    if (constructing)
      for (const mesh of root.getChildMeshes()) mesh.visibility = 0.45;
    const offlineMaterials = new Map<StandardMaterial, StandardMaterial>();
    if (disconnected)
      for (const mesh of root.getChildMeshes()) {
        if (!(mesh.material instanceof StandardMaterial)) continue;
        let dimmed = offlineMaterials.get(mesh.material);
        if (!dimmed) {
          dimmed = mesh.material.clone(
            `${root.name}-offline-${mesh.material.name}`,
          );
          dimmed.diffuseColor = dimmed.diffuseColor.scale(0.35);
          dimmed.emissiveColor = Color3.Black();
          offlineMaterials.set(mesh.material, dimmed);
        }
        mesh.material = dimmed;
      }
    if (disconnected) {
      const badge = MeshBuilder.CreateLineSystem(
        `${root.name}-offline`,
        {
          lines: [
            [
              new Vector3(-0.3, 0.55, 0),
              new Vector3(0.15, 0, 0),
              new Vector3(-0.15, 0, 0),
              new Vector3(0.3, -0.55, 0),
            ],
            [new Vector3(-0.55, -0.55, 0), new Vector3(0.55, 0.55, 0)],
            [new Vector3(-0.55, 0.55, 0), new Vector3(0.55, -0.55, 0)],
          ],
        },
        scene,
      );
      badge.parent = root;
      badge.position.set(worldPosition.x, roof + 1, worldPosition.z);
      badge.billboardMode = TransformNode.BILLBOARDMODE_ALL;
      badge.color = new Color3(1, 0.7, 0.15);
      badge.isPickable = false;
    }
    let progress:
      | { bar: ReturnType<typeof createScreenBar>; fill: StandardMaterial }
      | undefined;
    if (constructing) {
      const bar = createScreenBar(scene, `${root.name}-construction`, {
        width: 2 * map.tileSize,
        frame: shared("construction-background", (material) => {
          material.emissiveColor = new Color3(0.12, 0.16, 0.18);
          material.disableLighting = true;
        }),
      });
      bar.root.parent = root;
      bar.root.position.set(
        worldPosition.x,
        roof + CONSTRUCTION_BAR_HEIGHT,
        worldPosition.z,
      );
      const fill = shared("construction-fill", (material) => {
        material.emissiveColor = new Color3(1, 0.78, 0.24);
        material.disableLighting = true;
      });
      progress = { bar, fill };
    }
    return {
      root,
      update: ({ construction }: TilePlacedActorState) => {
        if (!progress || !construction) return;
        progress.bar.setFill(
          construction.completedTicks / construction.totalTicks,
          progress.fill,
        );
      },
      animate: (seconds: number) =>
        details?.update(constructing || disconnected ? 0 : seconds),
      dispose: () => {
        details?.dispose();
        exit?.dispose();
        root.dispose();
        for (const material of offlineMaterials.values()) material.dispose();
      },
    };
  };
  // Restoration can reuse an ID at another placement or change its terrain.
  const roots = createViewRegistry({
    keyFor: ({
      id,
      definitionId,
      tilePlacement,
      construction,
    }: TilePlacedActorState) =>
      JSON.stringify([
        definitionId,
        tilePlacement,
        !!construction,
        disconnectedIds.has(id),
        map.navigationChanges.generation,
        terrainRevisions.get(id),
      ]),
    create,
  });

  const update = (
    nextActors: readonly TilePlacedActorState[],
    disconnected: ReadonlySet<string> = disconnectedIds,
  ) => {
    disconnectedIds = disconnected;
    actors = nextActors;
    roots.sync(actors);
    for (const actor of actors) roots.get(actor.id)!.update(actor);
    for (const id of terrainRevisions.keys()) {
      if (!roots.has(id)) terrainRevisions.delete(id);
    }
    refreshSelection();
    terrainDirty = false;
  };
  return {
    update,
    animate: (seconds) => {
      if (terrainDirty) update(actors);
      for (const view of roots.values()) view.animate(seconds);
    },
    actorIdForMesh: (mesh) => {
      for (
        let node = mesh as TransformNode | null;
        node;
        node = node.parent as TransformNode | null
      ) {
        const id = actorIds.get(node);
        if (id && roots.get(id)?.root === node) return id;
      }
      return undefined;
    },
    setSelectedActor: (actorId) => {
      selectedActorId = actorId;
      refreshSelection();
    },
    dispose: () => {
      map.onChangedObservable.remove(terrainObserver);
      terrainRevisions.clear();
      selection?.dispose();
      roots.dispose();
      for (const material of materials.values()) {
        material.dispose();
      }
      materials.clear();
    },
  };
}
