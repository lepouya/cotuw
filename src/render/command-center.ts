import { createBuildingAssembly } from "./building-assembly";

import type { TilePlacedActorDetailsFactory } from "./tile-placed-actor-view";

/** ARC headquarters with a rotating communications array. */
export const createCommandCenterDetails: TilePlacedActorDetailsFactory = (
  root,
  placement,
  sharedMaterial,
) => {
  const { assembly, material, owner, pivot, box, cylinder, fan } =
    createBuildingAssembly(root, placement, sharedMaterial, [0.15, 0.2, 0.22]);
  const armor = material("armor", [0.26, 0.36, 0.38]);
  const trim = material("trim", [0.64, 0.7, 0.68]);
  const dark = material("equipment", [0.09, 0.14, 0.17]);
  const glass = material("windows", [0.13, 0.67, 0.78], true);
  box("foundation", [1.9, 0.12, 1.9], [0, 0.06, 0], dark);
  box("command-cabin", [1.38, 0.74, 1.25], [0, 0.49, -0.14], armor);
  box("roof-rim", [1.48, 0.13, 1.35], [0, 0.88, -0.14], dark);
  box("roof-plate", [1.3, 0.08, 1.19], [0, 0.985, -0.14], trim);
  for (const x of [-0.56, 0.56])
    box(`roof-marking-${x}`, [0.13, 0.022, 0.88], [x, 1.03, -0.14], owner);
  box("front-window-frame", [1.2, 0.24, 0.05], [0, 0.7, 0.5], dark);
  for (const x of [-0.36, 0, 0.36])
    box(`front-window-${x}`, [0.3, 0.14, 0.02], [x, 0.7, 0.53], glass);

  box("door-frame", [0.52, 0.45, 0.09], [0, 0.35, 0.52], trim);
  box("door", [0.37, 0.38, 0.025], [0, 0.32, 0.57], dark);
  box("door-seam", [0.025, 0.36, 0.025], [0, 0.32, 0.585], armor);
  box("entry-canopy", [0.7, 0.1, 0.36], [0, 0.57, 0.665], owner);
  box("landing", [0.65, 0.1, 0.41], [0, 0.15, 0.72], trim);
  box("entry-ramp", [0.52, 0.06, 0.24], [0, 0.13, 0.82], dark).rotation.x =
    0.26;

  for (const side of [-1, 1]) {
    const pod = pivot(`armor-pod-${side}`, [side * 0.74, 0.38, -0.12]);
    pod.rotation.z = side * 0.26;
    box(`pod-shell-${side}`, [0.29, 0.49, 1.3], [0, 0, 0], armor, pod);
    box(`pod-cap-${side}`, [0.31, 0.1, 1.14], [0, 0.245, 0], trim, pod);
    box(`pod-marking-${side}`, [0.27, 0.025, 0.66], [0, 0.3, 0.14], owner, pod);
    box(
      `pod-intake-${side}`,
      [0.08, 0.25, 0.54],
      [side * 0.15, -0.07, 0],
      dark,
      pod,
    );
  }

  cylinder("vent-housing", [0.44, 0.11], [0.34, 1.075, 0.02], dark);
  const blades = fan(0.36, 0.025, [0.34, 1.145, 0.02], trim);
  cylinder("antenna-base", [0.43, 0.12], [-0.3, 1.085, -0.38], dark);
  box("antenna-pedestal", [0.22, 0.27, 0.2], [-0.3, 1.25, -0.38], armor);
  box("mast", [0.08, 0.3, 0.08], [-0.3, 1.49, -0.38], trim);
  const radar = pivot("radar", [-0.3, 1.66, -0.38]);
  const panel = box(
    "radar-panel",
    [0.68, 0.25, 0.075],
    [0, 0, 0],
    armor,
    radar,
  );
  panel.rotation.x = -0.33;
  box("radar-face", [0.55, 0.15, 0.025], [0, 0, 0.04], dark, panel);
  box("radar-signal", [0.43, 0.035, 0.015], [0, 0, 0.057], glass, panel);
  for (const x of [-0.31, 0.31])
    box(
      `radar-panel-tip-${x}`,
      [0.09, 0.22, 0.07],
      [x, 0, 0.015],
      owner,
      panel,
    );
  const loopSeconds = 14;
  return {
    update: (seconds) => {
      radar.rotation.y = (seconds / loopSeconds) * Math.PI * 2;
      blades.rotation.y = (seconds / loopSeconds) * Math.PI * 4;
    },
    loopSeconds,
    dispose: () => assembly.dispose(),
  };
};
