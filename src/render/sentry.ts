import { createBuildingAssembly } from "./building-assembly";

import type { TilePlacedActorDetailsFactory } from "./tile-placed-actor-view";

const FIRING_SECONDS = 0.18;
/** Hidden flashes keep a tiny nonzero scale for exported clips. */
const HIDDEN = 0.001;

export const createSentryDetails: TilePlacedActorDetailsFactory = (
  root,
  placement,
  sharedMaterial,
) => {
  const { assembly, material, owner, pivot, box, cylinder } =
    createBuildingAssembly(root, placement, sharedMaterial, [0.15, 0.18, 0.2]);
  const armor = material("armor", [0.38, 0.43, 0.35]);
  const trim = material("trim", [0.59, 0.66, 0.63]);
  const frame = material("frame", [0.11, 0.17, 0.17]);
  const light = material("sensor", [0.47, 0.88, 0.83], true);
  const flash = material("flash", [1, 0.8, 0.3], true);
  box("deck", [1.88, 0.12, 1.86], [0, 0.06, 0], frame);
  cylinder("pedestal", [1.44, 0.27], [0, 0.255, 0], armor);
  cylinder("ring", [1.25, 0.13], [0, 0.455, 0], trim);
  cylinder("swivel", [1.02, 0.17], [0, 0.585, 0], frame);
  for (const side of [-1, 1]) {
    box(`sill-${side}`, [0.24, 0.28, 1.57], [side * 0.76, 0.24, 0], armor);
    box(`rail-${side}`, [0.12, 0.035, 1.34], [side * 0.76, 0.397, 0], owner);
    for (const z of [-0.55, 0.55]) {
      const brace = box(
        `brace-${side}-${z}`,
        [0.47, 0.13, 0.22],
        [side * 0.575, 0.3, z],
        trim,
      );
      brace.rotation.z = -side * 0.33;
    }
  }

  const turret = pivot("turret", [0, 0.9, 0]);
  box("housing", [1.03, 0.38, 0.89], [0, -0.05, -0.13], frame, turret);
  box("roof", [0.82, 0.16, 0.86], [0, 0.165, -0.14], armor, turret);
  box("brow", [0.67, 0.11, 0.24], [0, 0.195, 0.31], trim, turret);
  box("sensor-recess", [0.35, 0.136, 0.07], [0, 0.08, 0.342], frame, turret);
  const sensor = box(
    "sensor",
    [0.24, 0.065, 0.045],
    [0, 0.08, 0.38],
    light,
    turret,
  );
  for (const side of [-1, 1]) {
    const cheek = pivot(`cheek-${side}`, [side * 0.49, 0.015, -0.12], turret);
    cheek.rotation.z = side * 0.24;
    box(`plate-${side}`, [0.21, 0.43, 0.85], [0, 0, 0], armor, cheek);
    box(`mark-${side}`, [0.162, 0.036, 0.65], [0, 0.219, -0.045], owner, cheek);
  }

  const carriage = pivot("carriage", [0, 0, 0], turret);
  const flashes = [-0.3, 0.3].map((x) => {
    box(`sleeve-${x}`, [0.25, 0.23, 0.49], [x, 0.05, 0.49], armor, carriage);
    box(`barrel-${x}`, [0.146, 0.146, 0.47], [x, 0.05, 0.91], frame, carriage);
    box(`muzzle-${x}`, [0.22, 0.22, 0.17], [x, 0.05, 1.15], trim, carriage);
    box(`bore-${x}`, [0.122, 0.122, 0.024], [x, 0.05, 1.236], frame, carriage);
    const muzzle = box(
      `flash-${x}`,
      [0.22, 0.22, 0.36],
      [x, 0.05, 1.32],
      flash,
      carriage,
    );
    muzzle.rotation.z = Math.PI / 4;
    muzzle.scaling.setAll(HIDDEN);
    return muzzle;
  });
  return {
    loopSeconds: 2,
    update: (seconds) =>
      sensor.scaling.setAll(0.85 + 0.15 * Math.cos(seconds * Math.PI)),
    activities: {
      attack: {
        seconds: FIRING_SECONDS,
        pose: (seconds) => {
          const kick = Math.sin(
            Math.min(1, seconds / FIRING_SECONDS) * Math.PI,
          );
          carriage.position.z = -0.14 * kick;
          // Flashes show during the first half of the recoil.
          const flare = seconds < FIRING_SECONDS * 0.55 ? kick : 0;
          for (const muzzle of flashes)
            muzzle.scaling.setAll(Math.max(HIDDEN, flare));
        },
      },
    },
    aim: (heading) => {
      turret.rotation.y = heading - placement.facing;
    },
    dispose: () => assembly.dispose(),
  };
};
