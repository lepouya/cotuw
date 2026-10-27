import { isOutcomeOf } from "../simulation/command";
import { PRODUCTION_QUEUE_LIMIT } from "../simulation/economy";
import { productionBlocker, setActionAvailability } from "./production-action";
import { setText } from "./dom";

import type { MissionSimulation } from "../simulation/mission";
import type {
  AuthorityReason,
  CommandOutcome,
  TrainUnitCommand,
} from "../simulation/command";
import type {
  TrainingEvaluation,
  TrainingReason,
} from "../simulation/production";
import type { DefinitionButton } from "./production-action";

export type UnitTrainingControls = {
  train?: readonly DefinitionButton[];
  productionStatus?: HTMLElement;
};

const REASONS: Record<TrainingReason | AuthorityReason, string> = {
  unauthorized: "You cannot command this building.",
  disconnected: "Disconnected. Restore a support path to the Command Center.",
  "invalid-actor": "Invalid unit request.",
  "used-id": "Unit request changed. Try again.",
  "missing-producer": "Select a production building on the map to train units.",
  "unsupported-unit": "This building cannot train these units.",
  "exit-blocked":
    "Exit blocked. Move units or clear ground beside the building.",
  "insufficient-resources": "Not enough resources for this unit.",
  "refinery-occupied": "This Refinery already has a Harvester or a paid order.",
  "under-construction": "Wait for this building to finish construction.",
  "queue-full": `Production queue full (${PRODUCTION_QUEUE_LIMIT} orders).`,
};

/** Local pending feedback; the simulation rechecks every submitted request. */
export function createUnitTraining(
  simulation: Pick<
    MissionSimulation,
    | "result"
    | "economy"
    | "unusedActorId"
    | "evaluateTraining"
    | "submitCommand"
  >,
  controls: UnitTrainingControls,
  options: {
    names: ReadonlyMap<string, string>;
    selectedActorId: () => string | undefined;
    unitDefinitionIds: () => readonly string[];
    enabled: () => boolean;
    paused?: () => boolean;
  },
) {
  const buttons = controls.train ?? [];
  let faulted = false;
  let pending: TrainUnitCommand | undefined;
  let result: { producerId: string; text: string } | undefined;
  const message = (text: string) => setText(controls.productionStatus, text);
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
      // Placement is the remaining reason `enabled` can be false.
      const reason = productionBlocker(
        {
          defeated: simulation.result?.kind === "defeat",
          faulted,
          paused: !!options.paused?.(),
          placing: true,
        },
        "train units",
      );
      for (const action of buttons) setActionAvailability(action, reason);
      message(reason);
      return;
    }
    const trainable = new Set(options.unitDefinitionIds());
    // Units the selection cannot train are not evaluated or reported.
    const relevant: TrainingEvaluation[] = [];
    for (const action of buttons) {
      const evaluation = trainable.has(action.definitionId)
        ? evaluate(action.definitionId)
        : undefined;
      if (evaluation) relevant.push(evaluation);
      setActionAvailability(
        action,
        pending
          ? "Waiting for the training order to be confirmed."
          : !evaluation
            ? REASONS["unsupported-unit"]
            : evaluation.accepted
              ? ""
              : REASONS[evaluation.reason],
      );
    }
    const availability: TrainingEvaluation = relevant.find(
      ({ accepted }) => accepted,
    ) ??
      relevant.find(
        (value) => !value.accepted && value.reason === "exit-blocked",
      ) ??
      relevant[0] ?? { accepted: false, reason: "missing-producer" };
    const currentResult =
      result && result.producerId === options.selectedActorId()
        ? result.text
        : undefined;
    message(
      pending && pending.producerId === options.selectedActorId()
        ? `Training ${options.names.get(pending.definitionId) ?? pending.definitionId}…`
        : !availability.accepted
          ? REASONS[availability.reason]
          : (currentResult ??
            (simulation.economy
              ? "Queue a unit. Resources are paid now; cancel for a full refund."
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
