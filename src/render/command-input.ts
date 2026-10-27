import { isTerrainPickMesh } from "./terrain-mesh";
import { createSelection } from "./selection";
import { createPointerGesture } from "./pointer-gesture";
import { isTextEntry, worldInputAvailable } from "./input-focus";
import { moveCommand } from "../simulation/command";

import type { AbstractMesh, Scene } from "@babylonjs/core";
import type {
  ActorCommand,
  AttackCommand,
  AttackMoveCommand,
  GroupAttackMoveCommand,
  GroupMoveCommand,
} from "../simulation/command";
import type { SelectionRect } from "./selection";
import type { WorldPosition } from "../simulation/world";

export type ContextActionKind =
  | "tend"
  | "attack"
  | "select"
  | "add"
  | "remove"
  | "move"
  | "attack-move"
  | "clear"
  | "focus"
  | "follow";

/** A world command the radial menu offers. */
export type ContextAction = {
  kind: ContextActionKind;
  label: string;
  run: () => void;
};

/**
 * Actions for a clicked actor or ground point, the primary click's default
 * first. An empty list means a primary click does nothing.
 */
export function contextActionKinds(
  target: { actorId?: string; ground: boolean },
  state: {
    selectedIds: readonly string[];
    /** Selected actors that can move. */
    movers: readonly string[];
    boxMode: boolean;
    additive: boolean;
    canCommand?: boolean;
    canAttack: (actorId: string) => boolean;
    canMove: (actorId: string) => boolean;
  },
): ContextActionKind[] {
  const { actorId } = target;
  const { selectedIds, movers, boxMode, additive } = state;
  if (actorId) {
    if (
      state.canCommand !== false &&
      !boxMode &&
      movers.length > 0 &&
      state.canAttack(actorId)
    )
      return ["attack", "select"];
    const toggle = selectedIds.includes(actorId) ? "remove" : "add";
    if (additive) return [toggle];
    return state.canMove(actorId) && movers.length > 0
      ? ["select", toggle]
      : ["select"];
  }
  if (!target.ground) return [];
  if (state.canCommand === false || boxMode || movers.length === 0)
    return selectedIds.length > 0 && !additive ? ["clear"] : [];
  return ["move", "attack-move"];
}

const CONTEXT_LABELS: Record<ContextActionKind, string> = {
  tend: "Tend",
  attack: "Attack",
  select: "Select",
  add: "Add to group",
  remove: "Remove from group",
  move: "Move",
  "attack-move": "Attack Move",
  clear: "Clear selection",
  focus: "Focus",
  follow: "Follow",
};

export type CommandInputOptions = {
  actorIdForMesh: (mesh: AbstractMesh | null) => string | undefined;
  /** Maps clickable world objects to ground destinations. */
  movementTargetForMesh?: (
    mesh: AbstractMesh | null,
  ) => WorldPosition | undefined;
  actorIdsInRect: (rect: SelectionRect) => string[];
  submitCommand: (
    command:
      | ActorCommand
      | GroupMoveCommand
      | AttackCommand
      | AttackMoveCommand
      | GroupAttackMoveCommand,
  ) => void;
  /** Names a move to this point, such as Gather or Collect. */
  moveLabel?: (target: WorldPosition) => string | undefined;
  /** Opens the radial menu for a secondary click; absent disables it. */
  onContextMenu?: (
    clientX: number,
    clientY: number,
    actions: readonly ContextAction[],
  ) => void;
  /** Submits a tend order for this unfinished growth, when one is possible. */
  tend?: (actorId: string) => (() => void) | undefined;
  /** Whether clicking this actor attacks it instead of selecting it. */
  canAttack?: (actorId: string) => boolean;
  /** Offers Focus on actors in the radial menu. */
  focusActor?: (actorId: string) => void;
  canFollow?: (actorId: string) => boolean;
  followActor?: (actorId: string) => void;
  /** Escape ends a camera focus or Follow before clearing selection. */
  cancelFocus?: () => boolean;
  onWorldSelectionChanged?: (actorIds: readonly string[]) => void;
  onSelectionChanged?: (actorIds: readonly string[]) => void;
  enabled?: () => boolean;
  /** Reserves primary world gestures for other tools; checked at press. */
  pointerEnabled?: () => boolean;
  groundTargetMode?: () => boolean;
  /** `queued` when Shift or Queue Orders mode appends the order. */
  onGroundTarget?: (target: WorldPosition, queued: boolean) => void;
  cancelGroundTarget?: () => boolean;
  canMove?: (actorId: string) => boolean;
  /** Whether an actor still exists and is visible to the player. */
  canSelect?: (actorId: string) => boolean;
  /** Inspection permits selection without offering simulation commands. */
  canCommand?: () => boolean;
};

