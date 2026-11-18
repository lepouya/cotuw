import type { WorldTools } from "./world-tools";
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
    tools: WorldTools;
    changed: () => void;
  },
) {
  const controller = new AbortController();
  const active = () => options.tools.active === "attackMove";
  let choosingFor: string[] = [];
  const message = (text: string) => setText(controls.movementStatus, text);
  const selectionMatches = (ids: readonly string[]) =>
    ids.length === choosingFor.length &&
    ids.every((id, index) => id === choosingFor[index]);
  const end = () => {
    options.tools.end("attackMove");
    choosingFor = [];
  };
  const cancel = () => {
    if (!active()) return;
    end();
    message("Attack Move cancelled.");
    options.changed();
  };
  const start = () => {
    if (!options.enabled()) return false;
    const ids = options.selectedMobileIds();
    if (!ids.length) return false;
    if (!options.tools.activate("attackMove", cancel)) return false;
    options.onStart();
    choosingFor = [...ids];
    message(
      "Click or tap a destination to advance and engage. Cancel or Esc exits.",
    );
    options.changed();
    return true;
  };
  controls.attackMove?.addEventListener("click", start, {
    signal: controller.signal,
  });
  controls.cancelAttackMove?.addEventListener("click", cancel, {
    signal: controller.signal,
  });
  return {
    start,
    /** A queued target keeps the mode open for further waypoints. */
    choose: (target: WorldPosition, queued = false) => {
      if (!active()) return false;
      if (
        !options.enabled() ||
        !selectionMatches(options.selectedMobileIds())
      ) {
        cancel();
        return false;
      }
      simulation.submitCommand(
        moveCommand("attack-move", choosingFor, target, queued),
        { owner: player.owner },
      );
      if (queued) message("Attack Move queued. Choose another or Cancel.");
      else {
        end();
        message("Attack Move submitted.");
      }
      options.changed();
      return true;
    },
    refresh: () => {
      const ids = options.selectedMobileIds();
      if (active() && (!options.enabled() || !selectionMatches(ids))) cancel();
      if (controls.attackMove) {
        controls.attackMove.hidden = !ids.length;
        controls.attackMove.disabled = !options.enabled();
        controls.attackMove.setAttribute("aria-pressed", String(active()));
      }
      if (controls.cancelAttackMove)
        controls.cancelAttackMove.hidden = !active();
    },
    dispose: () => controller.abort(),
  };
}
