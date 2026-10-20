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
import type { Rgb, ActorTrigger } from "../content/presentation";

// Keep the actor visibly above the terrain's thin visual-layer offsets.
const GROUND_CLEARANCE = 0.04;
const SELECTION_RING_THICKNESS = 0.06;
const SELECTION_RING_TESSELLATION = 48;
/** Gap between an actor's bounds and its selection ring. */
const SELECTION_RING_MARGIN = 0.15;
const PICK_TESSELLATION = 12;
/** Hostile inspection uses a broken ring, so shape as well as color differs. */
const HOSTILE_MARKER_SEGMENTS = 8;
export const ACTOR_PICK_KIND = "actor";
/** Shared by the minimap and fallback model when an actor names no color. */
export const DEFAULT_ACTOR_COLOR: Rgb = [0.871, 0.345, 0.122];

/**
 * Committed simulation state an actor's appearance shows while it lasts.
 * Absent flags are false.
 */
export type ActorAnimationState = {
  /** Gathering, as a Harvester at a Materials patch. */
  working?: boolean;
  /** Holding a detected target within weapon range. */
  aiming?: boolean;
  /** Pursuing, as a wolf chasing an intruder. */
  running?: boolean;
};

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
  minimapColor?: Rgb;
  /** Releases what instances share, such as templates and materials. */
  dispose: () => void;
};

export type ActorInstance = {
  /** Its origin is the actor's ground point and it faces +Z. */
  root: TransformNode;
  /** Present when the appearance animates. */
  animate?: (motion: Readonly<ActorMotion>) => void;
  setAnimationState?: (state: Readonly<ActorAnimationState>) => void;
  /** Plays the actor's response to a trigger. */
  play?: (trigger: ActorTrigger) => void;
  /** Poses remains `seconds` after destruction; replaces animate. */
  die?: (seconds: number) => void;
  /** Stops any playing clips, as for remains. */
  freeze?: () => void;
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
  /** `seconds` is real time since the previous update. */
  update: (
    pose: ActorPose,
    seconds?: number,
    state?: Readonly<ActorAnimationState>,
  ) => void;
  play: (trigger: ActorTrigger) => void;
  dispose: () => void;
};

/**
 * Renders one actor from simulation-owned state with an instance of its
 * appearance. Visual meshes and an invisible cylinder can both be picked.
 * Hostile actors use a segmented selection marker.
 */
export function createActorRenderer(
  scene: Scene,
  map: TerrainMap,
  initialState: ActorRenderState,
  appearance: ActorAppearance,
  selectionMaterial: Material,
  hostile = false,
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

  let ring: TransformNode | undefined;
  const setSelected = (selected: boolean) => {
    if (selected && !ring) {
      const ringRadius = radius + SELECTION_RING_MARGIN;
      if (hostile) {
        ring = new TransformNode(`actor-${id}-selection`, scene);
        const arc = (Math.PI * ringRadius) / HOSTILE_MARKER_SEGMENTS;
        for (let index = 0; index < HOSTILE_MARKER_SEGMENTS; index += 1) {
          const angle = (index * Math.PI * 2) / HOSTILE_MARKER_SEGMENTS;
          const segment = MeshBuilder.CreateBox(
            `actor-${id}-selection-${index}`,
            {
              width: arc,
              height: SELECTION_RING_THICKNESS,
              depth: SELECTION_RING_THICKNESS,
            },
            scene,
          );
          segment.parent = ring;
          segment.position.set(
            Math.cos(angle) * ringRadius,
            0,
            Math.sin(angle) * ringRadius,
          );
          segment.rotation.y = Math.PI / 2 - angle;
          segment.material = selectionMaterial;
          segment.isPickable = false;
        }
      } else {
        const torus = MeshBuilder.CreateTorus(
          `actor-${id}-selection`,
          {
            diameter: ringRadius * 2,
            thickness: SELECTION_RING_THICKNESS,
            tessellation: SELECTION_RING_TESSELLATION,
          },
          scene,
        );
        torus.material = selectionMaterial;
        torus.isPickable = false;
        ring = torus;
      }
      ring.parent = root;
    }
    ring?.setEnabled(selected);
  };

  const motion: ActorMotion = { distance: 0, turn: 0, seconds: 0 };
  let last: ActorPose | undefined;
  const place = ({ worldPosition, facing }: ActorPose) => {
    root.position.x = worldPosition.x;
    root.position.z = worldPosition.z;
    root.position.y =
      map.heightAtWorldPosition(worldPosition.x, worldPosition.z) +
      GROUND_CLEARANCE;
    root.rotation.y = facing;
  };
  const update = (
    pose: ActorPose,
    seconds = 0,
    state?: Readonly<ActorAnimationState>,
  ) => {
    const { worldPosition, facing } = pose;
    if (state) instance.setAnimationState?.(state);
    if (instance.animate) {
      if (last) {
        motion.distance = Math.hypot(
          worldPosition.x - last.worldPosition.x,
          worldPosition.z - last.worldPosition.z,
        );
        motion.turn = shortestTurn(last.facing, facing);
        motion.seconds = seconds;
        instance.animate(motion);
        last.worldPosition.x = worldPosition.x;
        last.worldPosition.z = worldPosition.z;
        last.facing = facing;
      } else {
        // The first drawn pose may be interpolated or use newly loaded art.
        instance.animate(motion);
        last = { worldPosition: { ...worldPosition }, facing };
      }
    }
    place(pose);
  };

  place(initialState);
  return {
    actorId: id,
    selectionPoint: () => root.position.add(new Vector3(0, height / 2, 0)),
    setSelected,
    update,
    play: (trigger) => instance.play?.(trigger),
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
  minimapColor?: Rgb,
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
