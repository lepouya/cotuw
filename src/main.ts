import "./styles.css";
import {
  ECONOMY_ACTOR_DEFINITIONS,
  ECONOMY_SCENARIO,
} from "./content/economy-scenario";
import { createTerrainPrototype } from "./prototype";
import {
  PROTOTYPE_ACTOR_DEFINITIONS,
  PROTOTYPE_ACTOR_PRESENTATIONS,
  PROTOTYPE_GOALS,
  ECONOMY_GOALS,
} from "./prototype-content";
import { createSidebar } from "./ui/sidebar";

import type { TerrainPrototype } from "./prototype";

const canvas = document.querySelector<HTMLCanvasElement>("#game-canvas")!;
const minimap = document.querySelector<HTMLCanvasElement>("#minimap")!;
let session: TerrainPrototype | undefined;
const sandbox = new URLSearchParams(location.search).has("sandbox");
const scenario = sandbox ? undefined : ECONOMY_SCENARIO;
const definitions = sandbox
  ? PROTOTYPE_ACTOR_DEFINITIONS
  : ECONOMY_ACTOR_DEFINITIONS;
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
if (!sandbox) {
  document.querySelector("#network-view-control")!.removeAttribute("hidden");
  document.querySelector("#resource-bar")!.removeAttribute("hidden");
  document.querySelector("#economy-overview")!.removeAttribute("hidden");
  document.querySelector("#scenario-label")!.textContent = "Materials economy";
  document.querySelector("#scenario-description")!.textContent =
    "Build a Refinery, produce its Harvester, gather Materials, then fund a Barracks and Troopers. A lone wolf roams the southern path. No victory or defeat condition.";
  document.querySelector("#scenario-rules")!.textContent =
    "Paid construction · Timed production · Sell buildings for half their cost";
}
createTerrainPrototype(canvas, minimap, {
  ...sidebar.controls,
  scenario,
  cameraControls: document.querySelector<HTMLElement>("#camera-controls")!,
  onStateChanged: sidebar.update,
  showActor: sidebar.showActor,
  onDispose: sidebar.dispose,
  onReady: (ready) => {
    session = ready;
  },
}).catch((error: unknown) => {
  console.error("The prototype failed to start.", error);
  sidebar.controls.status.textContent =
    "The prototype failed to start. Reload to try again.";
});
