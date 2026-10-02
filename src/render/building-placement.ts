import { Color3 } from "@babylonjs/core";

import {
  createFootprintOverlay,
  footprintOverlayOffset,
} from "./footprint-overlay";
import { isTerrainPickMesh } from "./terrain-mesh";
import { createTilePlacedActor } from "../simulation/placement";
import { tileBounds } from "../simulation/grid";
import { createTilePlacedActorViewRegistry } from "./tile-placed-actor-view";
import { createPrimaryClick } from "./primary-click";

import type { Scene } from "@babylonjs/core";
import type { TerrainMap, TileCoord } from "../map";
import type { MissionSimulation } from "../simulation/mission";
import type { CommandOutcome } from "../simulation/command";
import type { ActorPlacement, PlacementReason } from "../simulation/placement";
import type { ActorDefinition } from "../simulation/actor";
import type { TilePlacedActorAppearance } from "./tile-placed-actor-view";

export type BuildingPlacementControls = {
  build?: HTMLButtonElement;
  rotate?: HTMLButtonElement;
  confirm?: HTMLButtonElement;
  cancel?: HTMLButtonElement;
  status?: HTMLElement;
};

const REASONS: Record<PlacementReason, string> = {
  "invalid-actor": "Invalid building placement.",
  "used-id": "Placement changed before confirmation. Try again.",
  "unknown-definition": "Unknown building type.",
  "not-placeable": "This actor cannot be placed.",
  "out-of-bounds": "The whole footprint must stay inside the playable map.",
  "unbuildable-terrain": "This ground cannot support a building.",
  "disallowed-terrain": "Buildings cannot be placed on this terrain.",
  "excessive-slope": "This slope is too steep for a building.",
  "actor-conflict": "A unit is standing in the footprint.",
  "occupancy-conflict": "Another structure occupies this footprint.",
};

export type BuildingPlacementOptions = {
  /** Must define a footprint. Placed actor IDs derive from its ID. */
  definition: ActorDefinition;
  appearance: TilePlacedActorAppearance;
  /** Display name for status text. */
  name: string;
  controls: BuildingPlacementControls;
  onPlaced: (actorId: string) => void;
  onStart: () => void;
};

type ScreenPoint = { clientX: number; clientY: number };

/** Width × depth of the tiles' bounding box, for display. */
export function footprintSize(tiles: readonly TileCoord[]): string {
  const { minX, minZ, maxX, maxZ } = tileBounds(tiles);
  return `${maxX - minX + 1} × ${maxZ - minZ + 1}`;
}

