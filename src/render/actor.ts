import { AbstractMesh, MeshBuilder, TransformNode } from "@babylonjs/core";

import type { Material, Scene } from "@babylonjs/core";
import type { TerrainMap } from "../map";
import type { ActorRenderState } from "../simulation/actor";

// Keep the actor visibly above the terrain's thin visual-layer offsets.
const GROUND_CLEARANCE = 0.04;
const SELECTION_RING_THICKNESS = 0.06;
const SELECTION_RING_TESSELLATION = 48;
/** Gap between an actor's footprint and its selection ring. */
const SELECTION_RING_MARGIN = 0.15;
export const ACTOR_PICK_KIND = "actor";
/** Shared by the minimap and fallback model when an actor names no color. */
export const DEFAULT_ACTOR_COLOR: [number, number, number] = [
  0.871, 0.345, 0.122,
];

/** How one kind of actor looks. */
export type ActorAppearance = {
  /**
   * A mesh or mesh hierarchy that each actor of this kind clones. Its origin
   * is the actor's ground point and it faces +Z. It stays hidden itself.
   */
  mesh: TransformNode;
  /** Minimap marker color, in 0-1 channels. */
  minimapColor?: [number, number, number];
};

/** Where and which way an actor is drawn, possibly between two ticks. */
export type ActorPose = {
  worldPosition: { x: number; z: number };
  facing: number;
};

export type ActorRenderer = {
  actorId: string;
  setSelected: (selected: boolean) => void;
  update: (pose: ActorPose) => void;
  dispose: () => void;
};

/**
 * Renders one actor from simulation-owned state by cloning its appearance's
 * mesh. Clones share the template's materials, so selection shows as a ring.
 */
export function createActorRenderer(
  scene: Scene,
  map: TerrainMap,
  initialState: ActorRenderState,
  { mesh: template }: ActorAppearance,
  selectionMaterial: Material,
): ActorRenderer {
  const { id } = initialState;
  const root = new TransformNode(`actor-${id}-root`, scene);
  template.instantiateHierarchy(
    root,
    { doNotInstantiate: true },
    (source, clone) => {
      clone.name =
        source === template ? `actor-${id}` : `actor-${id}-${source.name}`;
      clone.setEnabled(true);
      if (clone instanceof AbstractMesh) {
        clone.isPickable = true;
        clone.metadata = { pickKind: ACTOR_PICK_KIND, actorId: id };
      }
    },
  );
  // The root is still at the origin, so world bounds are the model's own.
  const { min, max } = root.getHierarchyBoundingVectors(true);
  const footprintRadius = Math.max(-min.x, max.x, -min.z, max.z, 0);

  let ring: AbstractMesh | undefined;
  const setSelected = (selected: boolean) => {
    if (selected && !ring) {
      ring = MeshBuilder.CreateTorus(
        `actor-${id}-selection`,
        {
          diameter: (footprintRadius + SELECTION_RING_MARGIN) * 2,
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
  const update = ({ worldPosition, facing }: ActorPose) => {
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
    setSelected,
    update,
    // Materials belong to the template, so only the clones go.
    dispose: () => root.dispose(false, false),
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
