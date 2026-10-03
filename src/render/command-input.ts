import { isTerrainPickMesh } from "./terrain-mesh";
import { createSelection } from "./selection";
import { createPointerGesture } from "./pointer-gesture";

import type { AbstractMesh, Scene } from "@babylonjs/core";
import type {
  ActorCommand,
  AttackCommand,
  GroupMoveCommand,
} from "../simulation/command";
import type { SelectionRect } from "./selection";
import type { WorldPosition } from "../simulation/world";
export type CommandInputOptions = {
  actorIdForMesh: (mesh: AbstractMesh | null) => string | undefined;
  /** Maps clickable world objects to ground destinations. */
  movementTargetForMesh?: (
    mesh: AbstractMesh | null,
  ) => WorldPosition | undefined;
  actorIdsInRect: (rect: SelectionRect) => string[];
  submitCommand: (
    command: ActorCommand | GroupMoveCommand | AttackCommand,
  ) => void;
  /** Whether clicking this actor attacks it instead of selecting it. */
  canAttack?: (actorId: string) => boolean;
  onWorldSelectionChanged?: (actorIds: readonly string[]) => void;
  onSelectionChanged?: (actorIds: readonly string[]) => void;
  enabled?: () => boolean;
  groundTargetMode?: () => boolean;
  onGroundTarget?: (target: WorldPosition) => void;
  cancelGroundTarget?: () => boolean;
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
  /** The actor under a viewport point, ignoring terrain. */
  actorIdAt: (clientX: number, clientY: number) => string | undefined;
  /** Stops selected mobile actors. Returns how many stop orders it sent. */
  stop: () => number;
  /** Abandons an in-progress gesture; returns whether there was one. */
  cancelGesture: () => boolean;
  dispose: () => void;
};

/** Mouse drags select; touch drags select only in explicit box mode. */
export function createCommandInput(
  canvas: HTMLCanvasElement,
  scene: Scene,
  {
    actorIdForMesh,
    movementTargetForMesh = () => undefined,
    actorIdsInRect,
    submitCommand,
    onSelectionChanged,
    onWorldSelectionChanged,
    enabled = () => true,
    canMove = () => true,
    canAttack = () => false,
    groundTargetMode = () => false,
    onGroundTarget,
    cancelGroundTarget,
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
  const pickAt = (
    clientX: number,
    clientY: number,
    predicate: (mesh: AbstractMesh) => boolean,
  ) => {
    const bounds = canvas.getBoundingClientRect();
    // Babylon picking uses CSS pixels even on HiDPI displays.
    return scene.pick(clientX - bounds.left, clientY - bounds.top, predicate);
  };
  const actorIdAt = (clientX: number, clientY: number) =>
    actorIdForMesh(
      pickAt(clientX, clientY, (mesh) => actorIdForMesh(mesh) !== undefined)
        ?.pickedMesh ?? null,
    );
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
        box: !groundTargetMode() && (event.pointerType !== "touch" || boxMode),
        additive: event.shiftKey || additiveMode,
      };
    },
    release: () => {
      box.hidden = true;
    },
    move: (event, gesture) => {
      if (!gesture.data.box) return;
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
      const pick = pickAt(
        event.clientX,
        event.clientY,
        (mesh) =>
          isTerrainPickMesh(mesh) ||
          (!groundTargetMode() &&
            (actorIdForMesh(mesh) !== undefined ||
              movementTargetForMesh(mesh) !== undefined)),
      );
      const picked = actorIdForMesh(pick?.pickedMesh ?? null);
      const target =
        movementTargetForMesh(pick?.pickedMesh ?? null) ??
        (pick?.hit && pick.pickedPoint && isTerrainPickMesh(pick.pickedMesh)
          ? { x: pick.pickedPoint.x, z: pick.pickedPoint.z }
          : undefined);
      if (groundTargetMode()) {
        if (target) onGroundTarget?.(target);
        return;
      }
      const ids = selection.ids.filter(canMove);
      if (picked && !boxMode && ids.length > 0 && canAttack(picked)) {
        for (const actorId of ids)
          submitCommand({ kind: "attack", actorId, targetId: picked });
      } else if (picked) {
        select(picked, additive);
        onWorldSelectionChanged?.(selection.ids);
      } else if (target) {
        if (boxMode || ids.length === 0) {
          if (!additive) select(undefined);
          onWorldSelectionChanged?.(selection.ids);
        } else {
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
    if (!enabled()) return 0;
    cancelGroundTarget?.();
    const ids = selection.ids.filter(canMove);
    for (const actorId of ids) submitCommand({ kind: "stop", actorId });
    return ids.length;
  };
  const key = (event: KeyboardEvent) => {
    if (!enabled() || event.ctrlKey || event.metaKey || event.altKey) return;
    if (
      event.target instanceof HTMLElement &&
      (event.target.isContentEditable ||
        event.target.closest("input, textarea, select"))
    )
      return;
    if (event.key === "Escape" && cancelGroundTarget?.()) {
      cancelGesture();
      event.preventDefault();
      return;
    }
    if (event.key === "Escape") {
      const hadSelection = selection.ids.length > 0;
      if (!cancelGesture() && !hadSelection) return;
      if (hadSelection) select(undefined);
    } else if (event.key.toLowerCase() === "s") {
      if (stop() === 0) return;
    } else return;
    event.preventDefault();
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
      if (active) cancelGroundTarget?.();
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
    actorIdAt,
    stop,
    cancelGesture,
    dispose: () => {
      pointer.dispose();
      box.remove();
      window.removeEventListener("keydown", key);
    },
  };
}
