import type { ActorDefinition } from "../simulation/actor";

const wolf = {
  id: "wolf",
  behaviorId: "terrain-move",
  faction: "wildlife",
  health: 100,
  movement: { speed: 5, profileId: "surface-ground", radius: 0.35 },
  vision: { radius: 8 },
  weapon: {
    damage: 8,
    damageType: "kinetic",
    range: 0.6,
    cooldownSeconds: 1.2,
  },
  territory: {
    leashRadius: 14,
    alertLifetimeSeconds: 8,
    investigationSeconds: 1.5,
    blockedRetrySeconds: 0.5,
    stalledSeconds: 3,
    arrivalTolerance: 0.15,
    regenerationDelaySeconds: 5,
    regenerationPerSecond: 5,
  },
} satisfies ActorDefinition;

export const WILDLIFE_ACTOR_DEFINITIONS = [
  wolf,
  {
    ...wolf,
    id: "alpha-wolf",
    health: 150,
    movement: { ...wolf.movement, radius: wolf.movement.radius * 1.25 },
    vision: { radius: 10 },
  },
] satisfies readonly ActorDefinition[];
