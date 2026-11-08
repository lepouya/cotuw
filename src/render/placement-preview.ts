import { Color3, MeshBuilder } from "@babylonjs/core";

import {
  createFootprintOverlay,
  footprintOverlayOffset,
} from "./footprint-overlay";
import { groundPoint, groundRing } from "./ground-marker";
import { isTerrainPickMesh } from "./terrain-mesh";
import { createTilePlacedActorViewRegistry } from "./tile-placed-actor-view";
import { createTilePlacedActor } from "../simulation/placement";

import type { LinesMesh, Scene } from "@babylonjs/core";
import type { TerrainMap, TileCoord } from "../map";
import type { ActorDefinition } from "../simulation/actor";
import type {
  ActorPlacement,
  PlacementEvaluation,
} from "../simulation/placement";
import type { WorldPosition } from "../simulation/world";
import type {
  TilePlacedActorAppearance,
  TilePlacedActorAppearanceCatalog,
} from "./tile-placed-actor-view";

export type ScreenPoint = { clientX: number; clientY: number };

/** A proposed building as the placement tool evaluated it. */
export type PlacementCandidate = {
  definition: ActorDefinition;
  placement: ActorPlacement;
  owner: string;
  evaluation: PlacementEvaluation;
  /** The worker an accepted growth placement assigns. */
  tender?: WorldPosition;
};

/**
 * The semi-transparent model, footprint, and growth tender ring for a
 * proposed building. Late asset loads replace a shown model.
 */
export function createPlacementPreview(
  canvas: HTMLCanvasElement,
  scene: Scene,
  map: TerrainMap,
  definitions: readonly ActorDefinition[],
  appearances: TilePlacedActorAppearanceCatalog,
) {
  const models = createTilePlacedActorViewRegistry(
    scene,
    map,
    definitions,
    appearances,
    { preview: true },
  );
  let overlay: ReturnType<typeof createFootprintOverlay> | undefined;
  /** Layers rarely change, and counting them scans every tile. */
  let overlayOffset: number | undefined;
  let tenderRing: LinesMesh | undefined;
  let terrainRevision = 0;
  let pickKey = "";
  let picked: TileCoord | undefined;
  let modelKey = "";
  let shownAppearance: TilePlacedActorAppearance | undefined;
  let overlayKey = "";
  let ringKey = "";
  const terrainObserver = map.onChangedObservable.add(() => {
    terrainRevision += 1;
    overlayOffset = undefined;
  });
  const clearRing = () => {
    tenderRing?.dispose();
    tenderRing = undefined;
    ringKey = "";
  };
  const clearOverlay = () => {
    overlay?.dispose();
    overlay = undefined;
    overlayKey = "";
  };
  const showModel = (candidate: PlacementCandidate | undefined) => {
    const key = candidate
      ? JSON.stringify([candidate.placement, terrainRevision])
      : "";
    const appearance = candidate && appearances.get(candidate.definition.id);
    if (key === modelKey && appearance === shownAppearance) return;
    modelKey = key;
    shownAppearance = appearance;
    models.update(
      candidate
        ? [
            createTilePlacedActor(
              map,
              candidate.definition,
              { ...candidate.placement, actorId: "building-preview" },
              candidate.owner,
            ),
          ]
        : [],
    );
  };
  const showOverlay = (candidate: PlacementCandidate | undefined) => {
    const key = candidate
      ? JSON.stringify([
          candidate.placement,
          candidate.evaluation.accepted,
          map.navigationChanges.version,
          map.navigationChanges.generation,
          terrainRevision,
        ])
      : "";
    if (key !== overlayKey) {
      clearOverlay();
      if (candidate) {
        const { evaluation } = candidate;
        overlayOffset ??= footprintOverlayOffset(map);
        overlay = createFootprintOverlay(scene, map, evaluation.tiles, {
          name: "building-placement",
          color: evaluation.accepted
            ? new Color3(0.25, 0.95, 0.74)
            : new Color3(1, 0.3, 0.18),
          blocked: !evaluation.accepted,
          heightOffset: overlayOffset,
        });
      }
      overlayKey = key;
    }
    // The tender ring follows a moving worker without rebuilding the footprint.
    const tender = candidate?.tender;
    const nextRingKey = JSON.stringify([tender, key]);
    if (nextRingKey === ringKey) return;
    clearRing();
    if (tender) {
      tenderRing = MeshBuilder.CreateLines(
        "growth-worker-preview",
        {
          points: groundRing(tender, 0.55, 32, (point) =>
            groundPoint(map, point, 0.08),
          ),
        },
        scene,
      );
      tenderRing.color = new Color3(0.8, 0.5, 1);
      tenderRing.isPickable = false;
    }
    ringKey = nextRingKey;
  };
  const clear = () => {
    clearRing();
    clearOverlay();
    overlayOffset = undefined;
    showModel(undefined);
  };
  return {
    /**
     * The terrain tile under a viewport point. Picking is costly, so it
     * repeats only after the point, camera, or terrain changes.
     */
    tileAt: (point: ScreenPoint) => {
      const key = JSON.stringify([
        point.clientX,
        point.clientY,
        scene.getTransformMatrix().updateFlag,
        terrainRevision,
      ]);
      if (key === pickKey) return picked;
      pickKey = key;
      const bounds = canvas.getBoundingClientRect();
      const pick = scene.pick(
        point.clientX - bounds.left,
        point.clientY - bounds.top,
        isTerrainPickMesh,
      );
      picked =
        pick?.hit && pick.pickedPoint
          ? map.tileAtWorldPosition(pick.pickedPoint.x, pick.pickedPoint.z)
          : undefined;
      return picked;
    },
    /** Shows a candidate, or nothing; unchanged candidates rebuild nothing. */
    show: (candidate: PlacementCandidate | undefined) => {
      if (!candidate) return clear();
      showModel(candidate);
      showOverlay(candidate);
    },
    dispose: () => {
      clear();
      models.dispose();
      map.onChangedObservable.remove(terrainObserver);
    },
  };
}

export type PlacementPreview = ReturnType<typeof createPlacementPreview>;
