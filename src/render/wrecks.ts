import {
  AbstractMesh,
  Color3,
  PBRMaterial,
  StandardMaterial,
  TransformNode,
} from "@babylonjs/core";

import { compareIds } from "../simulation/actor";
import { stableUnit } from "./actor";
import { changeFrozen, setTransformsFrozen } from "./frozen-transforms";
import { hierarchyMeshes, modelPartName, unitCubeInstance } from "./glb-model";

import type { Material, Scene } from "@babylonjs/core";
import type { TerrainMap } from "../map";
import type { Wreck } from "../simulation/combat";
import type { TileCoord } from "../simulation/grid";
import type { ActorAppearance } from "./actor";
import type { ModelAsset } from "./glb-model";
import type { OwnerMaterials } from "./owner-materials";

/** Remains fade out over this many seconds before they clear. */
const FADE_SECONDS = 5;
const fade = (remaining: number) =>
  Math.max(0, Math.min(1, remaining / FADE_SECONDS));
const DEBRIS_HEIGHT = 0.18;
/** Used when the destroyed building's height is unavailable. */
const FALLBACK_COLLAPSE_SCALE = 6;
const COLLAPSE_SECONDS = 0.8;
/** Rubble meshes named `fading-light` go dark over this many seconds. */
const LIGHT_FADE_SECONDS = 1.6;
/** Fallen units clear from view this long after destruction. */
const UNIT_REMAINS_SECONDS = 30;
/** Keeps this many fallen units before fading older ones early. */
const MAX_UNIT_REMAINS = 25;
/** Neutral ash-slate target for muting fallen unit materials. */
const REMAINS_TINT = new Color3(0.14, 0.15, 0.14);
const REMAINS_DARK_GLOW = new Color3(0.12, 0.14, 0.15);

/** Darkens and desaturates a color while preserving owner hue identity. */
function muteColor(color: Color3): Color3 {
  return Color3.Lerp(color, REMAINS_TINT, 0.36).scale(0.7);
}

/**
 * A weathered copy of a live unit material, so remains recede behind active
 * actors. Visors, lamps, and focus glows go dark.
 */
function remainsMaterial(source: Material): Material | undefined {
  const pbr = source instanceof PBRMaterial;
  if (!pbr && !(source instanceof StandardMaterial)) return undefined;
  const { r, g, b } = source.emissiveColor;
  const glowing =
    (pbr ? source.unlit : source.disableLighting) || r + g + b > 0.15;
  const clone = source.clone(`${source.name}-remains`);
  clone.emissiveColor = glowing
    ? Color3.Black()
    : source.emissiveColor.scale(0.1);
  if (clone instanceof PBRMaterial && pbr) {
    clone.unlit = false;
    clone.albedoColor = glowing
      ? REMAINS_DARK_GLOW.clone()
      : muteColor(source.albedoColor);
    clone.roughness = glowing ? 0.88 : Math.max(source.roughness ?? 0.7, 0.86);
    clone.metallic = glowing ? 0.1 : (source.metallic ?? 0) * 0.35;
  } else if (clone instanceof StandardMaterial && !pbr) {
    clone.disableLighting = false;
    clone.diffuseColor = glowing
      ? REMAINS_DARK_GLOW.clone()
      : muteColor(source.diffuseColor);
    clone.specularColor = Color3.Black();
  }
  return clone;
}

export type WreckViewOptions = {
  appearanceFor: (definitionId: string) => ActorAppearance | undefined;
  /** Footprint tiles of building debris. */
  tilesFor: (wreck: Wreck) => readonly TileCoord[];
  rubble?: (wreck: Wreck) => ModelAsset | undefined;
  /** World height of the destroyed building's top, before collapse. */
  topHeightFor?: (wreck: Wreck) => number | undefined;
  /** Shows collapsed debris at once. */
  reducedMotion?: () => boolean;
  /** Keeps fallen units in their owner's colors. */
  ownerMaterials?: OwnerMaterials;
};

