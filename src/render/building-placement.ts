import { Color3 } from "@babylonjs/core";

import {
  createFootprintOverlay,
  footprintOverlayOffset,
} from "./footprint-overlay";
import { isTerrainPickMesh } from "./terrain-mesh";
import { createTilePlacedActor } from "../simulation/placement";
import { footprintSize, tileKey } from "../simulation/grid";
import { isOutcomeOf } from "../simulation/command";
import { createTilePlacedActorViewRegistry } from "./tile-placed-actor-view";
import { createPrimaryClick } from "./primary-click";
import { isTextEntry, worldInputAvailable } from "./input-focus";

import type { Scene } from "@babylonjs/core";
import type { TerrainMap, TileCoord } from "../map";
import type { MissionSimulation } from "../simulation/mission";
import type { CommandOutcome } from "../simulation/command";
import type { ActorPlacement, PlacementReason } from "../simulation/placement";
import type { ActorDefinition } from "../simulation/actor";
import type { TilePlacedActorAppearance } from "./tile-placed-actor-view";

export type BuildingPlacementControls = {
  rotate?: HTMLButtonElement;
  confirm?: HTMLButtonElement;
  cancel?: HTMLButtonElement;
  status?: HTMLElement;
};

const REASONS: Record<PlacementReason, string> = {
  "outside-support":
    "Place the building center inside connected support coverage.",
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
  "insufficient-materials": "Not enough Materials for this building.",
  "resource-site": "Keep Materials sites and salvage clear of buildings.",
  unexplored: "Explore the whole footprint before building there.",
  debris: "Wait for the debris to clear.",
};

export type BuildingPlacementChoice = {
  build?: HTMLButtonElement;
  /** Must define a footprint. Placed actor IDs derive from its ID. */
  definition: ActorDefinition;
  appearance: TilePlacedActorAppearance;
  /** Display name for status text. */
  name: string;
};

export type BuildingPlacementOptions = {
  buildings: readonly BuildingPlacementChoice[];
  controls: BuildingPlacementControls;
  enabled?: () => boolean;
  pointerEnabled?: () => boolean;
  onPlaced: (actorId: string) => void;
  onStart: () => void;
};

type ScreenPoint = { clientX: number; clientY: number };

/** Preview is local UI state; placement is rechecked at the command's tick. */
export function createBuildingPlacement(
  canvas: HTMLCanvasElement,
  scene: Scene,
  map: TerrainMap,
  simulation: MissionSimulation,
  {
    buildings,
    controls,
    enabled = () => true,
    pointerEnabled = () => true,
    onPlaced,
    onStart,
  }: BuildingPlacementOptions,
) {
  const controller = new AbortController();
  const { signal } = controller;
  const acceptsPointer = () =>
    pointerEnabled() && worldInputAvailable(canvas.ownerDocument);
  let definition = buildings[0]?.definition;
  let name = buildings[0]?.name ?? "";
  const preview = createTilePlacedActorViewRegistry(
    scene,
    map,
    buildings.map(({ definition }) => definition),
    new Map(
      buildings.map(({ definition, appearance }) => [
        definition.id,
        appearance,
      ]),
    ),
    { preview: true },
  );
  let active = false;
  let faulted = false;
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
  const size = () => footprintSize(definition!.footprint!.occupiedTiles);
  const message = (text: string) => {
    if (controls.status && controls.status.textContent !== text)
      controls.status.textContent = text;
  };
  const placement = (): ActorPlacement | undefined =>
    origin && definition
      ? {
          actorId: simulation.unusedActorId(`${definition.id}-`),
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
    const available = enabled();
    if (active && pointer && !pendingId && acceptsPointer()) {
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
      available,
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
    const candidate = active ? placement() : undefined;
    const evaluation = candidate
      ? simulation.evaluatePlacement(candidate)
      : undefined;
    preview.update(
      candidate
        ? [
            createTilePlacedActor(map, definition!, {
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
      available,
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
    canvas.dataset.placementOrigin = origin ? tileKey(origin) : "";
    for (const { build } of buildings) {
      if (build) build.disabled = active || faulted || !available;
    }
    if (controls.rotate)
      controls.rotate.disabled =
        !active || !!pendingId || faulted || !available;
    if (controls.cancel)
      controls.cancel.disabled = !active || !!pendingId || faulted;
    if (controls.confirm)
      controls.confirm.disabled =
        !evaluation?.accepted || !!pendingId || faulted || !available;
    if (active) {
      message(
        pendingId
          ? `Placing ${name}…`
          : rejection
            ? rejection.text
            : !evaluation
              ? `Point or tap on terrain to preview the ${name} (${size()}) footprint.`
              : evaluation.accepted
                ? `${name} ready · ${quarterTurns * 90}° · Click terrain or press Place building.`
                : REASONS[evaluation.reason],
      );
    }
  };
  const start = (building: BuildingPlacementChoice) => {
    if (active || faulted || !enabled()) return;
    ({ definition, name } = building);
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
    if (!active || pendingId || faulted || !enabled()) return;
    const candidate = placement();
    if (!candidate || !simulation.evaluatePlacement(candidate).accepted) {
      update();
      return;
    }
    pendingId = candidate.actorId;
    rejection = undefined;
    simulation.submitCommand({ kind: "place-actor", ...candidate });
    update();
  };
  const move = (event: PointerEvent) => {
    if (!active || pendingId || !acceptsPointer()) return;
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
    () => active && !pendingId && !faulted && enabled() && acceptsPointer(),
  );
  const leave = () => {
    pointer = undefined;
    pickKey = "";
  };
  const key = (event: KeyboardEvent) => {
    if (
      !active ||
      !worldInputAvailable(canvas.ownerDocument) ||
      isTextEntry(event.target) ||
      event.defaultPrevented ||
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
  for (const building of buildings) {
    const startBuilding = () => start(building);
    building.build?.addEventListener("click", startBuilding, { signal });
  }
  controls.rotate?.addEventListener("click", rotate, { signal });
  controls.confirm?.addEventListener("click", confirm, { signal });
  controls.cancel?.addEventListener("click", cancel, { signal });
  canvas.addEventListener("pointermove", move, { signal });
  canvas.addEventListener("pointerleave", leave, { signal });
  canvas.addEventListener("pointercancel", leave, { signal });
  window.addEventListener("keydown", key, { signal });
  const terrainObserver = map.onChangedObservable.add(() => {
    terrainRevision += 1;
    if (active) overlayOffset = footprintOverlayOffset(map);
  });
  update();
  message(
    buildings.length
      ? "Choose a building, then place it on clear terrain."
      : "No buildings available.",
  );
  return {
    cancel,
    cancelGesture: () => {
      leave();
      return click.cancel();
    },
    get active() {
      return active;
    },
    /** The building being placed, while placement is active. */
    get definitionId() {
      return active ? definition?.id : undefined;
    },
    update,
    onOutcome: (outcome: CommandOutcome) => {
      if (
        !isOutcomeOf(outcome, "place-actor") ||
        outcome.command.actorId !== pendingId
      )
        return;
      const { command, accepted, reason } = outcome;
      pendingId = undefined;
      if (accepted) {
        active = false;
        origin = undefined;
        pointer = undefined;
        clearOverlay();
        message(`${name} placed.`);
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
      message(
        simulation.result?.kind === "defeat"
          ? "Mission ended in defeat. Restart or load a saved mission."
          : "Simulation stopped. Restart or load a mission from the menu.",
      );
    },
    dispose: () => {
      controller.abort();
      preview.dispose();
      click.dispose();
      clearOverlay();
      map.onChangedObservable.remove(terrainObserver);
    },
  };
}
