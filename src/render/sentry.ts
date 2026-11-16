import { createBuildingAssembly } from "./building-assembly";

import type { TilePlacedActorDetailsFactory } from "./tile-placed-actor-view";

export const createSentryDetails: TilePlacedActorDetailsFactory = (
  root,
  placement,
  sharedMaterial,
) => {
  const { assembly, material, owner, pivot, box, cylinder } =
    createBuildingAssembly(root, placement, sharedMaterial, [0.15, 0.18, 0.2]);
  const armor = material("armor", [0.32, 0.4, 0.3]);
  const dark = material("barrels", [0.1, 0.14, 0.16]);
  cylinder("pedestal", [1.5, 0.5], [0, 0.25, 0], armor);
  cylinder("collar", [1.3, 0.18], [0, 0.55, 0], owner);
  const turret = pivot("turret", [0, 0.9, 0]);
  box("housing", [1.1, 0.55, 0.8], [0, 0, 0], armor, turret);
  for (const x of [-0.3, 0.3])
    box(`barrel-${x}`, [0.18, 0.18, 1], [x, 0.05, 0.65], dark, turret);
  return {
    update: () => {},
    aim: (heading) => {
      turret.rotation.y = heading - placement.facing;
    },
    dispose: () => assembly.dispose(),
  };
};
