import "./styles.css";
import { createTerrainPrototype } from "./prototype";

const canvas = document.querySelector<HTMLCanvasElement>("#game-canvas")!;
createTerrainPrototype(canvas);
