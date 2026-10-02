import { Color3, MeshBuilder, TransformNode } from "@babylonjs/core";
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
  const fan = new TransformNode(`${root.name}-fan`, scene);
  fan.parent = root;
  fan.position.set(
    placement.center.x,
    placement.roof + 1.3,
    placement.center.z,
  );
  for (let i = 0; i < 3; i++) {
    const blade = MeshBuilder.CreateBox(
      `${root.name}-fan-blade-${i}`,
      {
        width: 0.2,
        height: 0.08,
        depth: 0.85,
      },
      scene,
    );
    blade.parent = fan;
    blade.rotation.y = (i * Math.PI) / 3;
    blade.material = shared("fan", (material) => {
      material.diffuseColor = new Color3(0.85, 0.68, 0.25);
    });
  }
  const pump = MeshBuilder.CreateCylinder(
    `${root.name}-pump`,
    {
      height: 0.6,
      diameter: 0.25,
      tessellation: 8,
    },
    scene,
  );
  pump.parent = root;
  const sideX = Math.cos(placement.facing) * 0.85;
  const sideZ = -Math.sin(placement.facing) * 0.85;
  pump.position.set(
    placement.center.x + sideX,
    placement.roof + 0.5,
    placement.center.z + sideZ,
  );
  pump.material = steel;
  return {
    update: (seconds) => {
      fan.rotation.y = seconds * 2;
      pump.position.y = placement.roof + 0.5 + Math.sin(seconds * 3) * 0.2;
    },
    dispose: () => {},
  };
};
