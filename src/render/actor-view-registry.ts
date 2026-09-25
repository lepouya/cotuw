import { Color3, MeshBuilder, StandardMaterial } from "@babylonjs/core";

import {
  actorIdForPickMesh,
  createActorRenderer,
  DEFAULT_ACTOR_COLOR,
} from "./actor";

import type { AbstractMesh, Scene } from "@babylonjs/core";
import type { TerrainMap } from "../map";
import type { ActorRenderState } from "../simulation/actor";
import type { ActorAppearance, ActorPose, ActorRenderer } from "./actor";

const SELECTION_COLOR = new Color3(1, 0.86, 0.44);
/** Edge length of the stand-in cube for actors without an appearance. */
const FALLBACK_ACTOR_SIZE = 0.6;

/** Appearances keyed by actor definition ID. */
export type ActorAppearanceCatalog = ReadonlyMap<string, ActorAppearance>;

export type ActorViewRegistry = {
  actorIdForMesh: (mesh: AbstractMesh | null) => string | undefined;
  /** Records poses to interpolate from. Call it right before each tick. */
  capturePreviousPoses: (actors: readonly ActorRenderState[]) => void;
  dispose: () => void;
  setSelectedActor: (actorId: string | undefined) => void;
  /**
   * Creates and removes views to match `actors`, then draws each one
   * `tickProgress` of the way from its previous pose to its current one.
   */
  update: (actors: readonly ActorRenderState[], tickProgress: number) => void;
};

/**
 * Owns actor presentation and maps renderer picks back to stable actor IDs.
 * Hides each appearance's template mesh; the caller still owns it.
 */
export function createActorViewRegistry(
  scene: Scene,
  map: TerrainMap,
  appearances: ActorAppearanceCatalog,
): ActorViewRegistry {
  for (const { mesh } of appearances.values()) {
    mesh.setEnabled(false);
  }
  const selectionMaterial = new StandardMaterial(
    "actor-selection-material",
    scene,
  );
  selectionMaterial.emissiveColor = SELECTION_COLOR;
  selectionMaterial.disableLighting = true;
  let fallback: ActorAppearance | undefined;
  // A visible stand-in beats a crash in the render loop for unknown kinds.
  const appearanceFor = (definitionId: string) =>
    appearances.get(definitionId) ??
    (fallback ??= createFallbackAppearance(scene));

  const renderers = new Map<
    string,
    { renderer: ActorRenderer; definitionId: string }
  >();
  const previousPoses = new Map<string, ActorPose>();
  const pose: ActorPose = { worldPosition: { x: 0, z: 0 }, facing: 0 };
  let selectedActorId: string | undefined;

  const sync = (actors: readonly ActorRenderState[]) => {
    const present = new Set<string>();
    for (const actor of actors) {
      present.add(actor.id);
      const view = renderers.get(actor.id);
      // An ID reused for another kind of actor is a new actor to draw.
      if (view && view.definitionId !== actor.definitionId) {
        remove(actor.id);
      }
      if (!renderers.has(actor.id)) {
        const renderer = createActorRenderer(
          scene,
          map,
          actor,
          appearanceFor(actor.definitionId),
          selectionMaterial,
        );
        renderer.setSelected(actor.id === selectedActorId);
        renderers.set(actor.id, {
          renderer,
          definitionId: actor.definitionId,
        });
      }
    }
    for (const id of renderers.keys()) {
      if (!present.has(id)) {
        remove(id);
      }
    }
  };
  const remove = (id: string) => {
    renderers.get(id)?.renderer.dispose();
    renderers.delete(id);
    previousPoses.delete(id);
  };

  return {
    actorIdForMesh: (mesh) => {
      const actorId = actorIdForPickMesh(mesh);
      return actorId !== undefined && renderers.has(actorId)
        ? actorId
        : undefined;
    },
    capturePreviousPoses: (actors) => {
      for (const { id, worldPosition, facing } of actors) {
        const previous = previousPoses.get(id);
        if (previous) {
          previous.worldPosition.x = worldPosition.x;
          previous.worldPosition.z = worldPosition.z;
          previous.facing = facing;
        } else {
          previousPoses.set(id, {
            worldPosition: { ...worldPosition },
            facing,
          });
        }
      }
    },
    dispose: () => {
      for (const { renderer } of renderers.values()) {
        renderer.dispose();
      }
      renderers.clear();
      previousPoses.clear();
      selectionMaterial.dispose();
      fallback?.mesh.dispose(false, true);
    },
    setSelectedActor: (actorId) => {
      selectedActorId = actorId;
      for (const [id, { renderer }] of renderers) {
        renderer.setSelected(id === actorId);
      }
    },
    update: (actors, tickProgress) => {
      sync(actors);
      for (const actor of actors) {
        interpolatePose(previousPoses.get(actor.id), actor, tickProgress, pose);
        renderers.get(actor.id)!.renderer.update(pose);
      }
    },
  };
}

function createFallbackAppearance(scene: Scene): ActorAppearance {
  const mesh = MeshBuilder.CreateBox(
    "actor-fallback",
    { size: FALLBACK_ACTOR_SIZE },
    scene,
  );
  mesh.position.y = FALLBACK_ACTOR_SIZE / 2;
  const material = new StandardMaterial("actor-fallback-material", scene);
  material.diffuseColor = new Color3(...DEFAULT_ACTOR_COLOR);
  mesh.material = material;
  mesh.setEnabled(false);
  return { mesh };
}

/**
 * Writes the pose `progress` of the way from `previous` to `current` into
 * `into`, turning the short way round. Without a previous pose, it copies
 * `current`.
 */
export function interpolatePose(
  previous: ActorPose | undefined,
  current: ActorPose,
  progress: number,
  into: ActorPose,
): ActorPose {
  if (!previous) {
    into.worldPosition.x = current.worldPosition.x;
    into.worldPosition.z = current.worldPosition.z;
    into.facing = current.facing;
    return into;
  }

  const { x, z } = previous.worldPosition;
  into.worldPosition.x = x + (current.worldPosition.x - x) * progress;
  into.worldPosition.z = z + (current.worldPosition.z - z) * progress;
  const turn = current.facing - previous.facing;
  const shortestTurn = turn - Math.PI * 2 * Math.round(turn / (Math.PI * 2));
  into.facing = previous.facing + shortestTurn * progress;
  return into;
}
