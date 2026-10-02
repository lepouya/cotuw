import { Color3, MeshBuilder, StandardMaterial } from "@babylonjs/core";

import { shortestTurn } from "../simulation/world";
import { createViewRegistry } from "./view-registry";
import {
  actorIdForPickMesh,
  createActorRenderer,
  createMeshAppearance,
  DEFAULT_ACTOR_COLOR,
} from "./actor";

import type { AbstractMesh, Scene } from "@babylonjs/core";
import type { TerrainMap } from "../map";
import type { ActorRenderState } from "../simulation/actor";
import type { ActorAppearance, ActorPose } from "./actor";

const SELECTION_COLOR = new Color3(1, 0.86, 0.44);
/** Edge length of the stand-in cube for actors without an appearance. */
const FALLBACK_ACTOR_SIZE = 0.6;

/** Appearances keyed by actor definition ID. Changes apply on the next update. */
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
 * The caller still owns the appearances.
 */
export function createActorViewRegistry(
  scene: Scene,
  map: TerrainMap,
  appearances: ActorAppearanceCatalog,
): ActorViewRegistry {
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

  const previousPoses = new Map<string, ActorPose>();
  const pose: ActorPose = { worldPosition: { x: 0, z: 0 }, facing: 0 };
  let selectedActorId: string | undefined;

  const renderers = createViewRegistry({
    keyFor: (actor: ActorRenderState) => ({
      definitionId: actor.definitionId,
      appearance: appearanceFor(actor.definitionId),
    }),
    sameKey: (left, right) =>
      left.definitionId === right.definitionId &&
      left.appearance === right.appearance,
    onRemove: (id) => {
      previousPoses.delete(id);
    },
    create: (actor, { appearance }) => {
      const renderer = createActorRenderer(
        scene,
        map,
        actor,
        appearance,
        selectionMaterial,
      );
      renderer.setSelected(actor.id === selectedActorId);
      return renderer;
    },
  });

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
      renderers.dispose();
      previousPoses.clear();
      selectionMaterial.dispose();
      fallback?.dispose();
    },
    setSelectedActor: (actorId) => {
      selectedActorId = actorId;
      for (const renderer of renderers.values()) {
        renderer.setSelected(renderer.actorId === actorId);
      }
    },
    update: (actors, tickProgress) => {
      renderers.sync(actors);
      for (const actor of actors) {
        interpolatePose(previousPoses.get(actor.id), actor, tickProgress, pose);
        renderers.get(actor.id)!.update(pose);
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
  return createMeshAppearance(mesh, {
    radius: FALLBACK_ACTOR_SIZE * Math.SQRT1_2,
    height: FALLBACK_ACTOR_SIZE,
  });
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
  into.facing =
    previous.facing + shortestTurn(previous.facing, current.facing) * progress;
  return into;
}