export type CommandInput = {
  readonly selectedActorId: string | undefined;
  readonly selectedActorIds: readonly string[];
  readonly boxMode: boolean;
  readonly additiveMode: boolean;
  /** Appends world commands to the selection's order queues, like Shift. */
  readonly queueMode: boolean;
  setBoxMode: (active: boolean) => void;
  setAdditiveMode: (active: boolean) => void;
  setQueueMode: (active: boolean) => void;
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
    pointerEnabled = () => true,
    canMove = () => true,
    canSelect = () => true,
    canCommand = () => true,
    canAttack = () => false,
    tend,
    groundTargetMode = () => false,
    onGroundTarget,
    cancelGroundTarget,
    moveLabel = () => undefined,
    onContextMenu,
    focusActor,
    canFollow = () => false,
    followActor,
    cancelFocus,
  }: CommandInputOptions,
): CommandInput {
  const selection = createSelection(canMove);
  let boxMode = false;
  let additiveMode = false;
  let queueMode = false;
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
    enabled: () => enabled() && worldInputAvailable(canvas.ownerDocument),
    start: (event) => {
      const secondary =
        event.button === 2 && !!onContextMenu && !groundTargetMode();
      // Pan mode reserves only primary gestures.
      if (!secondary && (event.button !== 0 || !pointerEnabled()))
        return undefined;
      canvas.focus({ preventScroll: true });
      return {
        secondary,
        box:
          !secondary &&
          !groundTargetMode() &&
          (event.pointerType !== "touch" || boxMode),
        additive: !secondary && (event.shiftKey || additiveMode),
        queued: event.shiftKey || queueMode,
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
      const { additive, box, secondary, queued } = gesture.data;
      // A secondary drag pans the camera instead.
      if (secondary && gesture.dragged) return;
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
        if (target) onGroundTarget?.(target, queued);
        return;
      }
      const actions = contextActions(picked, target, additive, queued);
      if (secondary) {
        if (actions.length)
          onContextMenu?.(event.clientX, event.clientY, actions);
      } else if (actions.length) actions[0]!.run();
      else if (target) onWorldSelectionChanged?.(selection.ids);
    },
  });
  const contextActions = (
    picked: string | undefined,
    target: WorldPosition | undefined,
    additive: boolean,
    queued: boolean,
  ): ContextAction[] => {
    const movers = selection.ids.filter(canMove);
    const kinds = contextActionKinds(
      { actorId: picked, ground: !!target },
      {
        selectedIds: selection.ids,
        movers,
        boxMode,
        additive,
        canAttack,
        canMove,
        canCommand: canCommand(),
      },
    );
    const tendAction =
      picked && !additive && !boxMode && canCommand()
        ? tend?.(picked)
        : undefined;
    if (tendAction) kinds.unshift("tend");
    // Camera actions follow the commands, so they are never the default.
    if (picked && !additive && focusActor) {
      kinds.push("focus");
      if (followActor && canFollow(picked)) kinds.push("follow");
    }
    const choose = (id: string | undefined, add: boolean) => {
      if (id && !canSelect(id)) return;
      select(id, add);
      onWorldSelectionChanged?.(selection.ids);
    };
    const currentMovers = () =>
      movers.filter((id) => selection.ids.includes(id) && canMove(id));
    const order = (kind: "move" | "attack-move") => {
      const actorIds = currentMovers();
      if (!canCommand() || !actorIds.length) return;
      submitCommand(moveCommand(kind, actorIds, target!, queued));
    };
    const runs: Record<ContextActionKind, () => void> = {
      tend: () => {
        if (canCommand()) tendAction?.();
      },
      attack: () => {
        if (!canCommand() || !canAttack(picked!)) return;
        for (const actorId of currentMovers())
          submitCommand({
            kind: "attack",
            actorId,
            targetId: picked!,
            ...(queued && { queued }),
          });
      },
      select: () => choose(picked, false),
      add: () => {
        if (!selection.ids.includes(picked!)) choose(picked, true);
      },
      remove: () => {
        if (selection.ids.includes(picked!)) choose(picked, true);
      },
      move: () => order("move"),
      "attack-move": () => order("attack-move"),
      clear: () => choose(undefined, false),
      focus: () => focusActor?.(picked!),
      follow: () => followActor?.(picked!),
    };
    return kinds.map((kind) => ({
      kind,
      label:
        (kind === "move" && target && moveLabel(target)) ||
        CONTEXT_LABELS[kind],
      run: () => {
        if (enabled() && worldInputAvailable(canvas.ownerDocument))
          runs[kind]();
      },
    }));
  };
  const cancelGesture = pointer.cancel;
  const stop = () => {
    if (!enabled() || !canCommand()) return 0;
    cancelGroundTarget?.();
    const ids = selection.ids.filter(canMove);
    for (const actorId of ids) submitCommand({ kind: "stop", actorId });
    return ids.length;
  };
  const key = (event: KeyboardEvent) => {
    if (
      !enabled() ||
      !worldInputAvailable(canvas.ownerDocument) ||
      event.defaultPrevented ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey
    )
      return;
    if (isTextEntry(event.target)) return;
    if (event.key === "Escape" && (cancelGroundTarget?.() || cancelFocus?.())) {
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
    get queueMode() {
      return queueMode;
    },
    setBoxMode: (active) => {
      if (active) cancelGroundTarget?.();
      cancelGesture();
      boxMode = active;
    },
    setAdditiveMode: (active) => {
      additiveMode = active;
    },
    setQueueMode: (active) => {
      queueMode = active;
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
