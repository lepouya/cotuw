import { Color3, StandardMaterial } from "@babylonjs/core";
import type { Scene } from "@babylonjs/core";

/** A matte generated-model material; `glow` scales its self-illumination. */
export function surface(
  scene: Scene,
  name: string,
  color: Color3 | readonly [number, number, number],
  glow = 0,
) {
  const material = new StandardMaterial(name, scene);
  material.diffuseColor =
    color instanceof Color3 ? color.clone() : new Color3(...color);
  material.specularColor = Color3.Black();
  if (glow) material.emissiveColor = material.diffuseColor.scale(glow);
  return material;
}
