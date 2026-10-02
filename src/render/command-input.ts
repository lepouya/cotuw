import { isTerrainPickMesh } from "./terrain-mesh";
import { createPrimaryClick } from "./primary-click";

import type { AbstractMesh, Scene } from "@babylonjs/core";
import type { ActorCommand } from "../simulation/command";

export type CommandInputOptions = {
  actorIdForMesh: (mesh: AbstractMesh | null) => string | undefined;
  submitCommand: (command: ActorCommand) => void;
  /** Runs only after a world click changes selection. */
  onWorldSelectionChanged?: (actorId: string | undefined) => void;
  onSelectionChanged?: (actorId: string | undefined) => void;
  enabled?: () => boolean;
  canMove?: (actorId: string) => boolean;
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
  {
    actorIdForMesh,
    submitCommand,
    onSelectionChanged,
    onWorldSelectionChanged,
    enabled = () => true,
    canMove = () => true,
  }: CommandInputOptions,
): CommandInput {
  let selectedActorId: string | undefined;
  const select = (actorId: string | undefined) => {
    selectedActorId = actorId;
    onSelectionChanged?.(actorId);
  };

  const click = createPrimaryClick(
    canvas,
    (event) => {
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
        onWorldSelectionChanged?.(selectedActorId);
      } else if (
        selectedActorId &&
        canMove(selectedActorId) &&
        pick.pickedPoint &&
        isTerrainPickMesh(pick.pickedMesh)
      ) {
        submitCommand({
          kind: "move",
          actorId: selectedActorId,
          target: { x: pick.pickedPoint.x, z: pick.pickedPoint.z },
        });
      }
    },
    enabled,
  );

  return {
    get selectedActorId() {
      return selectedActorId;
    },
    select,
    dispose: click.dispose,
  };
}
