import type { ActorDefinition } from "../simulation/actor";

export const ARC_ACTOR_DEFINITIONS = [
  {
    id: "arc-trooper",
    behaviorId: "terrain-move",
    movement: { speed: 4, profileId: "surface-ground", radius: 0.3 },
    materialsCost: 25,
    trainingSeconds: 4,
  },
  {
    id: "arc-scout",
    behaviorId: "terrain-move",
    movement: { speed: 7, profileId: "surface-ground", radius: 0.28 },
    materialsCost: 20,
    trainingSeconds: 3,
  },
  {
    id: "arc-command-center-prototype",
    materialsCost: 300,
    constructionSeconds: 12,
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
    materialsCost: 100,
    constructionSeconds: 8,
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
  {
    id: "arc-materials-refinery",
    behaviorId: "idle",
    materialsCost: 100,
    constructionSeconds: 8,
    refinery: { harvesterDefinitionId: "arc-harvester" },
    production: { unitDefinitionIds: ["arc-harvester"] },
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
  {
    id: "arc-harvester",
    behaviorId: "terrain-move",
    materialsCost: 50,
    trainingSeconds: 6,
    movement: { speed: 3, profileId: "surface-ground", radius: 0.4 },
    harvesting: { capacity: 100, loadSeconds: 60, patchRadius: 2 },
  },
] satisfies readonly ActorDefinition[];
