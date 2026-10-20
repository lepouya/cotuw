import type { MissionResult, ObjectiveView } from "../simulation/objectives";
import type { GameSession } from "../session";
import type { SidebarState } from "./sidebar";
import { setText } from "./dom";

export type TopBarState = {
  /** Whether a mission is running and can resume. */
  canPlay: boolean;
  playing: boolean;
  speed: number;
  elapsedSeconds: number;
  materials?: number;
  objectives: readonly ObjectiveView[];
  result?: MissionResult;
};

/** Top bar state for a session's committed state, or for no mission. */
export function topBarState(
  session: Pick<GameSession, "playing" | "speed" | "simulation"> | undefined,
  state?: SidebarState,
): TopBarState {
  return {
    canPlay: !!session && !!state && !state.faulted,
    playing: session?.playing() ?? false,
    speed: session?.speed() ?? 1,
    elapsedSeconds: session
      ? session.simulation.completedTicks * session.simulation.tickSeconds
      : 0,
    materials: state?.materials,
    objectives: state?.objectives ?? [],
    result: state?.result,
  };
}

export function formatElapsed(seconds: number) {
  const whole = Math.floor(seconds);
  const [hours, minutes] = [Math.floor(whole / 3600), Math.floor(whole / 60)];
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours
    ? `${hours}:${pad(minutes % 60)}:${pad(whole % 60)}`
    : `${minutes}:${pad(whole % 60)}`;
}

/** The compact objective line: the result, or the first unfinished goal. */
export function objectiveSummary(
  objectives: readonly ObjectiveView[],
  result?: MissionResult,
): string {
  if (result?.kind === "victory") return "Victory · free play";
  if (result?.kind === "defeat") return "Mission failed";
  const goals = objectives.filter(({ progress }) => progress);
  const next = goals.find(({ status }) => status === "active");
  if (!next) return "";
  const { current, total } = next.progress!;
  return `${next.label} ${current}/${total}`;
}

/** Binds the pause, speed, and objective controls and shows mission status. */
export function createTopBar(
  root: HTMLElement,
  actions: {
    togglePause: () => void;
    setSpeed: (speed: number) => void;
    showObjectives: () => void;
  },
) {
  const element = <T extends HTMLElement>(id: string) =>
    root.querySelector<T>(`#${id}`)!;
  const pause = element<HTMLButtonElement>("pause-mission");
  const speeds = [
    ...root.querySelectorAll<HTMLButtonElement>("[data-speed]"),
  ].map((button) => ({ button, speed: Number(button.dataset.speed) }));
  const objective = element<HTMLButtonElement>("objective-summary");
  const objectiveText = element("objective-text");
  const time = element("mission-time");
  const resource = element("resource-bar");
  const materials = element("materials-counter");
  pause.addEventListener("click", actions.togglePause);
  for (const { button, speed } of speeds)
    button.addEventListener("click", () => actions.setSpeed(speed));
  objective.addEventListener("click", actions.showObjectives);
  return {
    update: (state: TopBarState) => {
      const paused = !state.playing;
      pause.disabled = !state.canPlay;
      pause.setAttribute("aria-pressed", String(paused));
      setText(pause, paused ? "▶ Paused" : "⏸ Pause");
      for (const { button, speed } of speeds) {
        button.disabled = !state.canPlay;
        button.setAttribute("aria-pressed", String(speed === state.speed));
      }
      setText(time, formatElapsed(state.elapsedSeconds));
      resource.hidden = state.materials === undefined;
      setText(materials, String(state.materials ?? 0));
      const resourceLabel = `${state.materials ?? 0} Materials`;
      if (resource.getAttribute("aria-label") !== resourceLabel)
        resource.setAttribute("aria-label", resourceLabel);
      const summary = objectiveSummary(state.objectives, state.result);
      objective.hidden = !summary;
      setText(objectiveText, summary);
      objective.title = summary ? `${summary} · Show objectives` : "";
      objective.setAttribute("aria-label", objective.title);
      objective.dataset.result = state.result?.kind ?? "";
    },
  };
}
