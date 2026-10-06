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

/** A processing hall with a roll-up garage door beside a storage tank. */
export const createRefineryDetails: TilePlacedActorDetailsFactory = (
  root,
  placement,
  sharedMaterial,
) => {
  const { assembly, material, pivot, box, cylinder } = createBuildingAssembly(
    root,
    placement,
    sharedMaterial,
    [0.16, 0.15, 0.12],
  );
  const steel = material("steel", [0.3, 0.4, 0.42]);
  const hull = material("hull", [0.52, 0.45, 0.3]);
  const dark = material("bay", [0.09, 0.1, 0.1]);
  const marking = material("markings", [0.94, 0.46, 0.12]);
  const fanSurface = material("fan", [0.85, 0.68, 0.25]);
  const beacon = material("beacon", [1, 0.65, 0.15], true);
  const processing = material("processing-light", [0.2, 1, 0.65], true);
  box("hall", [1.7, 0.75, 1.5], [-0.55, 0.375, -0.1], hull);
  box("hall-roof", [1.82, 0.1, 1.62], [-0.55, 0.8, -0.1], steel);
  box("bay", [0.95, DOOR_HEIGHT, 0.03], [-0.55, DOOR_HEIGHT / 2, 0.66], dark);
  box("bay-header", [1.1, 0.08, 0.06], [-0.55, 0.62, 0.67], marking);
  const door = box(
    "garage-door",
    [0.95, DOOR_HEIGHT, 0.04],
    [-0.55, DOOR_HEIGHT / 2, 0.69],
    steel,
  );
  cylinder("tank", [0.95, 1.2], [0.8, 0.6, -0.3], steel);
  cylinder("tank-band", [1, 0.08], [0.8, 0.85, -0.3], marking);
  box("beacon", [0.18, 0.18, 0.18], [0.8, 1.29, -0.3], beacon);
  const pump = cylinder("pump", [0.22, 0.5], [1.15, 0.35, 0.55], steel);
  const piston = cylinder("press", [0.18, 0.4], [-0.05, 0.95, 0.3], steel);
  // Rises out of the roof while the hall processes a delivery.
  const lamp = box(
    "processing",
    [0.16, 0.12, 0.16],
    [-1.1, 0.72, 0.3],
    processing,
  );
  const fan = pivot("fan", [-0.75, 0.92, -0.35]);
  for (let i = 0; i < 3; i++)
    box(
      `fan-blade-${i}`,
      [0.2, 0.06, 0.85],
      [0, 0, 0],
      fanSurface,
      fan,
    ).rotation.y = (i * Math.PI) / 3;
  const rollDoor = (open: number) => {
    // The door rolls up into the header, keeping its top edge in place.
    door.scaling.y = 1 - open * 0.85;
    door.position.y = DOOR_HEIGHT - (DOOR_HEIGHT * door.scaling.y) / 2;
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
