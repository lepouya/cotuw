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
import { constructionStage, stageBlueprint } from "./construction-stage";
import { createMaterialCopies } from "./material-copies";
import { hierarchyMeshes, unitCubeInstance } from "./glb-model";

import type { AbstractMesh, Scene } from "@babylonjs/core";
import type { TerrainMap, TileCoord } from "../map";
import type { ActorDefinition } from "../simulation/actor";
import type { TilePlacedActorState } from "../simulation/placement";
import type { BuildingActivityKind } from "../simulation/production";
import type { Rgb } from "./color";
import type { ModelAsset, ModelInstance } from "./glb-model";

/** Gap left on footprint sides that face unoccupied tiles. */
const EDGE_INSET_TILES = 0.06;
const DEFAULT_HEIGHT = 1.5;
/** Below the building health bar, which sits higher above the ground. */
const CONSTRUCTION_BAR_HEIGHT = 1.9;
const DEFAULT_COLOR: Rgb = [0.35, 0.42, 0.46];

/** A one-shot motion that starts and ends at the rest pose. */
export type BuildingMotion = {
  seconds: number;
  pose: (seconds: number) => void;
};
/** Motions that play once per building activity. */
export type BuildingMotions = Partial<
  Record<BuildingActivityKind, BuildingMotion>
>;

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
) => {
  update: (elapsedSeconds: number) => void;
  /** `update` repeats after this many seconds, so it can loop as one clip. */
  loopSeconds?: number;
  /** Each activity's motion; none moves a part that `update` moves. */
  activities?: BuildingMotions;
  dispose: () => void;
};

/** Renderer-owned presentation for one tile-placed actor definition. */
export type TilePlacedActorAppearance = {
  height: number;
  color: Rgb;
  minimapColor?: Rgb;
  createDetails?: TilePlacedActorDetailsFactory;
  foundation?: ModelAsset;
  /** A unit-cube frame that construction stages scale around the footprint. */
  scaffold?: ModelAsset;
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
  /**
   * Poses idle motion at `elapsedSeconds` and advances activities by
   * `frameSeconds` of real time.
   */
  animate: (elapsedSeconds: number, frameSeconds?: number) => void;
  /** Starts an activity's motion unless motion is reduced. */
  play: (actorId: string, kind: BuildingActivityKind) => void;
  /** The world height of a drawn building's highest point. */
  topHeight: (actorId: string) => number | undefined;
  actorIdForMesh: (mesh: AbstractMesh | null) => string | undefined;
  setSelectedActor: (actorId: string | undefined) => void;
  dispose: () => void;
};

/**
 * Draws tile-placed actors from renderer-owned appearances. Definitions and
 * appearances are read once per view; replace catalog entries to refresh art.
 */
