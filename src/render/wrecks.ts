import {
  AbstractMesh,
  Color3,
  MeshBuilder,
  StandardMaterial,
  TransformNode,
} from "@babylonjs/core";
import { stableUnit } from "./actor";

import type { Scene } from "@babylonjs/core";
import type { TerrainMap } from "../map";
import type { Wreck } from "../simulation/combat";
import type { TileCoord } from "../simulation/grid";
import type { ActorAppearance } from "./actor";

/** Remains fade out over this many seconds before they clear. */
const FADE_SECONDS = 5;
const DEBRIS_HEIGHT = 0.18;

export type WreckViewOptions = {
  appearanceFor: (definitionId: string) => ActorAppearance | undefined;
  /** Footprint tiles of building debris. */
  tilesFor: (wreck: Wreck) => readonly TileCoord[];
};

/** Fallen units and building rubble; never pickable. */
export function createWreckView(
  scene: Scene,
  map: TerrainMap,
  { appearanceFor, tilesFor }: WreckViewOptions,
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
      /** Advances the death clip by real seconds. */
      animate?: (seconds: number) => void;
    }
  >();
  /** `age` starts a death clip partway, so older remains show its end. */
  const create = (
    wreck: Wreck,
    age: number,
    appearance: ActorAppearance | undefined,
  ) => {
    const root = new TransformNode(`wreck-${wreck.actorId}`, scene);
    let dispose = () => root.dispose();
    let animate: ((seconds: number) => void) | undefined;
    if (wreck.tilePlacement) {
      for (const tile of tilesFor(wreck)) {
        const center = map.tileCenter(tile.x, tile.z);
        const seed = stableUnit(`${wreck.actorId}-${tile.x}-${tile.z}`);
        const chunk = MeshBuilder.CreateBox(
          `wreck-${wreck.actorId}-${tile.x}-${tile.z}`,
          {
            width: map.tileSize * (0.7 + seed * 0.3),
            height: DEBRIS_HEIGHT * (0.6 + seed),
            depth: map.tileSize * (0.95 - seed * 0.3),
          },
          scene,
        );
        chunk.parent = root;
        chunk.material = rubble;
        chunk.rotation.y = seed * Math.PI;
        chunk.position.set(
          center.x,
          map.heightAtWorldPosition(center.x, center.z) + DEBRIS_HEIGHT / 2,
          center.z,
        );
      }
    } else {
      if (appearance) {
        const instance = appearance.instantiate(
          `wreck-${wreck.actorId}`,
          stableUnit(wreck.actorId),
        );
        const { x, z } = wreck.worldPosition;
        root.position.set(x, map.heightAtWorldPosition(x, z), z);
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
    return { root, appearance, seconds: age, dispose, meshes, animate };
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
        if (!view || view.appearance !== appearance) {
          const seconds = Math.max(age(wreck), view?.seconds ?? 0);
          view?.dispose();
          view = create(wreck, seconds, appearance);
          views.set(wreck.actorId, view);
        } else {
          view.seconds += frameSeconds;
          view.animate?.(view.seconds);
        }
        view.root.setEnabled(visible(wreck));
        const opacity = Math.min(1, (lifetime - age(wreck)) / FADE_SECONDS);
        for (const mesh of view.meshes) mesh.visibility = Math.max(opacity, 0);
      }
    },
    dispose: () => {
      for (const view of views.values()) view.dispose();
      views.clear();
      rubble.dispose();
    },
  };
}
