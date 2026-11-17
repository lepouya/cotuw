import { createBuildingAssembly } from "./building-assembly";

import type { TilePlacedActorDetailsFactory } from "./tile-placed-actor-view";

export const createRelayDetails: TilePlacedActorDetailsFactory = (
  root,
  placement,
  sharedMaterial,
) => {
  const { assembly, material, owner, pivot, box, cylinder } =
    createBuildingAssembly(root, placement, sharedMaterial, [0.15, 0.18, 0.2]);
  const armor = material("armor", [0.32, 0.4, 0.44]);
  const dark = material("equipment", [0.1, 0.17, 0.2]);
  const signal = material("signal", [0.25, 0.9, 0.8], true);
  box("equipment", [1.6, 0.55, 1.5], [0, 0.28, 0], armor);
  box("stripe", [1.65, 0.16, 1.55], [0, 0.5, 0], owner);
  for (const x of [-0.5, 0, 0.5])
    box(`vent-${x}`, [0.26, 0.28, 0.05], [x, 0.28, 0.77], dark);
  cylinder("mast", [0.16, 1.8], [0, 1.4, 0], armor);
  for (const side of [-1, 1]) {
    const brace = box(
      `brace-${side}`,
      [0.08, 1.25, 0.08],
      [side * 0.3, 0.9, 0],
      armor,
    );
    brace.rotation.z = side * 0.45;
  }
  const scanner = pivot("scanner", [0, 1.9, 0]);
  for (const y of [-0.2, 0.2]) {
    box(`antenna-${y}`, [1.6, 0.12, 0.18], [0, y, 0], owner, scanner);
    for (const side of [-1, 1])
      box(
        `tip-${y}-${side}`,
        [0.1, 0.35, 0.1],
        [side * 0.75, y, 0],
        armor,
        scanner,
      );
  }
  const lamp = box("signal", [0.14, 0.14, 0.1], [0.58, 0.4, 0.79], signal);
  return {
    loopSeconds: 6,
    update: (seconds) => {
      scanner.rotation.y = Math.sin((seconds * Math.PI) / 3) * 0.5;
      lamp.scaling.setAll(0.8 + 0.2 * Math.cos((seconds * Math.PI * 2) / 3));
    },
    dispose: () => assembly.dispose(),
  };
};
