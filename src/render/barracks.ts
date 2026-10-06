import { createBuildingAssembly, openAndClose } from "./building-assembly";

import type { TilePlacedActorDetailsFactory } from "./tile-placed-actor-view";

/** Seconds the entrance stays open for a trained unit. */
const EXIT_SECONDS = 2.4;
const DOOR_SECONDS = 0.45;

export const createBarracksDetails: TilePlacedActorDetailsFactory = (
  root,
  placement,
  sharedMaterial,
) => {
  const { assembly, material, box, fan } = createBuildingAssembly(
    root,
    placement,
    sharedMaterial,
    [0.12, 0.15, 0.14],
  );
  const armor = material("armor", [0.32, 0.4, 0.29]);
  const trim = material("trim", [0.63, 0.67, 0.56]);
  const dark = material("door", [0.08, 0.13, 0.12]);
  const marking = material("markings", [0.94, 0.46, 0.12]);
  box("quarters", [2.65, 0.85, 1.55], [0, 0.43, -0.1], armor);
  box("roof", [2.82, 0.12, 1.74], [0, 0.91, -0.1], trim);
  box("entrance", [0.8, 0.65, 0.04], [0, 0.33, 0.69], dark);
  box("entry-canopy", [1.05, 0.1, 0.44], [0, 0.73, 0.73], marking);
  // Sliding leaves cover the dark entrance until a unit leaves.
  const leaves = [-1, 1].map((side) => {
    const leaf = box(
      `entrance-leaf-${side}`,
      [0.4, 0.63, 0.04],
      [side * 0.2, 0.33, 0.72],
      trim,
    );
    return { leaf, side };
  });
  for (const x of [-1.06, 1.06]) {
    box(`window-${x}`, [0.42, 0.23, 0.04], [x, 0.58, 0.69], dark);
    box(`stripe-${x}`, [0.15, 0.58, 0.05], [x, 0.3, 0.7], marking);
  }
  box("vent", [0.56, 0.16, 0.56], [0.82, 1.05, -0.2], dark);
  const blades = fan(0.48, 0.03, [0.82, 1.15, -0.2], trim);
  const loopSeconds = 4;
  return {
    update: (seconds) => {
      blades.rotation.y = (seconds / loopSeconds) * Math.PI * 4;
    },
    loopSeconds,
    activities: {
      exit: {
        seconds: EXIT_SECONDS,
        pose: (seconds) => {
          const open = openAndClose(seconds, EXIT_SECONDS, DOOR_SECONDS);
          for (const { leaf, side } of leaves)
            leaf.position.x = side * (0.2 + open * 0.38);
        },
      },
    },
    dispose: () => assembly.dispose(),
  };
};
