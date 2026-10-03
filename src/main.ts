import "./styles.css";
import {
  ECONOMY_ACTOR_DEFINITIONS,
  ECONOMY_SCENARIO,
} from "./content/economy-scenario";
import { createTerrainPrototype, loadMissionSave } from "./prototype";
import {
  PROTOTYPE_ACTOR_DEFINITIONS,
  PROTOTYPE_ACTOR_PRESENTATIONS,
  PROTOTYPE_GOALS,
  ECONOMY_GOALS,
} from "./prototype-content";
import { createSidebar } from "./ui/sidebar";

import type { MissionState } from "./simulation/mission";
import type { TerrainPrototype } from "./prototype";

const canvas = document.querySelector<HTMLCanvasElement>("#game-canvas")!;
const minimap = document.querySelector<HTMLCanvasElement>("#minimap")!;
let session: TerrainPrototype | undefined;
const sandbox = new URLSearchParams(location.search).has("sandbox");
const scenario = sandbox ? undefined : ECONOMY_SCENARIO;
const definitions = sandbox
  ? PROTOTYPE_ACTOR_DEFINITIONS
  : ECONOMY_ACTOR_DEFINITIONS;
if (!sandbox) {
  document.querySelector("#network-view-control")!.removeAttribute("hidden");
  document.querySelector("#resource-bar")!.removeAttribute("hidden");
  document.querySelector("#economy-overview")!.removeAttribute("hidden");
  document.querySelector("#scenario-label")!.textContent = "Materials economy";
  document.querySelector("#scenario-description")!.textContent =
    "Build a Refinery, produce its Harvester, gather Materials, then fund a Barracks and Troopers. A lone wolf roams the southern path. Protect the Command Center. No victory condition yet.";
  document.querySelector("#scenario-rules")!.textContent =
    "Paid construction · Timed production · Sell buildings for half their cost";
}
const dialog = document.querySelector<HTMLDialogElement>("#mission-result")!;
const title = document.querySelector<HTMLElement>("#mission-result-title")!;
const description = document.querySelector<HTMLElement>(
  "#mission-result-description",
)!;
const resultStatus = document.querySelector<HTMLElement>(
  "#mission-result-status",
)!;
const restart = document.querySelector<HTMLButtonElement>("#restart-mission")!;
const load = document.querySelector<HTMLButtonElement>("#load-mission")!;
const exit = document.querySelector<HTMLButtonElement>("#exit-mission")!;
const resume = document.querySelector<HTMLButtonElement>("#resume-mission")!;
const inspect = document.querySelector<HTMLButtonElement>(
  "#inspect-loaded-mission",
)!;
const resumeLoaded = document.querySelector<HTMLButtonElement>(
  "#resume-loaded-mission",
)!;
const file = document.querySelector<HTMLInputElement>("#mission-save-file")!;
let busy = false;
const showResult = (mode: "defeat" | "loaded" | "exit") => {
  title.textContent =
    mode === "defeat"
      ? "Defeat"
      : mode === "loaded"
        ? "Mission loaded"
        : "Mission ended";
  description.textContent =
    mode === "defeat"
      ? "Your Command Center was destroyed. The mission is paused."
      : mode === "loaded"
        ? "Inspect the saved mission, then resume when ready."
        : "Start a new mission or load a saved mission.";
  resume.hidden = mode !== "loaded";
  inspect.hidden = mode !== "loaded";
  resumeLoaded.hidden = mode !== "loaded";
  restart.textContent = mode === "exit" ? "Start mission" : "Restart";
  load.hidden = sandbox;
  exit.hidden = mode === "exit";
  resultStatus.textContent = "";
  if (!dialog.open) dialog.showModal();
};
dialog.addEventListener("cancel", (event) => event.preventDefault());

async function start(initialState?: MissionState) {
  if (busy) return;
  busy = true;
  for (const button of dialog.querySelectorAll<HTMLButtonElement>("button"))
    button.disabled = true;
  session?.dispose();
  session = undefined;
  dialog.close();
  resumeLoaded.hidden = true;
  delete canvas.dataset.missionResult;
  delete canvas.dataset.terrainReady;
  delete canvas.dataset.simulationFault;
  const sidebar = createSidebar(
    document.querySelector<HTMLElement>("#game-sidebar")!,
    {
      definitions,
      economy: !sandbox,
      presentations: PROTOTYPE_ACTOR_PRESENTATIONS,
      goals: sandbox ? PROTOTYPE_GOALS : ECONOMY_GOALS,
      playerFaction: scenario?.playerFaction,
      selectActor: (id, additive) => session?.selectActor(id, additive),
    },
  );
  try {
    session = await createTerrainPrototype(canvas, minimap, {
      ...sidebar.controls,
      scenario,
      initialState,
      startPaused: initialState !== undefined,
      cameraControls: document.querySelector<HTMLElement>("#camera-controls")!,
      onStateChanged: sidebar.update,
      showActor: sidebar.showActor,
      onDispose: sidebar.dispose,
      onDefeat: () => showResult("defeat"),
      onReady: (ready) => {
        session = ready;
      },
    });
    if (initialState && !session.simulation.result) showResult("loaded");
  } catch (error) {
    sidebar.dispose();
    console.error("The prototype failed to start.", error);
    showResult("exit");
    resultStatus.textContent = "The mission could not start. Try restarting.";
  } finally {
    busy = false;
    for (const button of dialog.querySelectorAll<HTMLButtonElement>("button"))
      button.disabled = false;
  }
}
restart.addEventListener("click", () => void start());
const resumeMission = () => {
  session?.resume();
  resumeLoaded.hidden = true;
  dialog.close();
};
resume.addEventListener("click", resumeMission);
resumeLoaded.addEventListener("click", resumeMission);
inspect.addEventListener("click", () => dialog.close());
exit.addEventListener("click", () => {
  session?.dispose();
  session = undefined;
  showResult("exit");
});
load.addEventListener("click", () => file.click());
file.addEventListener("change", async () => {
  const selected = file.files?.[0];
  file.value = "";
  if (!selected || !scenario || busy) return;
  try {
    // Rejects invalid state before releasing the current session.
    await start(loadMissionSave(await selected.text(), scenario));
  } catch (error) {
    resultStatus.textContent =
      error instanceof Error
        ? error.message
        : "Unable to load this mission save.";
  }
});
void start();
