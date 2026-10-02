import { isTerrainPickMesh } from "./terrain-mesh";
import { createSelection } from "../ui/selection";
import { createPointerGesture } from "./pointer-gesture";

import type { AbstractMesh, Scene } from "@babylonjs/core";
import type { ActorCommand, GroupMoveCommand } from "../simulation/command";

export type SelectionRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};
export type CommandInputOptions = {
  actorIdForMesh: (mesh: AbstractMesh | null) => string | undefined;
  actorIdsInRect: (rect: SelectionRect) => string[];
  submitCommand: (command: ActorCommand | GroupMoveCommand) => void;
  onWorldSelectionChanged?: (actorIds: readonly string[]) => void;
  onSelectionChanged?: (actorIds: readonly string[]) => void;
  enabled?: () => boolean;
  canMove?: (actorId: string) => boolean;
};

export type CommandInput = {
  readonly selectedActorId: string | undefined;
  readonly selectedActorIds: readonly string[];
  readonly boxMode: boolean;
  readonly additiveMode: boolean;
  setBoxMode: (active: boolean) => void;
  setAdditiveMode: (active: boolean) => void;
  select: (actorId: string | undefined, additive?: boolean) => void;
  selectMany: (actorIds: readonly string[], additive?: boolean) => void;
  retainSelection: (exists: (id: string) => boolean) => void;
  stop: () => void;
  cancelGesture: () => void;
  dispose: () => void;
};

/** Mouse drags select; touch drags select only in explicit box mode. */
export function createCommandInput(
  canvas: HTMLCanvasElement,
  scene: Scene,
  {
    actorIdForMesh,
    actorIdsInRect,
    submitCommand,
    onSelectionChanged,
    onWorldSelectionChanged,
    enabled = () => true,
    canMove = () => true,
  }: CommandInputOptions,
): CommandInput {
  const selection = createSelection(canMove);
  let boxMode = false;
  let additiveMode = false;
  const box = document.createElement("div");
  box.className = "selection-box";
  box.hidden = true;
  box.setAttribute("aria-hidden", "true");
  document.body.append(box);
  const changed = () => onSelectionChanged?.(selection.ids);
  const select = (id: string | undefined, additive = false) => {
    selection.select(id, additive);
    changed();
  };
  const selectMany = (ids: readonly string[], additive = false) => {
    selection.selectMany(ids, additive);
    changed();
  };
  const rectAt = (start: PointerEvent, event: PointerEvent): SelectionRect => {
    const bounds = canvas.getBoundingClientRect();
    const x = Math.max(bounds.left, Math.min(bounds.right, event.clientX));
    const y = Math.max(bounds.top, Math.min(bounds.bottom, event.clientY));
    return {
      left: Math.min(start.clientX, x),
      top: Math.min(start.clientY, y),
      right: Math.max(start.clientX, x),
      bottom: Math.max(start.clientY, y),
    };
  };
  const pointer = createPointerGesture(canvas, {
    enabled,
    start: (event) => {
      if (event.button !== 0) return undefined;
      canvas.focus({ preventScroll: true });
      return {
        box: event.pointerType !== "touch" || boxMode,
        additive: event.shiftKey || additiveMode,
      };
    },
    cancel: () => {
      box.hidden = true;
    },
    move: (event, gesture) => {
      if (!gesture.dragged || !gesture.data.box) return;
      const rect = rectAt(gesture.start, event);
      box.hidden = false;
      Object.assign(box.style, {
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.right - rect.left}px`,
        height: `${rect.bottom - rect.top}px`,
      });
    },
    end: (event, gesture) => {
      const { additive, box } = gesture.data;
      if (gesture.dragged) {
        if (box) {
          selectMany(actorIdsInRect(rectAt(gesture.start, event)), additive);
          onWorldSelectionChanged?.(selection.ids);
        }
        return;
      }
      const bounds = canvas.getBoundingClientRect();
      // Babylon picking uses CSS pixels even on HiDPI displays.
      const pick = scene.pick(
        event.clientX - bounds.left,
        event.clientY - bounds.top,
        (mesh) => actorIdForMesh(mesh) !== undefined || isTerrainPickMesh(mesh),
      );
      const picked = actorIdForMesh(pick?.pickedMesh ?? null);
      if (picked) {
        select(picked, additive);
        onWorldSelectionChanged?.(selection.ids);
      } else if (
        pick?.hit &&
        pick.pickedPoint &&
        isTerrainPickMesh(pick.pickedMesh)
      ) {
        const ids = selection.ids.filter(canMove);
        if (boxMode || ids.length === 0) {
          if (!additive) select(undefined);
          onWorldSelectionChanged?.(selection.ids);
        } else {
          const target = { x: pick.pickedPoint.x, z: pick.pickedPoint.z };
          if (ids.length === 1)
            submitCommand({ kind: "move", actorId: ids[0]!, target });
          else
            submitCommand({ kind: "group-move", actorIds: [...ids], target });
        }
      }
    },
  });
  const cancelGesture = pointer.cancel;
  const stop = () => {
    if (!enabled()) return;
    for (const actorId of selection.ids.filter(canMove))
      submitCommand({ kind: "stop", actorId });
  };
  const key = (event: KeyboardEvent) => {
    if (!enabled() || event.ctrlKey || event.metaKey || event.altKey) return;
    if (
      event.target instanceof HTMLElement &&
      (event.target.isContentEditable ||
        event.target.closest("input, textarea, select"))
    )
      return;
    if (event.key === "Escape") {
      cancelGesture();
      select(undefined);
      event.preventDefault();
    }
    if (event.key.toLowerCase() === "s") {
      stop();
      event.preventDefault();
    }
  };
  window.addEventListener("keydown", key);
  return {
    get selectedActorId() {
      return selection.ids.length === 1 ? selection.ids[0] : undefined;
    },
    get selectedActorIds() {
      return selection.ids;
    },
    get boxMode() {
      return boxMode;
    },
    get additiveMode() {
      return additiveMode;
    },
    setBoxMode: (active) => {
      cancelGesture();
      boxMode = active;
    },
    setAdditiveMode: (active) => {
      additiveMode = active;
    },
    select,
    selectMany,
    retainSelection: (exists) => {
      if (selection.ids.some((id) => !exists(id))) {
        selection.retain(exists);
        changed();
      }
    },
    stop,
    cancelGesture,
    dispose: () => {
      pointer.dispose();
      box.remove();
      window.removeEventListener("keydown", key);
    },
  };
}
