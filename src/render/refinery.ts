import { Color3, MeshBuilder } from "@babylonjs/core";
import type { TilePlacedActorDetailsFactory } from "./tile-placed-actor-view";

export const createRefineryDetails: TilePlacedActorDetailsFactory = (
  root,
  placement,
  shared,
) => {
  const scene = root.getScene();
  const steel = shared("steel", (material) => {
    material.diffuseColor = new Color3(0.3, 0.4, 0.42);
  });
  const tank = MeshBuilder.CreateCylinder(
    `${root.name}-tank`,
    {
      height: 1.25,
      diameter: 1.05,
      tessellation: 16,
    },
    scene,
  );
  tank.parent = root;
  tank.position.set(
    placement.center.x,
    placement.roof + 0.625,
    placement.center.z,
  );
  tank.material = steel;
  const beacon = MeshBuilder.CreateBox(
    `${root.name}-beacon`,
    { size: 0.2 },
    scene,
  );
  beacon.parent = root;
  beacon.position.set(
    placement.center.x,
    placement.roof + 1.4,
    placement.center.z,
  );
  beacon.material = shared("beacon", (material) => {
    material.diffuseColor = new Color3(1, 0.65, 0.15);
    material.emissiveColor = new Color3(0.4, 0.2, 0.03);
  });
  return { update: () => {}, dispose: () => {} };
};