/** Fallen units and building rubble; never pickable. */
export function createWreckView(
  scene: Scene,
  map: TerrainMap,
  {
    appearanceFor,
    tilesFor,
    rubble: rubbleAsset,
    topHeightFor,
    reducedMotion = () => false,
    ownerMaterials,
  }: WreckViewOptions,
) {
  const rubble = new StandardMaterial("wreck-rubble", scene);
  rubble.diffuseColor = new Color3(0.2, 0.19, 0.17);
  rubble.specularColor = Color3.Black();
  const mutedMaterials = new Map<Material, Material>();
  const muteMaterial = (source: Material) => {
    let muted = mutedMaterials.get(source);
    if (!muted) {
      muted = remainsMaterial(source) ?? source;
      mutedMaterials.set(source, muted);
    }
    return muted;
  };
  const views = new Map<
    string,
    {
      root: TransformNode;
      appearance: ActorAppearance | undefined;
      seconds: number;
      dispose: () => void;
      meshes: AbstractMesh[];
      lights: AbstractMesh[];
      rubbleModel: ModelAsset | undefined;
      topHeight: number | undefined;
      ground: () => void;
      /** Advances the remains by real seconds; true once at rest. */
      animate?: (seconds: number) => boolean;
      /** Frozen transforms skip per-frame world matrix updates. */
      settled: boolean;
      /** When the remains began fading out early to make room. */
      evictedAt?: number;
    }
  >();
  /** Fallen units already faded from view while the simulation keeps them. */
  const cleared = new Set<string>();

  let terrainDirty = false;
  const terrainObserver = map.onChangedObservable.add(() => {
    terrainDirty = true;
  });
  /** `age` starts a death clip partway, so older remains show its end. */
  const create = (
    wreck: Wreck,
    age: number,
    appearance: ActorAppearance | undefined,
    rubbleModel: ModelAsset | undefined,
    topHeight: number | undefined,
  ) => {
    const root = new TransformNode(`wreck-${wreck.actorId}`, scene);
    let dispose = () => root.dispose();
    let animate: ((seconds: number) => boolean) | undefined;
    const lights: AbstractMesh[] = [];
    const groundUpdates: (() => void)[] = [];
    if (wreck.tilePlacement) {
      const chunks: { dispose: () => void }[] = [];
      const settles: ((seconds: number) => void)[] = [];
      for (const tile of tilesFor(wreck)) {
        const center = map.tileCenter(tile.x, tile.z);
        const seed = stableUnit(`${wreck.actorId}-${tile.x}-${tile.z}`);
        const chunk = unitCubeInstance(
          rubbleModel,
          `wreck-${wreck.actorId}-${tile.x}-${tile.z}`,
          rubble,
          scene,
        );
        chunks.push(chunk);
        lights.push(
          ...chunk.root
            .getChildMeshes()
            .filter((mesh) =>
              modelPartName(chunk.root, mesh).includes("fading-light"),
            ),
        );
        chunk.root.scaling.set(
          map.tileSize * (0.7 + seed * 0.3),
          DEBRIS_HEIGHT * (0.6 + seed),
          map.tileSize * (0.95 - seed * 0.3),
        );
        chunk.root.parent = root;
        chunk.root.rotation.y = seed * Math.PI;
        chunk.root.position.set(center.x, 0, center.z);
        const settled = chunk.root.scaling.y;
        const extent = chunk.root.getHierarchyBoundingVectors(true);
        // The bottom's height per unit of vertical scale.
        const bottom = extent.min.y / settled;
        const fullHeight = extent.max.y / settled - bottom;
        const ground = () => {
          chunk.root.position.y =
            map.heightAtWorldPosition(center.x, center.z) -
            bottom * chunk.root.scaling.y;
        };
        settles.push((seconds) => {
          const remaining = Math.max(0, 1 - seconds / COLLAPSE_SECONDS);
          const standing =
            topHeight === undefined || !(fullHeight > 0)
              ? settled * FALLBACK_COLLAPSE_SCALE
              : Math.max(
                  settled,
                  (topHeight - map.heightAtWorldPosition(center.x, center.z)) /
                    fullHeight,
                );
          chunk.root.scaling.y =
            settled + (standing - settled) * remaining ** 2;
          ground();
        });
        groundUpdates.push(ground);
      }
      animate = (seconds) => {
        for (const settle of settles) settle(seconds);
        return seconds >= COLLAPSE_SECONDS;
      };
      animate(age);
      dispose = () => {
        for (const chunk of chunks) chunk.dispose();
        root.dispose();
      };
    } else {
      if (appearance) {
        const instance = appearance.instantiate(
          `wreck-${wreck.actorId}`,
          stableUnit(wreck.actorId),
        );
        const instanceMeshes = hierarchyMeshes(instance.root);
        ownerMaterials?.apply(instanceMeshes, wreck.owner);
        for (const mesh of instanceMeshes) {
          if (mesh.material) mesh.material = muteMaterial(mesh.material);
        }
        const { x, z } = wreck.worldPosition;
        root.position.set(x, map.heightAtWorldPosition(x, z), z);
        groundUpdates.push(() => {
          root.position.y = map.heightAtWorldPosition(x, z);
        });
        root.rotation.y = wreck.facing;
        const { die } = instance;
        if (die) {
          instance.root.parent = root;
          die(age);
          animate = die;
        } else {
          // Without a death clip, remains lie on their side.
          const tilt = new TransformNode(`wreck-${wreck.actorId}-tilt`, scene);
          tilt.parent = root;
          tilt.rotation.z = Math.PI / 2;
          tilt.position.y = appearance.bounds.radius * 0.4;
          instance.root.parent = tilt;
          instance.freeze?.();
          animate = () => true;
        }
        dispose = () => {
          instance.dispose();
          root.dispose();
        };
      }
    }
    const meshes = root.getChildMeshes();
    for (const mesh of meshes) mesh.isPickable = false;
    return {
      root,
      appearance,
      seconds: age,
      dispose,
      meshes,
      lights,
      animate,
      rubbleModel,
      topHeight,
      settled: false,
      ground: () => {
        for (const update of groundUpdates) update();
      },
    };
  };
  /** The visible fallen units that keep showing, newest first. */
  const shownUnits = (
    wrecks: readonly Wreck[],
    age: (wreck: Wreck) => number,
    life: number,
    visible: ReadonlySet<string>,
  ) =>
    new Set(
      wrecks
        .filter(
          (wreck) =>
            !wreck.tilePlacement &&
            visible.has(wreck.actorId) &&
            views.get(wreck.actorId)?.evictedAt === undefined &&
            age(wreck) < life,
        )
        .sort((a, b) => b.tick - a.tick || compareIds(a.actorId, b.actorId))
        .slice(0, MAX_UNIT_REMAINS)
        .map(({ actorId }) => actorId),
    );
  return {
    /**
     * `age` is seconds since destruction, `lifeSeconds` how long remains
     * stay, and `frameSeconds` real time since the last update. Hidden
     * remains are not drawn.
     */
    update: (
      wrecks: readonly Wreck[],
      age: (wreck: Wreck) => number,
      lifeSeconds: number,
      visible: (wreck: Wreck) => boolean,
      frameSeconds: number,
    ) => {
      const present = new Set(wrecks.map(({ actorId }) => actorId));
      for (const [id, view] of views) {
        if (present.has(id)) continue;
        view.dispose();
        views.delete(id);
      }
      for (const id of cleared) if (!present.has(id)) cleared.delete(id);
      const unitLife = Math.min(lifeSeconds, UNIT_REMAINS_SECONDS);
      const visibleIds = new Set<string>();
      for (const wreck of wrecks)
        if (!cleared.has(wreck.actorId) && visible(wreck))
          visibleIds.add(wreck.actorId);
      const shown = shownUnits(wrecks, age, unitLife, visibleIds);
      const reduced = reducedMotion();
      for (const wreck of wrecks) {
        if (cleared.has(wreck.actorId)) continue;
        let view = views.get(wreck.actorId);
        const unit = !wreck.tilePlacement;
        const wreckAge = age(wreck);
        const life = unit ? unitLife : lifeSeconds;
        const shows = visibleIds.has(wreck.actorId);
        // Remains past their time, or crowded out before they were drawn,
        // never appear, even once a slot frees.
        if (
          !view &&
          unit &&
          (wreckAge >= life || (shows && !shown.has(wreck.actorId)))
        ) {
          cleared.add(wreck.actorId);
          continue;
        }
        if (!view && unit && !shows) continue;
        // Once settled, a preference change leaves rubble dark and in place.
        const minimum = wreck.tilePlacement && reduced ? LIGHT_FADE_SECONDS : 0;
        const appearance = unit ? appearanceFor(wreck.definitionId) : undefined;
        const rubbleModel = wreck.tilePlacement
          ? rubbleAsset?.(wreck)
          : undefined;
        if (
          !view ||
          view.appearance !== appearance ||
          view.rubbleModel !== rubbleModel
        ) {
          const seconds = Math.max(wreckAge, view?.seconds ?? 0, minimum);
          const topHeight = view?.topHeight ?? topHeightFor?.(wreck);
          const evictedAt = view?.evictedAt;
          view?.dispose();
          view = create(wreck, seconds, appearance, rubbleModel, topHeight);
          view.evictedAt = evictedAt;
          views.set(wreck.actorId, view);
        } else {
          view.seconds = Math.max(view.seconds + frameSeconds, minimum);
          if (!view.settled && view.animate?.(view.seconds)) {
            view.settled = true;
            setTransformsFrozen(view.root, true);
          }
          if (terrainDirty && view.settled)
            changeFrozen(view.root, view.ground);
          else if (terrainDirty) view.ground();
        }
        if (
          unit &&
          shows &&
          view.evictedAt === undefined &&
          !shown.has(wreck.actorId)
        )
          view.evictedAt = view.seconds;
        const opacity = Math.min(
          fade(life - wreckAge),
          view.evictedAt === undefined
            ? 1
            : fade(FADE_SECONDS - (view.seconds - view.evictedAt)),
        );
        if (unit && opacity <= 0) {
          view.dispose();
          views.delete(wreck.actorId);
          cleared.add(wreck.actorId);
          continue;
        }
        view.root.setEnabled(shows);
        for (const mesh of view.meshes) mesh.visibility = opacity;
        const light = Math.max(0, 1 - view.seconds / LIGHT_FADE_SECONDS);
        for (const mesh of view.lights) mesh.visibility = opacity * light;
      }
      terrainDirty = false;
    },
    dispose: () => {
      map.onChangedObservable.remove(terrainObserver);
      for (const view of views.values()) view.dispose();
      views.clear();
      for (const [source, muted] of mutedMaterials)
        if (muted !== source) muted.dispose();
      mutedMaterials.clear();
      rubble.dispose();
    },
  };
}
