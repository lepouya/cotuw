import { isOutcomeOf } from "../simulation/command";
import { PRODUCTION_QUEUE_LIMIT } from "../simulation/economy";

import type { MissionSimulation } from "../simulation/mission";
import type { CommandOutcome, TrainUnitCommand } from "../simulation/command";
import type { TrainingReason } from "../simulation/production";
import type { DefinitionButton } from "./sidebar";

export type UnitTrainingControls = {
  train?: readonly DefinitionButton[];
  productionStatus?: HTMLElement;
};

const REASONS: Record<TrainingReason, string> = {
  disconnected: "Disconnected. Restore a support path to the Command Center.",
  "invalid-actor": "Invalid unit request.",
  "used-id": "Unit request changed. Try again.",
  "missing-producer": "Select a production building to train units.",
  "unsupported-unit": "This building cannot train these units.",
  "exit-blocked":
    "Exit blocked. Move units or clear ground beside the building.",
  "insufficient-materials": "Not enough Materials for this unit.",
  "refinery-occupied": "This Refinery already has a Harvester or a paid order.",
  "under-construction": "Wait for this building to finish construction.",
  "queue-full": `Production queue full (${PRODUCTION_QUEUE_LIMIT} orders).`,
};

/** Local pending feedback; the simulation rechecks every submitted request. */
export function createUnitTraining(
  simulation: MissionSimulation,
  controls: UnitTrainingControls,
  options: {
    names: ReadonlyMap<string, string>;
    selectedActorId: () => string | undefined;
    enabled: () => boolean;
  },
) {
  const buttons = controls.train ?? [];
  let faulted = false;
  let pending: TrainUnitCommand | undefined;
  let result: { producerId: string; text: string } | undefined;
  const message = (text: string) => {
    if (
      controls.productionStatus &&
      controls.productionStatus.textContent !== text
    )
      controls.productionStatus.textContent = text;
  };
  const commandFor = (definitionId: string): TrainUnitCommand => ({
    kind: "train-unit",
    actorId: simulation.unusedActorId("trained-unit-"),
    producerId: options.selectedActorId() ?? "",
    definitionId,
  });
  const evaluate = (definitionId: string) =>
    simulation.evaluateTraining(commandFor(definitionId));
  const refresh = () => {
    if (faulted || !options.enabled()) {
      for (const { button } of buttons) button.disabled = true;
      message(
        faulted
          ? "Simulation stopped. Reload to continue."
          : "Finish or cancel building placement to train units.",
      );
      return;
    }
    const evaluations = new Map(
      buttons.map(({ definitionId }) => [definitionId, evaluate(definitionId)]),
    );
    for (const { definitionId, button } of buttons)
      button.disabled = !!pending || !evaluations.get(definitionId)!.accepted;
    const values = [...evaluations.values()];
    const availability =
      values.find(({ accepted }) => accepted) ??
      values.find(
        (value) => !value.accepted && value.reason === "exit-blocked",
      ) ??
      values.find(
        (value) => !value.accepted && value.reason !== "unsupported-unit",
      ) ??
      values[0];
    const currentResult =
      result && result.producerId === options.selectedActorId()
        ? result.text
        : undefined;
    message(
      pending && pending.producerId === options.selectedActorId()
        ? `Training ${options.names.get(pending.definitionId) ?? pending.definitionId}…`
        : availability && !availability.accepted
          ? REASONS[availability.reason]
          : (currentResult ??
            (simulation.economy
              ? "Queue a unit. Materials are paid now; cancel for a full refund."
              : "Train a unit. It will appear beside this building.")),
    );
  };
  const listeners = buttons.map(({ definitionId, button }) => {
    const train = () => {
      if (faulted || !options.enabled() || pending) return;
      const command = commandFor(definitionId);
      const evaluation = simulation.evaluateTraining(command);
      if (!evaluation.accepted) {
        result = {
          producerId: command.producerId,
          text: REASONS[evaluation.reason],
        };
      } else {
        simulation.submitCommand(command);
        pending = command;
      }
      refresh();
    };
    button.addEventListener("click", train);
    return () => button.removeEventListener("click", train);
  });
  return {
    refresh,
    onOutcome: (outcome: CommandOutcome) => {
      if (
        !isOutcomeOf(outcome, "train-unit") ||
        outcome.command.actorId !== pending?.actorId
      )
        return;
      const { command, accepted, reason } = outcome;
      pending = undefined;
      result = {
        producerId: command.producerId,
        text: accepted
          ? simulation.economy
            ? `${options.names.get(command.definitionId) ?? command.definitionId} queued. Select this building to view or cancel production.`
            : `${options.names.get(command.definitionId) ?? command.definitionId} ready beside the building.`
          : REASONS[reason ?? "invalid-actor"],
      };
    },
    fault: () => {
      faulted = true;
      pending = undefined;
      refresh();
    },
    dispose: () => {
      for (const remove of listeners) remove();
    },
  };
}
