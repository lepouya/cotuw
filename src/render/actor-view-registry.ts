import {
  Color3,
  Matrix,
  MeshBuilder,
  StandardMaterial,
  Vector3,
} from "@babylonjs/core";

import { shortestTurn } from "../simulation/world";
import { createViewRegistry } from "./view-registry";
import {
  actorIdForPickMesh,
  createActorRenderer,
  createMeshAppearance,
  DEFAULT_ACTOR_COLOR,
} from "./actor";

import type { ActorTrigger } from "../content/presentation";
import type { AbstractMesh, Scene } from "@babylonjs/core";
import type { TerrainMap } from "../map";
import type { ActorRenderState } from "../simulation/actor";
import type { ActorAnimationState, ActorAppearance, ActorPose } from "./actor";
import type { SelectionRect } from "./selection";
import type { WorldPosition } from "../simulation/world";

const SELECTION_COLOR = new Color3(1, 0.86, 0.44);
const HOSTILE_SELECTION_COLOR = new Color3(0.95, 0.22, 0.18);
/** Edge length of the stand-in cube for actors without an appearance. */
const FALLBACK_ACTOR_SIZE = 0.6;

/** Appearances keyed by actor definition ID. Changes apply on the next update. */
export type ActorAppearanceCatalog = ReadonlyMap<string, ActorAppearance>;

export type ActorViewRegistry = {
  actorIdForMesh: (mesh: AbstractMesh | null) => string | undefined;
  /** Records poses to interpolate from. Call it right before each tick. */
  capturePreviousPoses: (actors: readonly ActorRenderState[]) => void;
  dispose: () => void;
  setSelectedActors: (actorIds: readonly string[]) => void;
  /** Where an actor was last drawn, between ticks. */
  groundPosition: (actorId: string) => WorldPosition | undefined;
  /**
   * Queues a trigger for the next update, if the actor is drawn then. Repeated
   * triggers between rendered frames coalesce.
   */
  play: (actorId: string, trigger: ActorTrigger) => void;
  actorIdsInRect: (canvas: HTMLCanvasElement, rect: SelectionRect) => string[];
  /**
   * Creates and removes views to match `actors`, then draws each one
   * `tickProgress` of the way from its previous pose to its current one.
   * Without `stateOf`, appearances keep their previous animation state.
   */
  update: (
    actors: readonly ActorRenderState[],
    tickProgress: number,
    seconds?: number,
    stateOf?: (actor: ActorRenderState) => ActorAnimationState,
  ) => void;
};

/**
 * Owns actor presentation and maps renderer picks back to stable actor IDs.
 * The caller still owns the appearances.
 */
export function createActorViewRegistry(
  scene: Scene,
  map: TerrainMap,
  appearances: ActorAppearanceCatalog,
  isHostile: (definitionId: string) => boolean = () => false,
): ActorViewRegistry {
  const selectionMaterial = new StandardMaterial(
    "actor-selection-material",
    scene,
  );
  selectionMaterial.emissiveColor = SELECTION_COLOR;
  selectionMaterial.disableLighting = true;
  const hostileSelectionMaterial = new StandardMaterial(
    "actor-hostile-selection-material",
    scene,
  );
  hostileSelectionMaterial.emissiveColor = HOSTILE_SELECTION_COLOR;
  hostileSelectionMaterial.disableLighting = true;
  let fallback: ActorAppearance | undefined;
  // A visible stand-in beats a crash in the render loop for unknown kinds.
  const appearanceFor = (definitionId: string) =>
    appearances.get(definitionId) ??
    (fallback ??= createFallbackAppearance(scene));

  const previousPoses = new Map<string, ActorPose>();
  const pendingTriggers = new Map<string, Set<ActorTrigger>>();
  const pose: ActorPose = { worldPosition: { x: 0, z: 0 }, facing: 0 };
  let selectedActorIds = new Set<string>();

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
    onReplace: (id, previous, next) => {
      if (previous.definitionId !== next.definitionId) previousPoses.delete(id);
    },
    create: (actor, { appearance }) => {
      const hostile = isHostile(actor.definitionId);
      const renderer = createActorRenderer(
        scene,
        map,
        actor,
        appearance,
        hostile ? hostileSelectionMaterial : selectionMaterial,
        hostile,
      );
      renderer.setSelected(selectedActorIds.has(actor.id));
      return renderer;
    },
  });

  const setSelectedActors = (ids: readonly string[]) => {
    selectedActorIds = new Set(ids);
    for (const renderer of renderers.values())
      renderer.setSelected(selectedActorIds.has(renderer.actorId));
  };
  return {
    actorIdForMesh: (mesh) => {
      const actorId = actorIdForPickMesh(mesh);
      return actorId !== undefined && renderers.has(actorId)
        ? actorId
        : undefined;
    },
    capturePreviousPoses: (actors) => {
      const present = new Set(actors.map(({ id }) => id));
      for (const id of previousPoses.keys())
        if (!present.has(id)) previousPoses.delete(id);
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
      pendingTriggers.clear();
      selectionMaterial.dispose();
      hostileSelectionMaterial.dispose();
      fallback?.dispose();
    },
    setSelectedActors,
    groundPosition: (actorId) => {
      const point = renderers.get(actorId)?.selectionPoint();
      return point && { x: point.x, z: point.z };
    },
    play: (actorId, trigger) => {
      let pending = pendingTriggers.get(actorId);
      if (!pending) pendingTriggers.set(actorId, (pending = new Set()));
      pending.add(trigger);
    },
    actorIdsInRect: (canvas, rect) => {
      if (!scene.activeCamera) return [];
      const engine = scene.getEngine();
      const bounds = canvas.getBoundingClientRect();
      const viewport = scene.activeCamera.viewport.toGlobal(
        engine.getRenderWidth(),
        engine.getRenderHeight(),
      );
      const ids = [];
      for (const renderer of renderers.values()) {
        const point = Vector3.Project(
          renderer.selectionPoint(),
          Matrix.Identity(),
          scene.getTransformMatrix(),
          viewport,
        );
        const x =
          bounds.left + (point.x * bounds.width) / engine.getRenderWidth();
        const y =
          bounds.top + (point.y * bounds.height) / engine.getRenderHeight();
        if (
          point.z >= 0 &&
          point.z <= 1 &&
          x >= rect.left &&
          x <= rect.right &&
          y >= rect.top &&
          y <= rect.bottom
        )
          ids.push(renderer.actorId);
      }
      return ids;
    },
    update: (actors, tickProgress, seconds = 0, stateOf) => {
      renderers.sync(actors);
      for (const actor of actors) {
        interpolatePose(previousPoses.get(actor.id), actor, tickProgress, pose);
        const renderer = renderers.get(actor.id)!;
        renderer.update(pose, seconds, stateOf?.(actor));
        for (const trigger of pendingTriggers.get(actor.id) ?? [])
          renderer.play(trigger);
      }
      pendingTriggers.clear();
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
