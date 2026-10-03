import type { MissionSimulation } from "../simulation/mission";
import type { WorldPosition } from "../simulation/world";
import type { CommandOutcome } from "../simulation/command";

export type RallyControls = {
  rallyRoot?: HTMLElement;
};

export function createRallyControls(
  simulation: MissionSimulation,
  controls: RallyControls,
  options: {
    selectedActorId: () => string | undefined;
    isProducer: (definitionId: string) => boolean;
    enabled: () => boolean;
    onStart: () => void;
    changed: () => void;
  },
) {
  const root = controls.rallyRoot;
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
  root?.addEventListener(
    "click",
    (event) => {
      if (!(event.target instanceof Element) || !options.enabled()) return;
      const button = event.target.closest<HTMLButtonElement>(
        "[data-rally-action]",
      );
      if (!button || button.disabled) return;
      const id = options.selectedActorId();
      if (button.dataset.rallyAction === "cancel") cancel();
      else if (id && button.dataset.rallyAction === "set") {
        options.onStart();
        choosingFor = id;
        result = "";
        options.changed();
      } else if (id && button.dataset.rallyAction === "clear") {
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
      if (!choosingFor) return;
      if (!simulation.evaluateRallyPoint(choosingFor, target)) {
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
      const id = options.selectedActorId();
      const actor = id && simulation.actorById(id);
      const producer = !!actor && options.isProducer(actor.definitionId);
      if (id !== knownSelection) {
        result = "";
        knownSelection = id;
      }
      if (choosingFor && (!options.enabled() || choosingFor !== id)) cancel();
      for (const section of root?.querySelectorAll<HTMLElement>(
        "[data-rally-controls]",
      ) ?? []) {
        section.hidden = !producer;
        for (const button of section.querySelectorAll<HTMLButtonElement>(
          "[data-rally-action]",
        )) {
          const action = button.dataset.rallyAction;
          button.hidden = action === "cancel" && !choosingFor;
          button.disabled =
            !options.enabled() ||
            (action === "clear" && (!actor || !actor.rallyPoint));
        }
        const status = section.querySelector<HTMLElement>(
          "[data-rally-status]",
        )!;
        status.textContent =
          result ||
          (choosingFor
            ? "Click or tap explored, passable ground. Cancel or Esc exits."
            : actor && actor.rallyPoint
              ? "New units move to the marked rally point."
              : "New units exit and idle beside this building.");
      }
    },
    onOutcome: (outcome: CommandOutcome) => {
      if (
        outcome.command.kind === "set-rally-point" &&
        outcome.command.actorId === options.selectedActorId()
      )
        result = outcome.accepted
          ? ""
          : "Rally point rejected. Choose explored, clear, passable ground.";
    },
    dispose: () => controller.abort(),
  };
}
