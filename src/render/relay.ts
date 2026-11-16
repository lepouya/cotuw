import { createBuildingAssembly } from "./building-assembly";

import type { TilePlacedActorDetailsFactory } from "./tile-placed-actor-view";

export const createRelayDetails: TilePlacedActorDetailsFactory = (
  root,
  placement,
  sharedMaterial,
) => {
  const { assembly, material, owner, box, cylinder } = createBuildingAssembly(
    root,
    placement,
    sharedMaterial,
    [0.15, 0.18, 0.2],
  );
  const armor = material("armor", [0.32, 0.4, 0.44]);
  box("equipment", [1.6, 0.55, 1.5], [0, 0.28, 0], armor);
  box("stripe", [1.65, 0.16, 1.55], [0, 0.5, 0], owner);
  cylinder("mast", [0.16, 1.8], [0, 1.4, 0], armor);
  for (const y of [1.7, 2.1])
    box(`antenna-${y}`, [1.6, 0.12, 0.18], [0, y, 0], owner);
  return { update: () => {}, dispose: () => assembly.dispose() };
};
