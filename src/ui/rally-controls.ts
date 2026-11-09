import { setText } from "./dom";

import type { ActorRenderState } from "../simulation/actor";
import type { CommandOutcome } from "../simulation/command";
import type { MissionSimulation } from "../simulation/mission";
import type { OwnerView } from "../simulation/owner-view";
import type { WorldPosition } from "../simulation/world";

export type RallyControls = {
  rally?: {
    section: HTMLElement;
    set: HTMLButtonElement;
    clear: HTMLButtonElement;
    cancel: HTMLButtonElement;
    status: HTMLElement;
  };
};

const RALLY_ACTIONS = ["set", "clear", "cancel"] as const;

export function createRallyControls(
  simulation: Pick<MissionSimulation, "submitCommand">,
  player: Pick<OwnerView, "evaluateRallyPoint">,
  controls: RallyControls,
  options: {
    /** The selected building the player controls. */
    selectedActor: () =>
      Pick<ActorRenderState, "id" | "definitionId" | "rallyPoint"> | undefined;
    isProducer: (definitionId: string) => boolean;
    enabled: () => boolean;
    onStart: () => void;
    changed: () => void;
  },
) {
  const elements = controls.rally;
  const controller = new AbortController();
  let choosingFor: string | undefined;
  let result = "";
  let knownSelection: string | undefined;
  const cancel = () => {
    const active = choosingFor !== undefined;
    choosingFor = undefined;
    result = "";
    if (active) options.changed();
    return active;
  };
  for (const action of RALLY_ACTIONS)
    elements?.[action].addEventListener(
      "click",
      () => {
        if (!options.enabled()) return;
        const id = options.selectedActor()?.id;
        if (action === "cancel") cancel();
        else if (id && action === "set") {
          options.onStart();
          choosingFor = id;
          result = "";
          options.changed();
        } else if (id && action === "clear") {
          cancel();
          simulation.submitCommand({ kind: "set-rally-point", actorId: id });
        }
      },
      { signal: controller.signal },
    );
  return {
    get active() {
      return choosingFor !== undefined;
    },
    cancel,
    choose: (target: WorldPosition) => {
      if (!choosingFor || !options.enabled()) return;
      if (!player.evaluateRallyPoint(choosingFor, target)) {
        result = "Choose passable ground clear of buildings.";
        options.changed();
        return;
      }
      simulation.submitCommand({
        kind: "set-rally-point",
        actorId: choosingFor,
        target,
      });
      cancel();
    },
    refresh: () => {
      const actor = options.selectedActor();
      const id = actor?.id;
      const producer = !!actor && options.isProducer(actor.definitionId);
      if (id !== knownSelection) {
        result = "";
        knownSelection = id;
      }
      if (choosingFor && (!options.enabled() || choosingFor !== id)) cancel();
      if (elements) {
        elements.section.hidden = !producer;
        for (const action of RALLY_ACTIONS) {
          const button = elements[action];
          button.hidden = action === "cancel" && !choosingFor;
          button.disabled =
            !options.enabled() || (action === "clear" && !actor?.rallyPoint);
        }
        setText(
          elements.status,
          result ||
            (choosingFor
              ? "Click or tap explored, passable ground. Cancel or Esc exits."
              : actor?.rallyPoint
                ? "New units move to the marked rally point."
                : "New units exit and idle beside this building."),
        );
      }
    },
    onOutcome: (outcome: CommandOutcome) => {
      if (
        outcome.command.kind === "set-rally-point" &&
        outcome.command.actorId === options.selectedActor()?.id
      )
        result = outcome.accepted
          ? ""
          : "Rally point rejected. Choose explored, clear, passable ground.";
    },
    dispose: () => controller.abort(),
  };
}
