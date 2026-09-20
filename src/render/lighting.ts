import {
  Color3,
  DirectionalLight,
  HemisphericLight,
  Scene,
  Vector3,
} from "@babylonjs/core";

export type LightingConfig = {
  skyColor: Color3;
  groundColor: Color3;
  sunColor: Color3;
  sunDirection: Vector3;
  skyIntensity: number;
  sunIntensity: number;
};

export type GameLighting = {
  sky: HemisphericLight;
  sun: DirectionalLight;
};

export function createLighting(
  scene: Scene,
  config: LightingConfig,
): GameLighting {
  const sky = new HemisphericLight("sky-light", Vector3.Up(), scene);
  sky.intensity = config.skyIntensity;
  sky.diffuse = config.skyColor.clone();
  sky.groundColor = config.groundColor.clone();

  const sun = new DirectionalLight(
    "sun-light",
    config.sunDirection.clone().normalize(),
    scene,
  );
  sun.diffuse = config.sunColor.clone();
  sun.intensity = config.sunIntensity;

  return { sky, sun };
}