export function createTilePlacedActorViewRegistry(
  scene: Scene,
  map: TerrainMap,
  definitions: readonly ActorDefinition[],
  appearances: TilePlacedActorAppearanceCatalog,
  {
    preview = false,
    reducedMotion = () => false,
  }: { preview?: boolean; reducedMotion?: () => boolean } = {},
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
  // Keep activity time when terrain or loaded art replaces a view.
  const playing = new Map<
    string,
    { kind: BuildingActivityKind; seconds: number }
  >();
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
    const foundations: ModelInstance[] = [];
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
      const foundation = unitCubeInstance(
        appearances.get(definition.id)?.foundation,
        `tile-placed-actor-${actor.id}-tile-${tile.x}-${tile.z}`,
        body,
        scene,
      );
      foundations.push(foundation);
      const column = foundation.root;
      for (const mesh of column.getChildMeshes()) mesh.material = body;
      column.scaling.set(maxX - minX, roof - low.y, maxZ - minZ);
      column.parent = root;
      column.position.set(
        (minX + maxX) / 2,
        (low.y + roof) / 2,
        (minZ + maxZ) / 2,
      );
    }
    const { worldPosition, facing } = tilePlacedPose(map, actor, definition);
    const appearance = appearances.get(definition.id);
    const details = appearance?.createDetails?.(
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
        mesh.visibility = 0.42;
      }
    }
    const exit =
      preview && definition.production
        ? createProductionExitMarker(scene, map, root, tiles, facing)
        : undefined;
    const top = root.getHierarchyBoundingVectors(true).max.y;
    // The view key includes the construction stage, so each stage rebuilds.
    const disconnected = !preview && disconnectedIds.has(actor.id);
    const constructing = !preview && actor.construction !== undefined;
    const materials = createMaterialCopies(root.name);
    let scaffold: ModelInstance | undefined;
    if (constructing) {
      for (const mesh of root.getChildMeshes()) mesh.visibility = 0.45;
      const foundationMeshes = new Set(
        foundations.flatMap(({ root }) => hierarchyMeshes(root)),
      );
      scaffold = stageBlueprint(
        {
          root,
          parts: root
            .getChildMeshes()
            .filter((mesh) => !foundationMeshes.has(mesh)),
          tiles,
          roof,
          top,
        },
        constructionStage(actor.construction!),
        map,
        materials,
        appearance?.scaffold,
      );
    }
    if (disconnected)
      materials.edit(root.getChildMeshes(), "offline", (dimmed) => {
        if (dimmed instanceof StandardMaterial)
          dimmed.diffuseColor = dimmed.diffuseColor.scale(0.35);
        else dimmed.albedoColor = dimmed.albedoColor.scale(0.35);
        dimmed.emissiveColor = Color3.Black();
      });
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
    const active = !constructing && !disconnected;
    if (!active) playing.delete(actor.id);
    return {
      root,
      top,
      update: ({ construction }: TilePlacedActorState) => {
        if (!progress || !construction) return;
        progress.bar.setFill(
          construction.completedTicks / construction.totalTicks,
          progress.fill,
        );
      },
      animate: (seconds: number, frameSeconds: number) => {
        details?.update(active ? seconds : 0);
        const activity = playing.get(actor.id);
        if (!activity) return;
        const motion = details?.activities?.[activity.kind];
        if (!motion) {
          playing.delete(actor.id);
          return;
        }
        activity.seconds += frameSeconds;
        if (reducedMotion()) activity.seconds = motion.seconds;
        motion.pose(Math.min(activity.seconds, motion.seconds));
        if (activity.seconds >= motion.seconds) playing.delete(actor.id);
      },
      play: (kind: BuildingActivityKind) => {
        const motion = details?.activities?.[kind];
        if (!motion || !active || reducedMotion()) return;
        // A new activity replaces one in progress.
        const previous = playing.get(actor.id);
        const previousMotion = previous && details?.activities?.[previous.kind];
        previousMotion?.pose(previousMotion.seconds);
        motion.pose(0);
        playing.set(actor.id, { kind, seconds: 0 });
      },
      dispose: () => {
        details?.dispose();
        exit?.dispose();
        scaffold?.dispose();
        for (const foundation of foundations) foundation.dispose();
        root.dispose();
        materials.dispose();
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
    }: TilePlacedActorState) => ({
      appearance: appearances.get(definitionId),
      placement: JSON.stringify([definitionId, tilePlacement]),
      key: JSON.stringify([
        definitionId,
        tilePlacement,
        construction && constructionStage(construction),
        disconnectedIds.has(id),
        map.navigationChanges.generation,
        terrainRevisions.get(id),
      ]),
    }),
    sameKey: (left, right) =>
      left.appearance === right.appearance && left.key === right.key,
    onRemove: (id) => playing.delete(id),
    onReplace: (id, previous, next) => {
      if (previous.placement !== next.placement) playing.delete(id);
    },
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
    animate: (seconds, frameSeconds = 0) => {
      if (terrainDirty) update(actors);
      for (const view of roots.values()) view.animate(seconds, frameSeconds);
    },
    play: (actorId, kind) => roots.get(actorId)?.play(kind),
    topHeight: (actorId) => roots.get(actorId)?.top,
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
