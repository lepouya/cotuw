import { isTerrainPickMesh } from "./terrain-mesh";

import type { AbstractMesh, Scene } from "@babylonjs/core";
import type { ActorCommand } from "../simulation/command";

/** CSS pixels a press may wander and still count as a click, not a pan. */
const CLICK_SLOP_PIXELS = 5;

export type CommandInputOptions = {
  actorIdForMesh: (mesh: AbstractMesh | null) => string | undefined;
  submitCommand: (command: ActorCommand) => void;
  onSelectionChanged?: (actorId: string | undefined) => void;
};

export type CommandInput = {
  readonly selectedActorId: string | undefined;
  select: (actorId: string | undefined) => void;
  dispose: () => void;
};

/**
 * Left-click selects an actor, or deselects it if already selected. A
 * left-click on terrain orders the selected actor to move there. Drags stay
 * with the camera.
 */
export function createCommandInput(
  canvas: HTMLCanvasElement,
  scene: Scene,
  { actorIdForMesh, submitCommand, onSelectionChanged }: CommandInputOptions,
): CommandInput {
  let selectedActorId: string | undefined;
  const select = (actorId: string | undefined) => {
    selectedActorId = actorId;
    onSelectionChanged?.(actorId);
  };

  let pointerDown:
    { pointerId: number; clientX: number; clientY: number } | undefined;
  const handlePointerDown = (event: PointerEvent) => {
    if (event.button === 0) {
      pointerDown = event;
    }
  };
  const clearPointerDown = () => {
    pointerDown = undefined;
  };
  const handlePointerUp = (event: PointerEvent) => {
    const press = pointerDown;
    clearPointerDown();
    if (
      event.button !== 0 ||
      !press ||
      event.pointerId !== press.pointerId ||
      Math.hypot(event.clientX - press.clientX, event.clientY - press.clientY) >
        CLICK_SLOP_PIXELS
    ) {
      return;
    }

    const bounds = canvas.getBoundingClientRect();
    // Babylon's pointer input also passes CSS-pixel coordinates to scene.pick.
    // Scaling to the render buffer would miss on a HiDPI display.
    const pick = scene.pick(
      event.clientX - bounds.left,
      event.clientY - bounds.top,
      // Other scene meshes, such as overlays, must not swallow the click.
      (mesh) => actorIdForMesh(mesh) !== undefined || isTerrainPickMesh(mesh),
    );
    if (!pick?.hit) {
      return;
    }

    const pickedActorId = actorIdForMesh(pick.pickedMesh);
    if (pickedActorId) {
      select(pickedActorId === selectedActorId ? undefined : pickedActorId);
    } else if (
      selectedActorId &&
      pick.pickedPoint &&
      isTerrainPickMesh(pick.pickedMesh)
    ) {
      submitCommand({
        kind: "move",
        actorId: selectedActorId,
        target: { x: pick.pickedPoint.x, z: pick.pickedPoint.z },
      });
    }
  };
  canvas.addEventListener("pointerdown", handlePointerDown);
  canvas.addEventListener("pointerup", handlePointerUp);
  canvas.addEventListener("pointercancel", clearPointerDown);

  return {
    get selectedActorId() {
      return selectedActorId;
    },
    select,
    dispose: () => {
      canvas.removeEventListener("pointerdown", handlePointerDown);
      canvas.removeEventListener("pointerup", handlePointerUp);
      canvas.removeEventListener("pointercancel", clearPointerDown);
    },
  };
}
