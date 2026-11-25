import {
  createBuildingAssembly,
  ease,
  openAndClose,
} from "./building-assembly";

import type { TilePlacedActorDetailsFactory } from "./tile-placed-actor-view";

const DOOR_SECONDS = 0.45;
/** Seconds the garage stays open while a Harvester deploys. */
const EXIT_SECONDS = 2.4;
/** Seconds of unloading and processing after each delivery. */
const DELIVERY_SECONDS = 3;
const DOOR_HEIGHT = 0.58;
const DOOR_SILL = 0.1;

/** A loading bay linking the processing hall to the storage silo. */
export const createRefineryDetails: TilePlacedActorDetailsFactory = (
  root,
  placement,
  sharedMaterial,
) => {
  const { assembly, material, owner, pivot, box, cylinder } =
    createBuildingAssembly(root, placement, sharedMaterial, [0.16, 0.15, 0.12]);
  const steel = material("steel", [0.26, 0.37, 0.39]);
  const hull = material("hull", [0.47, 0.39, 0.25]);
  const trim = material("trim", [0.61, 0.67, 0.65]);
  const dark = material("bay", [0.09, 0.13, 0.15]);
  const safety = material("safety", [0.86, 0.57, 0.19]);
  const beacon = material("beacon", [1, 0.65, 0.15], true);
  const processing = material("processing-light", [0.2, 1, 0.65], true);
  box("base-deck", [2.86, 0.1, 1.88], [0, 0.05, 0], dark);

  box("hall", [1.48, 0.65, 0.92], [-0.06, 0.425, -0.43], hull);
  box("hall-roof", [1.62, 0.14, 1.58], [-0.08, 0.77, -0.14], steel);
  box("roof-plate", [1.45, 0.07, 1.35], [-0.08, 0.86, -0.14], trim);
  box("annex", [0.71, 0.66, 1.34], [-1.05, 0.43, -0.23], hull);
  box("annex-cap", [0.75, 0.12, 1.41], [-1.05, 0.8, -0.23], steel);
  box("annex-marking", [0.24, 0.023, 1.17], [-1.15, 0.868, -0.23], owner);

  box("bay-back", [0.94, DOOR_HEIGHT, 0.05], [0, 0.39, 0.06], dark);
  for (const side of [-1, 1]) {
    box(
      `bay-jamb-${side}`,
      [0.24, 0.63, 0.62],
      [side * 0.59, 0.415, 0.35],
      steel,
    );
    box(
      `bay-rail-${side}`,
      [0.075, 0.025, 0.35],
      [side * 0.4, 0.108, 0.79],
      safety,
    );
    box(
      `bay-marker-${side}`,
      [0.085, 0.13, 0.035],
      [side * 0.56, 0.56, 0.667],
      beacon,
    );
  }
  box("bay-header", [1.36, 0.12, 0.16], [0, 0.735, 0.61], owner);
  const door = box(
    "garage-door",
    [0.96, DOOR_HEIGHT, 0.048],
    [0, DOOR_SILL + DOOR_HEIGHT / 2, 0.625],
    trim,
  );
  for (const y of [-0.16, 0, 0.16])
    box(`door-slat-${y}`, [0.9, 0.025, 0.026], [0, y, 0.026], steel, door);

  cylinder("silo-foot", [0.89, 0.16], [1.01, 0.18, -0.47], dark);
  cylinder("silo", [0.82, 1.02], [1.01, 0.72, -0.47], steel);
  cylinder("silo-cap", [0.9, 0.12], [1.01, 1.22, -0.47], trim);
  cylinder("silo-band", [0.86, 0.11], [1.01, 0.95, -0.47], owner);
  cylinder("silo-beacon", [0.17, 0.13], [1.01, 1.33, -0.47], beacon);
  box("feed-line", [0.17, 0.18, 0.65], [1.02, 0.42, 0.03], trim);
  cylinder("pump-base", [0.39, 0.22], [1.02, 0.21, 0.52], dark);
  const pump = cylinder("pump", [0.24, 0.38], [1.02, 0.35, 0.52], steel);
  cylinder("press-housing", [0.35, 0.22], [0.29, 0.965, -0.2], dark);
  const piston = cylinder("press", [0.19, 0.4], [0.29, 0.95, -0.2], trim);
  // Rises out of the roof while the hall processes a delivery.
  const lamp = box(
    "processing",
    [0.16, 0.12, 0.16],
    [-1.09, 0.72, 0.31],
    processing,
  );
  cylinder("fan-surround", [0.63, 0.09], [-0.43, 0.924, -0.39], dark);
  const fan = pivot("fan", [-0.43, 0.98, -0.39]);
  for (let i = 0; i < 3; i++)
    box(`fan-blade-${i}`, [0.1, 0.038, 0.53], [0, 0, 0], trim, fan).rotation.y =
      (i * Math.PI) / 3;
  const rollDoor = (open: number) => {
    // The door rolls up into the header, keeping its top edge in place.
    door.scaling.y = 1 - open * 0.85;
    door.position.y = DOOR_SILL + DOOR_HEIGHT * (1 - door.scaling.y / 2);
  };
  const loopSeconds = 4;
  return {
    update: (seconds) => {
      const turn = (seconds / loopSeconds) * Math.PI * 4;
      fan.rotation.y = turn;
      pump.position.y = 0.35 + Math.sin(turn) * 0.15;
    },
    loopSeconds,
    activities: {
      exit: {
        seconds: EXIT_SECONDS,
        pose: (seconds) =>
          rollDoor(openAndClose(seconds, EXIT_SECONDS, DOOR_SECONDS)),
      },
      delivery: {
        seconds: DELIVERY_SECONDS,
        pose: (seconds) => {
          rollDoor(openAndClose(seconds, DELIVERY_SECONDS, DOOR_SECONDS));
          const working = openAndClose(seconds, DELIVERY_SECONDS, 0.5);
          lamp.position.y = 0.72 + working * 0.2;
          // Four press strokes while the hall works.
          const stroke = ease(seconds, 0.5, DELIVERY_SECONDS - 0.5);
          piston.position.y =
            0.95 - Math.sin(stroke * Math.PI * 4) ** 2 * 0.15 * working;
        },
      },
    },
    dispose: () => assembly.dispose(),
  };
};
