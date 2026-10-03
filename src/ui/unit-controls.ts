import { isOutcomeOf } from "../simulation/command";

import type { CommandInput } from "../render/command-input";
import type { CommandOutcome } from "../simulation/command";

export type UnitControls = {
  boxSelect?: HTMLButtonElement;
  addSelection?: HTMLButtonElement;
  stop?: HTMLButtonElement;
  clearSelection?: HTMLButtonElement;
  movementStatus?: HTMLElement;
};

export type MoveStatus = "accepted" | "partial" | "unreachable";

/** Binds selection actions and reports receipts for committed move orders. */
export function createUnitControls(
  input: Pick<
    CommandInput,
    | "boxMode"
    | "additiveMode"
    | "setBoxMode"
    | "setAdditiveMode"
    | "stop"
    | "select"
  >,
  controls: UnitControls,
  options: { enabled: () => boolean; changed: () => void },
) {
  const controller = new AbortController();
  const message = (text: string) => {
    if (controls.movementStatus) controls.movementStatus.textContent = text;
  };
  const listen = (button: HTMLButtonElement | undefined, action: () => void) =>
    button?.addEventListener(
      "click",
      () => {
        if (!options.enabled()) return;
        action();
        options.changed();
      },
      { signal: controller.signal },
    );
  listen(controls.boxSelect, () => {
    input.setBoxMode(!input.boxMode);
    message(
      input.boxMode
        ? "Drag a box to select. Turn off Box select to issue moves."
        : "Tap or click terrain to move selected units.",
    );
  });
  listen(controls.addSelection, () =>
    input.setAdditiveMode(!input.additiveMode),
  );
  listen(controls.stop, input.stop);
  listen(controls.clearSelection, () => input.select(undefined));
  return {
    /** Reports this tick's move receipts and returns their overall status. */
    onOutcomes: (
      outcomes: readonly CommandOutcome[],
    ): MoveStatus | undefined => {
      const moves = outcomes.filter((outcome) =>
        isOutcomeOf(outcome, "move", "attack-move"),
      );
      const stops = outcomes.filter(
        ({ command, accepted }) => command.kind === "stop" && accepted,
      ).length;
      let status: MoveStatus | undefined;
      if (moves.length) {
        const accepted = moves.filter((outcome) => outcome.accepted);
        const blocked = accepted.filter(
          ({ reachedTarget }) => reachedTarget === false,
        ).length;
        const rejected = moves.length - accepted.length;
        const order = isOutcomeOf(moves[0]!, "attack-move")
          ? "Attack Move order"
          : "move order";
        message(
          [
            `${count(accepted.length, order)} accepted`,
            ...(blocked ? [count(blocked, "blocked destination")] : []),
            ...(rejected ? [`${count(rejected, "unit")} unable to move`] : []),
            ...(stops ? [`${count(stops, "stop order")} accepted`] : []),
          ].join(" · ") + ".",
        );
        status =
          accepted.length === 0
            ? "unreachable"
            : rejected === 0
              ? "accepted"
              : "partial";
      } else if (stops) message("Selected units stopped.");
      const attacks = outcomes.filter((outcome) =>
        isOutcomeOf(outcome, "attack"),
      );
      if (attacks.length) {
        const accepted = attacks.filter((outcome) => outcome.accepted).length;
        const unarmed = attacks.filter(
          ({ reason }) => reason === "unarmed",
        ).length;
        const other = attacks.length - accepted - unarmed;
        message(
          [
            ...(accepted ? [`${count(accepted, "unit")} attacking`] : []),
            ...(unarmed ? [`${count(unarmed, "unit")} cannot attack`] : []),
            ...(other ? ["The target cannot be attacked"] : []),
          ].join(" · ") + ".",
        );
      }
      return status;
    },
    dispose: () => controller.abort(),
  };
}

function count(amount: number, noun: string): string {
  return `${amount} ${noun}${amount === 1 ? "" : "s"}`;
}
