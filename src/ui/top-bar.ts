import { formatElapsed } from "../format-time";
import { missionEnded } from "../simulation/mission-result";
import { resourceName } from "../simulation/resources";
import { mountFeature, setText } from "./dom";
import { presentResult } from "./mission-result";
import markup from "./top-bar.html?raw";
import type { MissionResult } from "../simulation/mission-result";
import type { ObjectiveView } from "../simulation/objectives";
import type { Resource } from "../simulation/resources";
import "./top-bar.css";

/** The running mission's status. */
export type TopBarState = {
  faulted: boolean;
  paused?: boolean;
  speed: number;
  elapsedSeconds: number;
  /** Present when the mission has an economy. */
  balances?: Partial<Record<Resource, number>>;
  /** The player's spending resource. */
  resource?: Resource;
  objectives?: readonly ObjectiveView[];
  result?: MissionResult;
};

/** The compact objective line: the result, or the first unfinished goal. */
export function objectiveSummary(
  objectives: readonly ObjectiveView[],
  result?: MissionResult,
): string {
  if (result) return presentResult(result).summary;
  const next = objectives.find(
    ({ progress, status }) => progress && status === "active",
  );
  if (!next?.progress) return "";
  const { current, total } = next.progress;
  return `${next.label} ${current}/${total}`;
}

/**
 * Mounts the menu, pause, speed, and objective controls and mission status in
 * `root`. Hosts the notification feature's `alertToggle`.
 */
export function createTopBar(
  root: HTMLElement,
  options: {
    openMenu: () => void;
    togglePause: () => void;
    setSpeed: (speed: number) => void;
    showObjectives: () => void;
    alertToggle: HTMLElement;
  },
) {
  return mountFeature(root, markup, ({ element, signal }) => {
    const pause = element<HTMLButtonElement>("pause-mission");
    const speeds = [
      ...root.querySelectorAll<HTMLButtonElement>("[data-speed]"),
    ].map((button) => ({ button, speed: Number(button.dataset.speed) }));
    const objective = element<HTMLButtonElement>("objective-summary");
    const objectiveText = element("objective-text");
    const time = element("mission-time");
    const resource = element("resource-bar");
    const resourceLabel =
      resource.querySelector<HTMLElement>(".resource-name")!;
    const balanceText = element("materials-counter");
    element("top-bar-status").append(options.alertToggle);
    element("open-menu").addEventListener("click", options.openMenu, {
      signal,
    });
    pause.addEventListener("click", options.togglePause, { signal });
    for (const { button, speed } of speeds)
      button.addEventListener("click", () => options.setSpeed(speed), {
        signal,
      });
    objective.addEventListener("click", options.showObjectives, { signal });
    return {
      /** Shows a mission's status, or the idle bar without one. */
      update: (state?: TopBarState) => {
        const canPlay =
          !!state && !state.faulted && !missionEnded(state.result);
        const paused = !state || !!state.paused;
        pause.disabled = !canPlay;
        pause.setAttribute("aria-pressed", String(paused));
        setText(pause, paused ? "▶ Paused" : "⏸ Pause");
        for (const { button, speed } of speeds) {
          button.disabled = !canPlay;
          button.setAttribute(
            "aria-pressed",
            String(speed === (state?.speed ?? 1)),
          );
        }
        setText(time, formatElapsed(state?.elapsedSeconds ?? 0));
        const spending = state?.resource;
        const name = spending ? resourceName(spending) : "";
        const balance = (spending && state.balances?.[spending]) ?? 0;
        resource.hidden = !spending;
        setText(resourceLabel, name);
        resource.title = name;
        setText(balanceText, String(balance));
        const label = `${balance} ${name}`;
        if (resource.getAttribute("aria-label") !== label)
          resource.setAttribute("aria-label", label);
        const summary = objectiveSummary(
          state?.objectives ?? [],
          state?.result,
        );
        objective.hidden = !summary;
        setText(objectiveText, summary);
        objective.title = summary ? `${summary} · Show objectives` : "";
        objective.setAttribute("aria-label", objective.title);
        objective.dataset.result = state?.result?.kind ?? "";
      },
    };
  });
}
