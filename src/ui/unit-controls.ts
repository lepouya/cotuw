import type { CommandInput } from "../render/command-input";
import type { CommandOutcome } from "../simulation/command";
import type { MissionSimulation } from "../simulation/mission";

export type UnitControls = {
  boxSelect?: HTMLButtonElement;
  addSelection?: HTMLButtonElement;
  stop?: HTMLButtonElement;
  clearSelection?: HTMLButtonElement;
  movementStatus?: HTMLElement;
};

/** Binds selection actions and reports receipts for committed move orders. */
export function createUnitControls(
  input: CommandInput,
  simulation: MissionSimulation,
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
    onOutcomes: (outcomes: readonly CommandOutcome[]) => {
      const moves = outcomes.filter(
        (outcome) => outcome.command.kind === "move",
      );
      if (moves.length) {
        const accepted = moves.filter((outcome) => outcome.accepted).length;
        const blocked = moves.filter(
          ({ command, accepted }) =>
            command.kind === "move" &&
            accepted &&
            (command.requestedTarget ||
              simulation.actorById(command.actorId)?.movement?.reachedTarget ===
                false),
        ).length;
        message(
          [
            `${accepted} move orders accepted`,
            ...(blocked ? [`${blocked} blocked destinations`] : []),
            ...(accepted < moves.length
              ? [`${moves.length - accepted} unable to move`]
              : []),
          ].join(" · ") + ".",
        );
      }
      if (
        outcomes.some(
          ({ command, accepted }) => command.kind === "stop" && accepted,
        )
      )
        message("Selected units stopped.");
    },
    dispose: () => controller.abort(),
  };
}
