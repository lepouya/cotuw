import { createBarracksDetails } from "./render/barracks";
import { createCommandCenterDetails } from "./render/command-center";

import type { ActorDefinition } from "./simulation/actor";
import type { MovementProfile } from "./simulation/navigation";
import type { ActorGraphics } from "./render/skinned-actor-appearance";
import type { TilePlacedActorAppearance } from "./render";
import type { ActorPresentation, SidebarGoal } from "./ui/sidebar";

export const PROTOTYPE_MOVEMENT_PROFILES: readonly MovementProfile[] = [
  {
    id: "surface-ground",
    maxSlope: 0.75,
    slopeCostAtLimit: 2,
    terrainCosts: { plain: 1, path: 0.8, rough: 2.25, water: null },
  },
];

export const PROTOTYPE_ACTOR_DEFINITIONS = [
  {
    id: "arc-trooper",
    behaviorId: "terrain-move",
    movement: { speed: 4, profileId: "surface-ground" },
  },
  {
    id: "arc-scout",
    behaviorId: "terrain-move",
    movement: { speed: 7, profileId: "surface-ground" },
  },
  {
    id: "arc-command-center-prototype",
    behaviorId: "idle",
    footprint: {
      layer: "surface",
      occupiedTiles: [
        { x: 0, z: 0 },
        { x: 1, z: 0 },
        { x: 0, z: 1 },
        { x: 1, z: 1 },
      ],
      blocksMovement: true,
    },
    placement: {
      terrainTypeIds: ["plain", "path", "rough"],
      maxSlope: 0.75,
    },
  },
  {
    id: "arc-field-barracks",
    behaviorId: "idle",
    production: { unitDefinitionIds: ["arc-trooper", "arc-scout"] },
    footprint: {
      layer: "surface",
      occupiedTiles: [
        { x: 0, z: 0 },
        { x: 1, z: 0 },
        { x: 2, z: 0 },
        { x: 0, z: 1 },
        { x: 1, z: 1 },
        { x: 2, z: 1 },
      ],
      blocksMovement: true,
    },
    placement: { terrainTypeIds: ["plain", "path", "rough"], maxSlope: 0.75 },
  },
] satisfies readonly ActorDefinition[];

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
  ],
);

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
]);
