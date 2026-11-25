import { createBuildingAssembly, openAndClose } from "./building-assembly";

import type { TilePlacedActorDetailsFactory } from "./tile-placed-actor-view";

/** Total time for the doors to open, hold, and close. */
const EXIT_SECONDS = 2.4;
const DOOR_SECONDS = 0.45;
const LEAF_WIDTH = 0.47;
const DOOR_HEIGHT = 1.06;

export const createBarracksDetails: TilePlacedActorDetailsFactory = (
  root,
  placement,
  sharedMaterial,
) => {
  const { assembly, material, owner, box, cylinder, fan } =
    createBuildingAssembly(root, placement, sharedMaterial, [0.12, 0.15, 0.14]);
  const hull = material("hull", [0.33, 0.39, 0.29]);
  const armor = material("armor", [0.49, 0.53, 0.41]);
  const trim = material("trim", [0.61, 0.65, 0.55]);
  const dark = material("frame", [0.1, 0.15, 0.14]);
  const glass = material("glass", [0.27, 0.43, 0.43]);
  const lamp = material("waylight", [0.76, 0.9, 0.76], true);
  box("deck", [2.87, 0.09, 1.9], [0, 0.045, 0], dark);
  const doorCenter = 0.09 + DOOR_HEIGHT / 2;
  box("quarters", [2.68, 1.06, 0.96], [0, doorCenter, -0.42], hull);
  box("entrance-back", [0.95, DOOR_HEIGHT, 0.05], [0, doorCenter, 0.08], dark);
  box("entry-roof", [1.1, 0.22, 1.68], [0, 1.26, -0.025], armor);
  box("entry-header", [1.13, 0.13, 0.16], [0, 1.21, 0.78], owner);
  box("entry-roof-stripe", [0.48, 0.025, 1.22], [0, 1.37, 0], owner);
  box("threshold", [0.9, 0.024, 0.14], [0, 0.1, 0.84], trim);

  for (const side of [-1, 1]) {
    const x = side * 0.91;
    box(`wing-${side}`, [0.87, 0.96, 1.54], [x, 0.57, -0.005], armor);
    box(`wing-cap-${side}`, [0.94, 0.11, 1.61], [x, 1.105, -0.035], trim);
    box(`window-frame-${side}`, [0.69, 0.2, 0.057], [x, 0.76, 0.77], dark);
    box(`window-${side}`, [0.58, 0.11, 0.027], [x, 0.76, 0.804], glass);
    for (const offset of [-0.105, 0.105])
      box(
        `window-mullion-${side}-${offset}`,
        [0.035, 0.13, 0.025],
        [x + offset, 0.76, 0.822],
        dark,
      );
    box(
      `side-rail-${side}`,
      [0.035, 0.095, 1.17],
      [side * 1.35, 0.44, 0],
      owner,
    );
    box(
      `entry-jamb-${side}`,
      [0.14, DOOR_HEIGHT, 0.14],
      [side * 0.51, doorCenter, 0.755],
      dark,
    );
    box(
      `entry-light-${side}`,
      [0.06, 0.19, 0.022],
      [side * 0.5, 0.97, 0.831],
      lamp,
    );
  }

  // The leaves slide behind the dormitory fronts and clear the threshold.
  const leaves = [-1, 1].map((side) => {
    const leaf = box(
      `entrance-leaf-${side}`,
      [LEAF_WIDTH - 0.012, DOOR_HEIGHT, 0.044],
      [side * (LEAF_WIDTH / 2), doorCenter, 0.71],
      trim,
    );
    box(
      `entrance-leaf-panel-${side}`,
      [0.32, 0.12, 0.013],
      [0, 0.3, 0.023],
      dark,
      leaf,
    );
    return { leaf, side };
  });
  cylinder("vent-rim", [0.55, 0.12], [0.92, 1.21, -0.33], dark);
  const blades = fan(0.43, 0.028, [0.92, 1.285, -0.33], trim);
  box("service-box", [0.58, 0.14, 0.59], [-0.92, 1.22, -0.34], dark);
  for (const z of [-0.52, -0.34, -0.16])
    box(`service-louver-${z}`, [0.47, 0.039, 0.065], [-0.92, 1.295, z], armor);
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
            leaf.position.x = side * (LEAF_WIDTH / 2 + open * 0.46);
        },
      },
    },
    dispose: () => assembly.dispose(),
  };
};
