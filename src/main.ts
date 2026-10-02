import "./styles.css";
import { createTerrainPrototype } from "./prototype";

const canvas = document.querySelector<HTMLCanvasElement>("#game-canvas")!;
const minimap = document.querySelector<HTMLCanvasElement>("#minimap")!;
const blockerToggle =
  document.querySelector<HTMLButtonElement>("#toggle-blocker")!;
createTerrainPrototype(canvas, minimap, { blockerToggle }).catch(
  (error: unknown) => {
    console.error("The prototype failed to start.", error);
  },
);
