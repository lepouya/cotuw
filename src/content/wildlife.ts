import type { ActorDefinition } from "../simulation/actor";

export const WILDLIFE_ACTOR_DEFINITIONS = [
  {
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
      aggressionRadius: 6,
      leashRadius: 14,
      regenerationDelaySeconds: 5,
      regenerationPerSecond: 5,
    },
  },
] satisfies readonly ActorDefinition[];
