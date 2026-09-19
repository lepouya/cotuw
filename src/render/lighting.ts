import {
  Color3,
  DirectionalLight,
  HemisphericLight,
  Scene,
  Vector3,
} from "@babylonjs/core";

export function createLighting(scene: Scene): void {
  const skyLight = new HemisphericLight(
    "sky-light",
    new Vector3(0, 1, 0),
    scene,
  );
  skyLight.intensity = 1.05;
  skyLight.diffuse = new Color3(0.6, 0.78, 0.77);
  skyLight.groundColor = new Color3(0.08, 0.12, 0.1);

  const sunLight = new DirectionalLight(
    "sun-light",
    new Vector3(-0.5, -1, 0.35),
    scene,
  );
  sunLight.position = new Vector3(35, 70, -45);
  sunLight.intensity = 1.3;
}
