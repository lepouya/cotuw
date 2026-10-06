import {
  AbstractMesh,
  Color3,
  StandardMaterial,
  TransformNode,
} from "@babylonjs/core";
import { stableUnit } from "./actor";
import { unitCubeInstance } from "./glb-model";

import type { Scene } from "@babylonjs/core";
import type { TerrainMap } from "../map";
import type { Wreck } from "../simulation/combat";
import type { TileCoord } from "../simulation/grid";
import type { ActorAppearance } from "./actor";
import type { ModelAsset } from "./glb-model";

/** Remains fade out over this many seconds before they clear. */
const FADE_SECONDS = 5;
const DEBRIS_HEIGHT = 0.18;

export type WreckViewOptions = {
  appearanceFor: (definitionId: string) => ActorAppearance | undefined;
  /** Footprint tiles of building debris. */
  tilesFor: (wreck: Wreck) => readonly TileCoord[];
  rubble?: () => ModelAsset | undefined;
};

/** Fallen units and building rubble; never pickable. */
export function createWreckView(
  scene: Scene,
  map: TerrainMap,
  { appearanceFor, tilesFor, rubble: rubbleAsset }: WreckViewOptions,
) {
  const rubble = new StandardMaterial("wreck-rubble", scene);
  rubble.diffuseColor = new Color3(0.2, 0.19, 0.17);
  rubble.specularColor = Color3.Black();
  const views = new Map<
    string,
    {
      root: TransformNode;
      appearance: ActorAppearance | undefined;
      seconds: number;
      dispose: () => void;
      meshes: AbstractMesh[];
      rubbleModel: ModelAsset | undefined;
      ground: () => void;
      /** Advances the death clip by real seconds. */
      animate?: (seconds: number) => void;
    }
  >();
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
  ) => {
    const root = new TransformNode(`wreck-${wreck.actorId}`, scene);
    let dispose = () => root.dispose();
    let animate: ((seconds: number) => void) | undefined;
    const groundUpdates: (() => void)[] = [];
    if (wreck.tilePlacement) {
      const chunks: { dispose: () => void }[] = [];
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
        chunk.root.scaling.set(
          map.tileSize * (0.7 + seed * 0.3),
          DEBRIS_HEIGHT * (0.6 + seed),
          map.tileSize * (0.95 - seed * 0.3),
        );
        chunk.root.parent = root;
        chunk.root.rotation.y = seed * Math.PI;
        chunk.root.position.set(center.x, 0, center.z);
        const { min } = chunk.root.getHierarchyBoundingVectors(true);
        const ground = () => {
          chunk.root.position.y =
            map.heightAtWorldPosition(center.x, center.z) - min.y;
        };
        ground();
        groundUpdates.push(ground);
      }
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
      animate,
      rubbleModel,
      ground: () => {
        for (const update of groundUpdates) update();
      },
    };
  };
  return {
    /**
     * `age` is seconds since destruction and `frameSeconds` real time since
     * the last update. Hidden remains are not drawn.
     */
    update: (
      wrecks: readonly Wreck[],
      age: (wreck: Wreck) => number,
      lifetime: number,
      visible: (wreck: Wreck) => boolean,
      frameSeconds: number,
    ) => {
      const present = new Set(wrecks.map(({ actorId }) => actorId));
      for (const [id, view] of views) {
        if (present.has(id)) continue;
        view.dispose();
        views.delete(id);
      }
      for (const wreck of wrecks) {
        let view = views.get(wreck.actorId);
        const appearance = wreck.tilePlacement
          ? undefined
          : appearanceFor(wreck.definitionId);
        const rubbleModel = wreck.tilePlacement ? rubbleAsset?.() : undefined;
        if (
          !view ||
          view.appearance !== appearance ||
          view.rubbleModel !== rubbleModel
        ) {
          const seconds = Math.max(age(wreck), view?.seconds ?? 0);
          view?.dispose();
          view = create(wreck, seconds, appearance, rubbleModel);
          views.set(wreck.actorId, view);
        } else {
          view.seconds += frameSeconds;
          view.animate?.(view.seconds);
          if (terrainDirty) view.ground();
        }
        view.root.setEnabled(visible(wreck));
        const opacity = Math.min(1, (lifetime - age(wreck)) / FADE_SECONDS);
        for (const mesh of view.meshes) mesh.visibility = Math.max(opacity, 0);
      }
      terrainDirty = false;
    },
    dispose: () => {
      map.onChangedObservable.remove(terrainObserver);
      for (const view of views.values()) view.dispose();
      views.clear();
      rubble.dispose();
    },
  };
}
