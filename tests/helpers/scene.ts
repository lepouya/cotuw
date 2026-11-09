import { NullEngine, Scene } from "@babylonjs/core";
import { onTestFinished } from "vitest";

/** A headless scene whose engine is released when the current test ends. */
export function testScene() {
  const engine = new NullEngine();
  onTestFinished(() => engine.dispose());
  return new Scene(engine);
}
