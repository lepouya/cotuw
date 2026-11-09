import { moveCommand } from "../simulation/command";
import { setText } from "./dom";

import type { MissionSimulation } from "../simulation/mission";
import type { OwnerView } from "../simulation/owner-view";
import type { WorldPosition } from "../simulation/world";

export type AttackMoveControls = {
  attackMove?: HTMLButtonElement;
  cancelAttackMove?: HTMLButtonElement;
  movementStatus?: HTMLElement;
};

export function createAttackMoveControls(
  simulation: Pick<MissionSimulation, "submitCommand">,
  player: Pick<OwnerView, "owner">,
  controls: AttackMoveControls,
  options: {
    selectedMobileIds: () => readonly string[];
    enabled: () => boolean;
    onStart: () => void;
    changed: () => void;
  },
) {
  const controller = new AbortController();
  let choosingFor: string[] = [];
  const message = (text: string) => setText(controls.movementStatus, text);
  const cancel = () => {
    if (!choosingFor.length) return false;
    choosingFor = [];
    message("Attack Move cancelled.");
    options.changed();
    return true;
  };
  controls.attackMove?.addEventListener(
    "click",
    () => {
      if (!options.enabled()) return;
      const ids = options.selectedMobileIds();
      if (!ids.length) return;
      options.onStart();
      choosingFor = [...ids];
      message(
        "Click or tap a destination to advance and engage. Cancel or Esc exits.",
      );
      options.changed();
    },
    { signal: controller.signal },
  );
  controls.cancelAttackMove?.addEventListener("click", cancel, {
    signal: controller.signal,
  });
  return {
    get active() {
      return choosingFor.length > 0;
    },
    cancel,
    /** A queued target keeps the mode open for further waypoints. */
    choose: (target: WorldPosition, queued = false) => {
      if (!choosingFor.length || !options.enabled()) return;
      simulation.submitCommand(
        moveCommand("attack-move", choosingFor, target, queued),
        { owner: player.owner },
      );
      if (queued) message("Attack Move queued. Choose another or Cancel.");
      else {
        choosingFor = [];
        message("Attack Move submitted.");
      }
      options.changed();
    },
    refresh: () => {
      const ids = options.selectedMobileIds();
      const reselected =
        ids.length !== choosingFor.length ||
        ids.some((id, index) => id !== choosingFor[index]);
      if (choosingFor.length && (!options.enabled() || reselected)) cancel();
      if (controls.attackMove) {
        controls.attackMove.hidden = !ids.length;
        controls.attackMove.disabled = !options.enabled();
        controls.attackMove.setAttribute(
          "aria-pressed",
          String(choosingFor.length > 0),
        );
      }
      if (controls.cancelAttackMove)
        controls.cancelAttackMove.hidden = !choosingFor.length;
    },
    dispose: () => controller.abort(),
  };
}
