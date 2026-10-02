import {
  AbstractMesh,
  MeshBuilder,
  TransformNode,
  Vector3,
} from "@babylonjs/core";

import { shortestTurn } from "../simulation/world";

import type { Material, Scene } from "@babylonjs/core";
import type { TerrainMap } from "../map";
import type { ActorRenderState } from "../simulation/actor";
import type { ActorMotion } from "./actor-gait";
import type { Rgb } from "./color";

// Keep the actor visibly above the terrain's thin visual-layer offsets.
const GROUND_CLEARANCE = 0.04;
const SELECTION_RING_THICKNESS = 0.06;
const SELECTION_RING_TESSELLATION = 48;
/** Gap between an actor's bounds and its selection ring. */
const SELECTION_RING_MARGIN = 0.15;
const PICK_TESSELLATION = 12;
/** Caps the frame time animation sees, so a stalled frame cannot overshoot. */
const MAX_ANIMATION_SECONDS = 0.1;
export const ACTOR_PICK_KIND = "actor";
/** Shared by the minimap and fallback model when an actor names no color. */
export const DEFAULT_ACTOR_COLOR: Rgb = [0.871, 0.345, 0.122];

/** How one kind of actor looks. */
export type ActorAppearance = {
  /**
   * Creates the nodes one actor draws with. `seed` is a stable value from 0
   * to 1 for render-only variation, such as clip phase.
   */
  instantiate: (name: string, seed: number) => ActorInstance;
  /** A cylinder on the ground point that picking and selection use. */
  bounds: { radius: number; height: number };
  /** Minimap marker color, in 0-1 channels. */
  minimapColor?: [number, number, number];
  /** Releases what instances share, such as templates and materials. */
  dispose: () => void;
};

export type ActorInstance = {
  /** Its origin is the actor's ground point and it faces +Z. */
  root: TransformNode;
  /** Present when the appearance animates. */
  animate?: (motion: Readonly<ActorMotion>) => void;
  dispose: () => void;
};

/** Where and which way an actor is drawn, possibly between two ticks. */
export type ActorPose = {
  worldPosition: { x: number; z: number };
  facing: number;
};

export type ActorRenderer = {
  actorId: string;
  selectionPoint: () => Vector3;
  setSelected: (selected: boolean) => void;
  update: (pose: ActorPose) => void;
  dispose: () => void;
};

/**
 * Renders one actor from simulation-owned state with an instance of its
 * appearance. Visual meshes and an invisible cylinder can both be picked.
 */
export function createActorRenderer(
  scene: Scene,
  map: TerrainMap,
  initialState: ActorRenderState,
  appearance: ActorAppearance,
  selectionMaterial: Material,
): ActorRenderer {
  const { id } = initialState;
  const { radius, height } = appearance.bounds;
  const root = new TransformNode(`actor-${id}-root`, scene);
  const instance = appearance.instantiate(`actor-${id}`, stableUnit(id));
  instance.root.parent = root;
  for (const node of [instance.root, ...instance.root.getChildMeshes()]) {
    if (node instanceof AbstractMesh && node.isVisible) {
      node.isPickable = true;
      node.metadata = {
        ...node.metadata,
        pickKind: ACTOR_PICK_KIND,
        actorId: id,
      };
    }
  }
  // The cylinder also covers gaps in a model. The pick predicate sees it
  // despite its invisibility.
  const pick = MeshBuilder.CreateCylinder(
    `actor-${id}-pick`,
    { diameter: radius * 2, height, tessellation: PICK_TESSELLATION },
    scene,
  );
  pick.parent = root;
  pick.position.y = height / 2;
  pick.isVisible = false;
  pick.metadata = { pickKind: ACTOR_PICK_KIND, actorId: id };

  let ring: AbstractMesh | undefined;
  const setSelected = (selected: boolean) => {
    if (selected && !ring) {
      ring = MeshBuilder.CreateTorus(
        `actor-${id}-selection`,
        {
          diameter: (radius + SELECTION_RING_MARGIN) * 2,
          thickness: SELECTION_RING_THICKNESS,
          tessellation: SELECTION_RING_TESSELLATION,
        },
        scene,
      );
      ring.parent = root;
      ring.material = selectionMaterial;
      ring.isPickable = false;
    }
    ring?.setEnabled(selected);
  };

  const motion: ActorMotion = { distance: 0, turn: 0, seconds: 0 };
  let last: ActorPose | undefined;
  const update = ({ worldPosition, facing }: ActorPose) => {
    if (instance.animate) {
      if (last) {
        motion.distance = Math.hypot(
          worldPosition.x - last.worldPosition.x,
          worldPosition.z - last.worldPosition.z,
        );
        motion.turn = shortestTurn(last.facing, facing);
        motion.seconds = Math.min(
          scene.getEngine().getDeltaTime() / 1000,
          MAX_ANIMATION_SECONDS,
        );
        instance.animate(motion);
        last.worldPosition.x = worldPosition.x;
        last.worldPosition.z = worldPosition.z;
        last.facing = facing;
      } else {
        last = { worldPosition: { ...worldPosition }, facing };
      }
    }
    root.position.x = worldPosition.x;
    root.position.z = worldPosition.z;
    root.position.y =
      map.heightAtWorldPosition(worldPosition.x, worldPosition.z) +
      GROUND_CLEARANCE;
    root.rotation.y = facing;
  };

  update(initialState);
  return {
    actorId: id,
    selectionPoint: () => root.position.add(new Vector3(0, height / 2, 0)),
    setSelected,
    update,
    dispose: () => {
      instance.dispose();
      root.dispose();
    },
  };
}

/**
 * An appearance that clones a static mesh hierarchy. Its origin is the
 * actor's ground point and it faces +Z. The template stays hidden, and
 * `dispose` releases it with its materials.
 */
export function createMeshAppearance(
  template: TransformNode,
  bounds: ActorAppearance["bounds"],
  minimapColor?: [number, number, number],
): ActorAppearance {
  template.setEnabled(false);
  return {
    bounds,
    minimapColor,
    instantiate: (name) => {
      const root = template.instantiateHierarchy(
        null,
        { doNotInstantiate: true },
        (source, clone) => {
          clone.name = source === template ? name : `${name}-${source.name}`;
          clone.setEnabled(true);
        },
      )!;
      // Clones share the template's materials, so only the nodes go.
      return { root, dispose: () => root.dispose(false, false) };
    },
    dispose: () => template.dispose(false, true),
  };
}

/** The actor a picked mesh presents, if it is an actor mesh. */
export function actorIdForPickMesh(
  mesh: AbstractMesh | null,
): string | undefined {
  return mesh?.metadata?.pickKind === ACTOR_PICK_KIND
    ? mesh.metadata.actorId
    : undefined;
}

/** Hashes an ID to a stable value from 0 to 1. */
export function stableUnit(id: string): number {
  // FNV-1a.
  let hash = 0x811c9dc5;
  for (let index = 0; index < id.length; index++) {
    hash = Math.imul(hash ^ id.charCodeAt(index), 0x01000193);
  }
  return (hash >>> 0) / 2 ** 32;
}
