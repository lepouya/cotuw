import { createPrimaryClick } from "../render/primary-click";
import { worldInputAvailable } from "../render/input-focus";
import { isOutcomeOf } from "../simulation/command";
import { footprintSize, tileKey } from "../simulation/grid";
import { missionEnded } from "../simulation/mission-result";
import { setText } from "./dom";
import { presentResult, SIMULATION_STOPPED } from "./mission-result";

import type { TerrainMap, TileCoord } from "../map";
import type {
  PlacementCandidate,
  PlacementPreview,
  ScreenPoint,
} from "../render/placement-preview";
import type { ActorDefinition } from "../simulation/actor";
import type { AuthorityReason, CommandOutcome } from "../simulation/command";
import type { MissionSimulation } from "../simulation/mission";
import type { ActorPlacement, PlacementReason } from "../simulation/placement";

export type BuildingPlacementControls = {
  rotate?: HTMLButtonElement;
  confirm?: HTMLButtonElement;
  cancel?: HTMLButtonElement;
  status?: HTMLElement;
};

const REASONS: Record<PlacementReason | AuthorityReason, string> = {
  unauthorized: "Select only your own workers.",
  "missing-worker": "Select a worker that can tend this building.",
  "missing-headquarters": "An operational headquarters is needed for growth.",
  "unreachable-growth": "No selected worker can reach this building.",
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
  "insufficient-resources": "Not enough resources for this building.",
  "resource-site": "Keep resource sites and salvage clear of buildings.",
  unexplored: "Explore the whole footprint before building there.",
  debris: "Wait for the debris to clear.",
};

export type BuildingPlacementChoice = {
  build?: HTMLButtonElement;
  /** Must define a footprint. Placed actor IDs derive from its ID. */
  definition: ActorDefinition;
  /** Display name for status text. */
  name: string;
};

export type BuildingPlacementOptions = {
  buildings: readonly BuildingPlacementChoice[];
  /** Draws the candidate; it must accept every building definition. */
  preview: PlacementPreview;
  controls: BuildingPlacementControls;
  enabled?: () => boolean;
  pointerEnabled?: () => boolean;
  workerIds?: () => readonly string[];
  onPlaced: (actorId: string) => void;
  onStart: (definition: ActorDefinition) => void;
  onInvalid?: () => void;
};

/** Preview is local UI state; placement is rechecked at the command's tick. */
export function createBuildingPlacement(
  canvas: HTMLCanvasElement,
  map: TerrainMap,
  simulation: MissionSimulation,
  {
    buildings,
    preview,
    controls,
    enabled = () => true,
    pointerEnabled = () => true,
    workerIds,
    onPlaced,
    onStart,
    onInvalid,
  }: BuildingPlacementOptions,
) {
  const controller = new AbortController();
  const { signal } = controller;
  const acceptsPointer = () =>
    pointerEnabled() && worldInputAvailable(canvas.ownerDocument);
  let definition = buildings[0]?.definition;
  let name = buildings[0]?.name ?? "";
  let active = false;
  let faulted = false;
  let quarterTurns = 0;
  let origin: TileCoord | undefined;
  let pointer: ScreenPoint | undefined;
  let pendingId: string | undefined;
  /** A tick-time rejection, shown until the player changes the placement. */
  let rejection: { text: string; placement: string } | undefined;
  let shown: PlacementCandidate | undefined;
  let stateKey = "";
  let uiKey = "";
  let terrainRevision = 0;
  const size = () => footprintSize(definition!.footprint!.occupiedTiles);
  const message = (text: string) => setText(controls.status, text);
  const placement = (): ActorPlacement | undefined =>
    origin && definition
      ? {
          actorId: simulation.unusedActorId(`${definition.id}-`),
          definitionId: definition.id,
          origin,
          quarterTurns,
          ...(definition.growth && { workerIds: [...(workerIds?.() ?? [])] }),
        }
      : undefined;
  const placementKey = () => JSON.stringify([origin, quarterTurns]);
  /** The candidate at the current state, evaluated as its command would be. */
  const evaluate = (): PlacementCandidate | undefined => {
    const candidate = active ? placement() : undefined;
    if (!candidate) return undefined;
    const evaluation = simulation.evaluatePlacement(candidate);
    const tender =
      evaluation.accepted && evaluation.workerId
        ? simulation.actorById(evaluation.workerId)?.worldPosition
        : undefined;
    return {
      definition: definition!,
      placement: candidate,
      owner: simulation.playerOwner,
      evaluation,
      ...(tender && { tender }),
    };
  };
  const update = () => {
    const available = enabled();
    if (active && pointer && !pendingId && acceptsPointer())
      origin = preview.tileAt(pointer);
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
      // Selected workers are growth tender candidates.
      definition?.growth && workerIds?.(),
      simulation.completedTicks,
      simulation.actorVersion,
      map.navigationChanges.version,
      map.navigationChanges.generation,
      terrainRevision,
    ]);
    const changed = nextStateKey !== stateKey;
    if (changed) {
      stateKey = nextStateKey;
      shown = evaluate();
    }
    // Late asset loads also replace an unchanged preview.
    preview.show(shown);
    if (!changed) return;
    const evaluation = shown?.evaluation;
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
    quarterTurns = 0;
    onStart(building.definition);
    update();
  };
  const cancel = () => {
    if (!active || pendingId) return;
    active = false;
    origin = undefined;
    pointer = undefined;
    message("Placement cancelled.");
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
      onInvalid?.();
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
      origin = preview.tileAt(event);
      pointer = event.pointerType === "touch" ? undefined : event;
      update();
      // Touch taps choose a footprint so a finger never obscures confirmation.
      if (event.pointerType !== "touch") confirm();
    },
    () => active && !pendingId && !faulted && enabled() && acceptsPointer(),
  );
  const leave = () => {
    pointer = undefined;
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
  const terrainObserver = map.onChangedObservable.add(() => {
    terrainRevision += 1;
  });
  update();
  message(
    buildings.length
      ? "Choose a building, then place it on clear terrain."
      : "No buildings available.",
  );
  return {
    /** Ends placement unless its command is pending. */
    cancel,
    rotate,
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
      update();
      const { result } = simulation;
      message(
        result && missionEnded(result)
          ? presentResult(result).directive
          : SIMULATION_STOPPED,
      );
    },
    dispose: () => {
      controller.abort();
      click.dispose();
      map.onChangedObservable.remove(terrainObserver);
    },
  };
}
