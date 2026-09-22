import "./styles.css";
import { createTerrainPrototype } from "./prototype";

const canvas = document.querySelector<HTMLCanvasElement>("#game-canvas")!;
const minimap = document.querySelector<HTMLCanvasElement>("#minimap")!;
createTerrainPrototype(canvas, minimap);
