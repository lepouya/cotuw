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
  const armor = material("armor", [0.32, 0.4, 0.3]);
  const dark = material("barrels", [0.1, 0.14, 0.16]);
  const light = material("sensor", [0.35, 0.9, 0.8], true);
  const flash = material("flash", [1, 0.8, 0.3], true);
  cylinder("pedestal", [1.5, 0.5], [0, 0.25, 0], armor);
  cylinder("collar", [1.3, 0.18], [0, 0.55, 0], owner);
  for (const side of [-1, 1])
    box(`foot-${side}`, [0.28, 0.2, 1.6], [side * 0.55, 0.1, 0], dark);
  const turret = pivot("turret", [0, 0.9, 0]);
  box("housing", [1.1, 0.55, 0.8], [0, 0, 0], armor, turret);
  box("stripe", [1.14, 0.12, 0.82], [0, 0, 0], owner, turret);
  const sensor = box(
    "sensor",
    [0.18, 0.1, 0.05],
    [0, 0.18, 0.43],
    light,
    turret,
  );
  const carriage = pivot("carriage", [0, 0, 0], turret);
  const flashes = [-0.3, 0.3].map((x) => {
    box(`barrel-${x}`, [0.18, 0.18, 1], [x, 0.05, 0.65], dark, carriage);
    const muzzle = box(
      `flash-${x}`,
      [0.26, 0.26, 0.4],
      [x, 0.05, 1.25],
      flash,
      carriage,
    );
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
