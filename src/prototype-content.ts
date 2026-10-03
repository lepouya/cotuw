import { ARC_ACTOR_DEFINITIONS } from "./content/arc";
import { createRefineryDetails } from "./render/refinery";
import { createBarracksDetails } from "./render/barracks";
import { createCommandCenterDetails } from "./render/command-center";

import type { MovementProfile } from "./simulation/navigation";
import type { ActorGraphics } from "./render/skinned-actor-appearance";
import type { TilePlacedActorAppearance } from "./render";
import type { ActorPresentation, SidebarGoal } from "./ui/sidebar";
import type { AttackEffectStyle } from "./render/combat-effects";

export const PROTOTYPE_MOVEMENT_PROFILES: readonly MovementProfile[] = [
  {
    id: "surface-ground",
    maxSlope: 0.75,
    slopeCostAtLimit: 2,
    terrainCosts: { plain: 1, path: 0.8, rough: 2.25, water: null },
  },
];

export { ARC_ACTOR_DEFINITIONS };

/** The free sandbox omits the Materials economy. */
export const PROTOTYPE_ACTOR_DEFINITIONS = ARC_ACTOR_DEFINITIONS.filter(
  (definition) =>
    !["arc-harvester", "arc-materials-refinery"].includes(definition.id),
);

/** Display names for the selection panel and placement status. */
export const PROTOTYPE_ACTOR_PRESENTATIONS = new Map<string, ActorPresentation>(
  [
    [
      "arc-trooper",
      {
        name: "Trooper",
        description: "Line infantry",
        train: { id: "train-trooper", label: "Train Trooper" },
      },
    ],
    [
      "arc-scout",
      {
        name: "Scout",
        description: "Fast reconnaissance",
        train: { id: "train-scout", label: "Train Scout" },
      },
    ],
    [
      "arc-command-center-prototype",
      {
        name: "Command Center",
        description: "Base infrastructure",
        build: { id: "build-command-center", label: "Place Command Center" },
      },
    ],
    [
      "arc-field-barracks",
      {
        name: "Field Barracks",
        description: "Infantry production",
        build: { id: "build-barracks", label: "Build Field Barracks" },
      },
    ],
    [
      "arc-materials-refinery",
      {
        name: "Materials Refinery",
        description: "One assigned Harvester",
        build: { id: "build-refinery", label: "Build Materials Refinery" },
      },
    ],
    [
      "arc-harvester",
      {
        name: "Harvester",
        description: "Collects and delivers Materials",
        train: { id: "train-harvester", label: "Produce Harvester" },
      },
    ],
    ["wolf", { name: "Wolf", description: "Hostile wildlife" }],
    ["alpha-wolf", { name: "Alpha wolf", description: "Pack leader" }],
  ],
);

/** How each armed actor's hits are drawn. */
export const PROTOTYPE_ATTACK_EFFECTS = new Map<string, AttackEffectStyle>([
  ["arc-trooper", "tracer"],
  ["wolf", "bite"],
  ["alpha-wolf", "bite"],
]);

export const PROTOTYPE_ACTOR_NAMES = new Map(
  [...PROTOTYPE_ACTOR_PRESENTATIONS].map(([id, { name }]) => [id, name]),
);

export const PROTOTYPE_GOALS: readonly SidebarGoal[] = [
  {
    definitionId: "arc-command-center-prototype",
    label: "Place a Command Center",
  },
  { definitionId: "arc-field-barracks", label: "Build a Field Barracks" },
  { definitionId: "arc-trooper", label: "Train a Trooper" },
  { definitionId: "arc-scout", label: "Train a Scout" },
];

export const ECONOMY_GOALS: readonly SidebarGoal[] = [
  {
    definitionId: "arc-materials-refinery",
    label: "Build a Materials Refinery",
  },
  { definitionId: "arc-harvester", label: "Produce a Harvester" },
  { definitionId: "arc-field-barracks", label: "Build a Field Barracks" },
  { definitionId: "arc-trooper", label: "Train a Trooper" },
];

export const PROTOTYPE_ACTOR_GRAPHICS = new Map<string, ActorGraphics>([
  [
    "arc-trooper",
    {
      url: "/assets/actors/arc-trooper.glb",
      minimapColor: [0.82, 0.28, 0.1],
      bounds: { radius: 0.45, height: 1.95 },
      clips: {
        idle: "idle",
        locomotion: "walk",
        turn: { left: "turn-left", right: "turn-right" },
      },
      cycleDistance: 2.1,
    },
  ],
  [
    "arc-scout",
    {
      url: "/assets/actors/arc-scout.glb",
      minimapColor: [0.12, 0.62, 0.82],
      bounds: { radius: 0.4, height: 1.65 },
      clips: {
        idle: "idle",
        locomotion: "walk",
        turn: { left: "turn-left", right: "turn-right" },
      },
      cycleDistance: 1.5,
    },
  ],
]);

export const PROTOTYPE_TILE_PLACED_APPEARANCES = new Map<
  string,
  TilePlacedActorAppearance
>([
  [
    "arc-command-center-prototype",
    {
      height: 0.3,
      color: [0.28, 0.38, 0.42],
      minimapColor: [0.36, 0.7, 0.76],
      createDetails: createCommandCenterDetails,
    },
  ],
  [
    "arc-field-barracks",
    {
      height: 0.25,
      color: [0.28, 0.34, 0.26],
      minimapColor: [0.65, 0.72, 0.32],
      createDetails: createBarracksDetails,
    },
  ],
  [
    "arc-materials-refinery",
    {
      height: 0.45,
      color: [0.45, 0.38, 0.22],
      minimapColor: [0.85, 0.65, 0.2],
      createDetails: createRefineryDetails,
    },
  ],
]);