/** Preview is local UI state; placement is rechecked at the command's tick. */
export function createBuildingPlacement(
  canvas: HTMLCanvasElement,
  scene: Scene,
  map: TerrainMap,
  simulation: MissionSimulation,
  {
    definition,
    appearance,
    name,
    controls,
    onPlaced,
    onStart,
  }: BuildingPlacementOptions,
) {
  const preview = createTilePlacedActorViewRegistry(
    scene,
    map,
    [definition],
    new Map([[definition.id, appearance]]),
    { preview: true },
  );
  let active = false;
  let faulted = false;
  let nextId = 1;
  let quarterTurns = 0;
  let origin: TileCoord | undefined;
  let pointer: ScreenPoint | undefined;
  let pendingId: string | undefined;
  /** A tick-time rejection, shown until the player changes the placement. */
  let rejection: { text: string; placement: string } | undefined;
  let overlay: ReturnType<typeof createFootprintOverlay> | undefined;
  let overlayOffset = 0;
  let pickKey = "";
  let stateKey = "";
  let overlayKey = "";
  let uiKey = "";
  let terrainRevision = 0;
  const size = footprintSize(definition.footprint!.occupiedTiles);
  const message = (text: string) => {
    if (controls.status && controls.status.textContent !== text)
      controls.status.textContent = text;
  };
  const placement = (): ActorPlacement | undefined =>
    origin
      ? {
          actorId: `${definition.id}-${nextId}`,
          definitionId: definition.id,
          origin,
          quarterTurns,
        }
      : undefined;
  const placementKey = () => JSON.stringify([origin, quarterTurns]);
  const clearOverlay = () => {
    overlay?.dispose();
    overlay = undefined;
    overlayKey = "";
  };
  const pickOrigin = (point: ScreenPoint) => {
    const bounds = canvas.getBoundingClientRect();
    const pick = scene.pick(
      point.clientX - bounds.left,
      point.clientY - bounds.top,
      isTerrainPickMesh,
    );
    return pick?.hit && pick.pickedPoint
      ? map.tileAtWorldPosition(pick.pickedPoint.x, pick.pickedPoint.z)
      : undefined;
  };
  const update = () => {
    if (active && pointer && !pendingId) {
      // Picking is costly, so repeat it only after the pointer or camera moves.
      const nextPickKey = JSON.stringify([
        pointer.clientX,
        pointer.clientY,
        scene.getTransformMatrix().updateFlag,
        terrainRevision,
      ]);
      if (nextPickKey !== pickKey) {
        pickKey = nextPickKey;
        origin = pickOrigin(pointer);
      }
    }
    if (rejection && rejection.placement !== placementKey())
      rejection = undefined;
    // Ticks can move units onto the footprint or change the terrain under it.
    const nextStateKey = JSON.stringify([
      active,
      faulted,
      pendingId,
      origin,
      quarterTurns,
      rejection,
      simulation.completedTicks,
      simulation.actorVersion,
      map.navigationChanges.version,
      map.navigationChanges.generation,
      terrainRevision,
    ]);
    if (nextStateKey === stateKey) return;
    stateKey = nextStateKey;
    let candidate = active ? placement() : undefined;
    let evaluation = candidate
      ? simulation.evaluatePlacement(candidate)
      : undefined;
    // A restored mission may already own or have retired our next ID.
    while (
      evaluation &&
      !evaluation.accepted &&
      evaluation.reason === "used-id"
    ) {
      nextId += 1;
      candidate = placement();
      evaluation = simulation.evaluatePlacement(candidate!);
    }
    preview.update(
      candidate
        ? [
            createTilePlacedActor(map, definition, {
              ...candidate,
              actorId: "building-preview",
            }),
          ]
        : [],
    );
    const key = evaluation
      ? JSON.stringify([
          candidate,
          evaluation.accepted,
          map.navigationChanges.version,
          map.navigationChanges.generation,
          terrainRevision,
        ])
      : "";
    if (key !== overlayKey) {
      clearOverlay();
      if (evaluation) {
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
    const nextUiKey = JSON.stringify([
      active,
      faulted,
      pendingId,
      origin,
      quarterTurns,
      evaluation?.accepted,
      evaluation && !evaluation.accepted ? evaluation.reason : undefined,
      rejection,
    ]);
    if (nextUiKey === uiKey) return;
    uiKey = nextUiKey;
    canvas.dataset.placementActive = String(active);
    canvas.dataset.placementStatus = pendingId
      ? "pending"
      : !active
        ? "idle"
        : !evaluation
          ? "choose-location"
          : evaluation.accepted
            ? "valid"
            : evaluation.reason;
    canvas.dataset.placementRotation = String(quarterTurns);
    canvas.dataset.placementOrigin = origin ? `${origin.x},${origin.z}` : "";
    if (controls.build) controls.build.disabled = active || faulted;
    if (controls.rotate)
      controls.rotate.disabled = !active || !!pendingId || faulted;
    if (controls.cancel)
      controls.cancel.disabled = !active || !!pendingId || faulted;
    if (controls.confirm)
      controls.confirm.disabled =
        !evaluation?.accepted || !!pendingId || faulted;
    if (active) {
      message(
        pendingId
          ? `Placing ${name}…`
          : rejection
            ? rejection.text
            : !evaluation
              ? `Point or tap on terrain to preview the ${size} footprint.`
              : evaluation.accepted
                ? `Ready · ${quarterTurns * 90}° · Click terrain or press Place building.`
                : REASONS[evaluation.reason],
      );
    }
  };
  const start = () => {
    if (active || faulted) return;
    active = true;
    origin = undefined;
    pointer = undefined;
    pickKey = "";
    quarterTurns = 0;
    // Layers rarely change, and counting them scans every tile.
    overlayOffset = footprintOverlayOffset(map);
    onStart();
    update();
  };
  const cancel = () => {
    if (!active || pendingId) return;
    active = false;
    origin = undefined;
    pointer = undefined;
    message("Placement cancelled.");
    clearOverlay();
    update();
  };
  const rotate = () => {
    if (!active || pendingId || faulted) return;
    quarterTurns = (quarterTurns + 1) % 4;
    update();
  };
  const confirm = () => {
    if (!active || pendingId || faulted) return;
    const candidate = placement();
    if (!candidate || !simulation.evaluatePlacement(candidate).accepted) {
      update();
      return;
    }
    pendingId = candidate.actorId;
    rejection = undefined;
    nextId += 1;
    simulation.submitCommand({ kind: "place-actor", ...candidate });
    update();
  };
  const move = (event: PointerEvent) => {
    if (!active || pendingId) return;
    if (event.pointerType !== "touch") pointer = event;
  };
  const click = createPrimaryClick(
    canvas,
    (event) => {
      origin = pickOrigin(event);
      pointer = event.pointerType === "touch" ? undefined : event;
      update();
      // Touch taps choose a footprint so a finger never obscures confirmation.
      if (event.pointerType !== "touch") confirm();
    },
    () => active && !pendingId && !faulted,
  );
  const leave = () => {
    pointer = undefined;
    pickKey = "";
  };
  const key = (event: KeyboardEvent) => {
    if (
      !active ||
      event.repeat ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey
    )
      return;
    if (event.key === "Escape") cancel();
    else if (event.key.toLowerCase() === "r") rotate();
    else return;
    event.preventDefault();
  };
  controls.build?.addEventListener("click", start);
  controls.rotate?.addEventListener("click", rotate);
  controls.confirm?.addEventListener("click", confirm);
  controls.cancel?.addEventListener("click", cancel);
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerleave", leave);
  canvas.addEventListener("pointercancel", leave);
  window.addEventListener("keydown", key);
  const terrainObserver = map.onChangedObservable.add(() => {
    terrainRevision += 1;
    if (active) overlayOffset = footprintOverlayOffset(map);
  });
  update();
  message("Instant placement sandbox · Select a building to inspect it.");
  return {
    get active() {
      return active;
    },
    update,
    onOutcome: ({ command, accepted, reason }: CommandOutcome) => {
      if (command.kind !== "place-actor" || command.actorId !== pendingId)
        return;
      pendingId = undefined;
      if (accepted) {
        active = false;
        origin = undefined;
        pointer = undefined;
        clearOverlay();
        message(`${name} placed. Select it to inspect or remove it.`);
        onPlaced(command.actorId);
      } else {
        rejection = {
          text: reason
            ? REASONS[reason]
            : "Placement rejected. Choose another location.",
          placement: placementKey(),
        };
      }
      update();
    },
    fault: () => {
      faulted = true;
      active = false;
      pendingId = undefined;
      clearOverlay();
      update();
      message("Simulation stopped. Reload to continue.");
    },
    dispose: () => {
      preview.dispose();
      click.dispose();
      clearOverlay();
      map.onChangedObservable.remove(terrainObserver);
      controls.build?.removeEventListener("click", start);
      controls.rotate?.removeEventListener("click", rotate);
      controls.confirm?.removeEventListener("click", confirm);
      controls.cancel?.removeEventListener("click", cancel);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerleave", leave);
      canvas.removeEventListener("pointercancel", leave);
      window.removeEventListener("keydown", key);
    },
  };
}
