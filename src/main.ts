import "./styles.css";
import { createTerrainPrototype } from "./prototype";
import {
  PROTOTYPE_ACTOR_DEFINITIONS,
  PROTOTYPE_ACTOR_PRESENTATIONS,
  PROTOTYPE_GOALS,
} from "./prototype-content";
import { createSidebar } from "./ui/sidebar";

import type { TerrainPrototype } from "./prototype";

const canvas = document.querySelector<HTMLCanvasElement>("#game-canvas")!;
const minimap = document.querySelector<HTMLCanvasElement>("#minimap")!;
let session: TerrainPrototype | undefined;
const sidebar = createSidebar(
  document.querySelector<HTMLElement>("#game-sidebar")!,
  {
    definitions: PROTOTYPE_ACTOR_DEFINITIONS,
    presentations: PROTOTYPE_ACTOR_PRESENTATIONS,
    goals: PROTOTYPE_GOALS,
    selectActor: (id) => session?.selectActor(id),
  },
);
createTerrainPrototype(canvas, minimap, {
  ...sidebar.controls,
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
