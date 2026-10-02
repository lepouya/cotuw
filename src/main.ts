import "./styles.css";
import { createTerrainPrototype } from "./prototype";

const canvas = document.querySelector<HTMLCanvasElement>("#game-canvas")!;
const minimap = document.querySelector<HTMLCanvasElement>("#minimap")!;
const button = (id: string) =>
  document.querySelector<HTMLButtonElement>(`#${id}`)!;
createTerrainPrototype(canvas, minimap, {
  build: button("build-command-center"),
  rotate: button("rotate-building"),
  confirm: button("confirm-building"),
  cancel: button("cancel-building"),
  remove: button("remove-building"),
  status: document.querySelector<HTMLElement>("#placement-status")!,
  selection: document.querySelector<HTMLElement>("#selection-details")!,
  animate: document.querySelector<HTMLInputElement>("#animate-building")!,
}).catch((error: unknown) => {
  console.error("The prototype failed to start.", error);
});
