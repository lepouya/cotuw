import { createBuildingAssembly } from "./building-assembly";

import type { TilePlacedActorDetailsFactory } from "./tile-placed-actor-view";

export const createRelayDetails: TilePlacedActorDetailsFactory = (
  root,
  placement,
  sharedMaterial,
) => {
  const { assembly, material, owner, pivot, box, cylinder } =
    createBuildingAssembly(root, placement, sharedMaterial, [0.15, 0.18, 0.2]);
  const armor = material("armor", [0.38, 0.43, 0.35]);
  const trim = material("trim", [0.59, 0.66, 0.63]);
  const frame = material("frame", [0.11, 0.17, 0.17]);
  const receiver = material("receiver", [0.27, 0.44, 0.46]);
  const signal = material("signal", [0.47, 0.88, 0.83], true);
  box("deck", [1.88, 0.1, 1.86], [0, 0.05, 0], frame);
  box("equipment", [1.47, 0.48, 1.36], [0, 0.34, -0.08], armor);
  box("roof-rim", [1.61, 0.13, 1.46], [0, 0.59, -0.08], trim);
  box("front-panel", [1.38, 0.37, 0.14], [0, 0.31, 0.64], frame);
  box("service-hatch", [0.43, 0.33, 0.045], [-0.39, 0.28, 0.728], armor);
  box("hatch-pull", [0.12, 0.028, 0.02], [-0.39, 0.39, 0.758], trim);
  box("console", [0.43, 0.18, 0.042], [0.4, 0.38, 0.73], receiver);
  const lamp = box("signal", [0.28, 0.06, 0.021], [0.4, 0.39, 0.758], signal);
  for (const x of [-0.12, 0, 0.12])
    box(`vent-${x}`, [0.055, 0.24, 0.025], [x, 0.29, 0.721], trim);
  box("rear-mark", [0.8, 0.11, 0.034], [0, 0.4, -0.769], owner);

  cylinder("mast-base", [0.67, 0.17], [0, 0.73, -0.16], frame);
  box("mast", [0.23, 1.08, 0.22], [0, 1.28, -0.16], armor);
  cylinder("mast-collar", [0.47, 0.17], [0, 1.66, -0.16], trim);
  for (const side of [-1, 1]) {
    box(
      `sill-${side}`,
      [0.25, 0.39, 1.47],
      [side * 0.762, 0.28, -0.04],
      armor,
    ).rotation.z = side * 0.22;
    box(
      `sill-mark-${side}`,
      [0.12, 0.03, 1.2],
      [side * 0.79, 0.513, -0.04],
      owner,
    );
    const brace = box(
      `brace-${side}`,
      [0.12, 0.91, 0.15],
      [side * 0.36, 1.03, -0.16],
      frame,
    );
    brace.rotation.z = side * 0.61;
    box(
      `brace-foot-${side}`,
      [0.25, 0.105, 0.37],
      [side * 0.63, 0.704, -0.16],
      trim,
    );
  }
  const scanner = pivot("scanner", [0, 1.86, -0.16]);
  box("crossarm", [1.43, 0.105, 0.16], [0, 0.022, -0.09], frame, scanner);
  box("array-hub", [0.29, 0.37, 0.29], [0, 0.03, -0.08], trim, scanner);
  for (const side of [-1, 1]) {
    const panel = pivot(`panel-${side}`, [side * 0.446, 0.135, 0.04], scanner);
    panel.rotation.set(-0.19, -side * 0.33, side * 0.15);
    box(`panel-frame-${side}`, [0.62, 0.61, 0.09], [0, 0, 0], trim, panel);
    box(
      `panel-face-${side}`,
      [0.5, 0.48, 0.03],
      [0, 0, 0.052],
      receiver,
      panel,
    );
    for (const y of [-0.135, 0.135])
      box(
        `panel-rib-${side}-${y}`,
        [0.43, 0.034, 0.024],
        [0, y, 0.077],
        frame,
        panel,
      );
    box(
      `panel-edge-${side}`,
      [0.115, 0.66, 0.114],
      [side * 0.266, 0, 0],
      owner,
      panel,
    );
  }
  return {
    loopSeconds: 6,
    update: (seconds) => {
      scanner.rotation.y = Math.sin((seconds * Math.PI) / 3) * 0.5;
      lamp.scaling.setAll(0.8 + 0.2 * Math.cos((seconds * Math.PI * 2) / 3));
    },
    dispose: () => assembly.dispose(),
  };
};
