// Throwaway prototype code: a sample map and the scene that shows it.
// Replace this with real game setup once the prototype has served its purpose.
import {
  Color3,
  Color4,
  MeshBuilder,
  StandardMaterial,
  Vector3,
} from "@babylonjs/core";

import { TerrainMap } from "./map";
import {
  createCommandInput,
  createGameView,
  createMinimap,
  createMovementPathView,
  createActorViewRegistry,
  createTilePlacedActorViewRegistry,
  createMeshAppearance,
  createTerrainMeshes,
  DEFAULT_ACTOR_COLOR,
} from "./render";
import { createActor } from "./simulation/actor";
import { OccupancyGrid } from "./simulation/occupancy";
import {
  createTilePlacedActor,
  isTilePlacedActor,
  occupiedTilesFor,
} from "./simulation/placement";
import {
  loadSkinnedActorAppearance,
  validateActorGraphics,
} from "./render/skinned-actor-appearance";
import { startSimulationLoop } from "./simulation/loop";
import { createTerrainMoveBehavior } from "./simulation/terrain-movement";
import {
  createMissionSimulation,
  createMissionState,
} from "./simulation/mission";

import type { Scene } from "@babylonjs/core";
import type { TileLayer, TileType } from "./map";
import type { ActorAppearance, GameView, GameViewOptions } from "./render";
import type {
  Actor,
  ActorDefinition,
  ActorRenderState,
} from "./simulation/actor";
import type { MovementProfile } from "./simulation/navigation";
import type { ActorGraphics } from "./render/skinned-actor-appearance";
import type { TilePlacedActorAppearance } from "./render";
import type { ActorPlacement } from "./simulation/placement";

const TILE_COUNT = 100;
const TILE_SIZE = 1;
/** Tiles from the pond's midline to its bank. */
const WATER_HALF_WIDTH = 10;
const WATER_CENTER = { x: 42, z: 58 };
/** Water opacity at the midline and at the last tile before the bank. */
const WATER_DEEP_ALPHA = 0.98;
const WATER_SHORE_ALPHA = 0.06;
/** Ripple opacity, as a fraction of the water beneath it. */
const WATER_RIPPLE_ALPHA = 0.3;
const SIMULATION_TICK_SECONDS = 1 / 60;
const SIMULATION_PUMP_MILLISECONDS = 4;
/** Covers background-tab throttling to one timer callback per second. */
const MAX_CATCH_UP_SECONDS = 5;
const PROTOTYPE_BLOCKER_ORIGIN = { x: 49, z: 39 };

export type TerrainPrototypeControls = {
  blockerToggle?: HTMLButtonElement;
};

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
] satisfies readonly ActorDefinition[];

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
      height: 2.4,
      color: [0.28, 0.38, 0.42],
      minimapColor: [0.36, 0.7, 0.76],
    },
  ],
]);

/**
 * Water, ripples and clutter are each optional, so every type pins its slot.
 * Minimap colors are each image's mean color and coverage.
 */
export const PROTOTYPE_TILE_TYPES = {
  dirt: {
    id: "dirt",
    slot: 0,
    graphics: {
      url: "/assets/terrain/dirt.png",
      hasAlpha: false,
      minimapColor: [0.472, 0.339, 0.217, 1],
    },
  },
  water: {
    id: "water",
    slot: 1,
    featherEdges: true,
    graphics: {
      url: "/assets/terrain/water.png",
      hasAlpha: true,
      // The image's own alpha caps even the deepest water at about two thirds
      // opaque, so the tile layer owns transparency and can fade to a shore.
      layerAlphaOnly: true,
      scrollSpeed: { u: 0.025, v: 0.012 },
      minimapColor: [0.189, 0.497, 0.557, 1],
    },
  },
  waterRipples: {
    id: "water-ripples",
    slot: 2,
    featherEdges: true,
    graphics: {
      url: "/assets/terrain/water.png",
      hasAlpha: true,
      scale: { u: 1.37, v: 1.37 },
      scrollSpeed: { u: -0.018, v: 0.032 },
      minimapColor: [0.189, 0.497, 0.557, 0.65],
    },
  },
  clutter: {
    id: "clutter",
    slot: 3,
    graphics: {
      url: "/assets/terrain/clutter.png",
      hasAlpha: true,
      minimapColor: [0.409, 0.373, 0.341, 0.05],
    },
  },
} satisfies Record<string, TileType>;

export const PROTOTYPE_VIEW_OPTIONS = {
  clearColor: new Color3(0.035, 0.07, 0.09),
  lighting: {
    skyColor: new Color3(0.6, 0.78, 0.77),
    groundColor: new Color3(0.08, 0.12, 0.1),
    sunColor: Color3.White(),
    sunDirection: new Vector3(-0.5, -1, 0.35),
    skyIntensity: 1.05,
    sunIntensity: 1.3,
  },
} satisfies GameViewOptions;

export async function createTerrainPrototype(
  canvas: HTMLCanvasElement,
  minimapCanvas: HTMLCanvasElement,
  { blockerToggle }: TerrainPrototypeControls = {},
): Promise<GameView> {
  const map = createPrototypeMap();
  const view = createGameView(canvas, map, PROTOTYPE_VIEW_OPTIONS);

  createTerrainMeshes(view.scene, map);
  const occupancy = new OccupancyGrid(map);
  const simulation = createMissionSimulation({
    state: createMissionState(createPrototypeActors(map)),
    behaviorRegistry: new Map([
      [
        "terrain-move",
        createTerrainMoveBehavior(map, occupancy, PROTOTYPE_MOVEMENT_PROFILES),
      ],
      ["idle", { handleCommand: () => false, update: () => {} }],
    ]),
    bounds: map.worldBounds,
    definitions: PROTOTYPE_ACTOR_DEFINITIONS,
    tickSeconds: SIMULATION_TICK_SECONDS,
    map,
    occupancy,
  });
  const appearances = createPrototypeStandInAppearances(view.scene);
  const actorViews = createActorViewRegistry(view.scene, map, appearances);
  const tilePlacedViews = createTilePlacedActorViewRegistry(
    view.scene,
    map,
    PROTOTYPE_ACTOR_DEFINITIONS,
    PROTOTYPE_TILE_PLACED_APPEARANCES,
  );
  const movementPath = createMovementPathView(view.scene, map);
  const partition = (actors: readonly ActorRenderState[]) => ({
    actors,
    mobile: actors.filter((actor) => !isTilePlacedActor(actor)),
    placed: actors.filter(isTilePlacedActor),
  });
  // Split once per committed tick; the simulation replaces its array each tick.
  let partitioned = partition(simulation.actors);
  const actorsByKind = () => {
    if (partitioned.actors !== simulation.actors) {
      partitioned = partition(simulation.actors);
    }
    return partitioned;
  };
  const definitionsById = new Map(
    PROTOTYPE_ACTOR_DEFINITIONS.map((definition) => [
      definition.id,
      definition,
    ]),
  );
  actorViews.update(actorsByKind().mobile, 1);
  tilePlacedViews.update(actorsByKind().placed);
  let simulationFaulted = false;
  const input = createCommandInput(canvas, view.scene, {
    actorIdForMesh: actorViews.actorIdForMesh,
    submitCommand: (command) => {
      if (!simulationFaulted) simulation.submitCommand(command);
    },
    onSelectionChanged: (actorId) => {
      actorViews.setSelectedActor(actorId);
      movementPath.setSelectedActor(actorId);
      minimap.refreshActors();
      canvas.dataset.actorSelected = String(actorId !== undefined);
      canvas.dataset.selectedActor = actorId ?? "";
    },
  });
  const minimap = createMinimap(view.scene, map, view.camera, minimapCanvas, {
    // Structures first, so unit markers draw over them.
    actors: () => [
      ...actorsByKind().placed.map((actor) => ({
        id: actor.id,
        worldPosition: actor.worldPosition,
        tiles: occupiedTilesFor(
          actor,
          definitionsById.get(actor.definitionId)!,
        ),
        color: PROTOTYPE_TILE_PLACED_APPEARANCES.get(actor.definitionId)
          ?.minimapColor,
      })),
      ...actorsByKind().mobile.map((actor) => ({
        id: actor.id,
        worldPosition: actor.worldPosition,
        color: appearances.get(actor.definitionId)?.minimapColor,
        selected: actor.id === input.selectedActorId,
      })),
    ],
  });
  input.select(undefined);
  let nextBlockerId = 1;
  let activeBlockerId = "prototype-command-center-0";
  let blockerCommandPending = false;
  const updateBlockerToggle = () => {
    if (!blockerToggle) {
      return;
    }
    blockerToggle.textContent =
      simulation.actorById(activeBlockerId) !== undefined
        ? "Remove 2×2 blocker"
        : "Place 2×2 blocker";
    blockerToggle.disabled = blockerCommandPending || simulationFaulted;
  };
  const toggleBlocker = () => {
    if (blockerCommandPending || simulationFaulted) {
      return;
    }
    blockerCommandPending = true;
    const current = simulation.actorById(activeBlockerId);
    if (current) {
      simulation.submitCommand({
        kind: "remove-actor",
        actorId: current.id,
      });
    } else {
      activeBlockerId = `prototype-command-center-${nextBlockerId++}`;
      simulation.submitCommand({
        kind: "place-actor",
        ...blockerPlacement(activeBlockerId),
      });
    }
    updateBlockerToggle();
  };
  blockerToggle?.addEventListener("click", toggleBlocker);
  updateBlockerToggle();
  let knownActorVersion = simulation.actorVersion;

  const loop = startSimulationLoop(simulation, {
    pumpMilliseconds: SIMULATION_PUMP_MILLISECONDS,
    maxCatchUpSeconds: MAX_CATCH_UP_SECONDS,
    beforeTick: () => actorViews.capturePreviousPoses(actorsByKind().mobile),
    onFault: () => {
      simulationFaulted = true;
      blockerCommandPending = false;
      updateBlockerToggle();
      canvas.dataset.simulationFault = "true";
    },
    afterTick: (outcomes) => {
      minimap.refreshActors();
      for (const { command, accepted } of outcomes) {
        if (command.kind === "move") {
          canvas.dataset.moveStatus = accepted ? "accepted" : "unreachable";
          if (!accepted) {
            movementPath.showRejectedTarget(command.actorId, command.target);
          }
        }
        if (accepted && command.kind === "move") {
          canvas.dataset.actorTarget = `${command.target.x},${command.target.z}`;
        }
        if (command.kind === "place-actor" || command.kind === "remove-actor") {
          blockerCommandPending = false;
          canvas.dataset.tilePlacedActorCommand = accepted
            ? "accepted"
            : "rejected";
          updateBlockerToggle();
        }
      }
    },
  });
  const renderObserver = view.scene.onBeforeRenderObservable.add(() => {
    loop.advance();
    if (simulation.actorVersion !== knownActorVersion) {
      knownActorVersion = simulation.actorVersion;
      if (
        input.selectedActorId &&
        !simulation.actorById(input.selectedActorId)
      ) {
        input.select(undefined);
      }
      const { placed } = actorsByKind();
      tilePlacedViews.update(placed);
      canvas.dataset.tilePlacedActorCount = String(placed.length);
      updateBlockerToggle();
      minimap.refreshActors();
    }
    const { mobile } = actorsByKind();
    actorViews.update(mobile, loop.tickProgress());
    movementPath.update(mobile);
  });
  view.scene.onDisposeObservable.add(() => {
    loop.stop();
    simulation.dispose();
    input.dispose();
    blockerToggle?.removeEventListener("click", toggleBlocker);
    view.scene.onBeforeRenderObservable.remove(renderObserver);
    actorViews.dispose();
    tilePlacedViews.dispose();
    movementPath.dispose();
    for (const appearance of appearances.values()) appearance.dispose();
  });

  view.scene.onAfterRenderObservable.addOnce(() => {
    canvas.dataset.terrainReady = "true";
    canvas.dataset.actorReady = "true";
    canvas.dataset.tilePlacedActorReady = "true";
    canvas.dataset.tilePlacedActorCount = String(actorsByKind().placed.length);
  });

  await Promise.all(
    [...PROTOTYPE_ACTOR_GRAPHICS].map(async ([id, graphics]) => {
      let appearance: ActorAppearance;
      try {
        appearance = await loadSkinnedActorAppearance(view.scene, graphics);
      } catch (error) {
        console.error(`Actor ${id} uses a stand-in model.`, error);
        return;
      }
      if (view.scene.isDisposed) {
        appearance.dispose();
        return;
      }
      const previous = appearances.get(id);
      appearances.set(id, appearance);
      actorViews.update(actorsByKind().mobile, loop.tickProgress());
      previous?.dispose();
    }),
  );
  return view;
}

function createPrototypeStandInAppearances(
  scene: Scene,
): Map<string, ActorAppearance> {
  return new Map(
    [...PROTOTYPE_ACTOR_GRAPHICS].map(([id, graphics]) => {
      validateActorGraphics(graphics);
      const { radius, height } = graphics.bounds;
      const mesh = MeshBuilder.CreateBox(
        `actor-template-${id}`,
        { width: radius * 1.4, height, depth: radius * 1.4 },
        scene,
      );
      mesh.position.y = height / 2;
      const material = new StandardMaterial(
        `actor-template-${id}-material`,
        scene,
      );
      material.diffuseColor = new Color3(
        ...(graphics.minimapColor ?? DEFAULT_ACTOR_COLOR),
      );
      material.specularColor = new Color3(0.12, 0.12, 0.12);
      mesh.material = material;
      return [
        id,
        createMeshAppearance(mesh, graphics.bounds, graphics.minimapColor),
      ];
    }),
  );
}

function createPrototypeActors(map: TerrainMap): Actor[] {
  return [
    createActor({
      id: "prototype-trooper",
      definitionId: "arc-trooper",
      worldPosition: map.tileCenter(46, 40),
    }),
    createActor({
      id: "prototype-scout",
      definitionId: "arc-scout",
      worldPosition: map.tileCenter(55, 45),
    }),
    createPrototypeBlocker(map, "prototype-command-center-0"),
  ];
}

function blockerPlacement(actorId: string): ActorPlacement {
  return {
    actorId,
    definitionId: "arc-command-center-prototype",
    origin: { ...PROTOTYPE_BLOCKER_ORIGIN },
  };
}

function createPrototypeBlocker(map: TerrainMap, actorId: string): Actor {
  const placement = blockerPlacement(actorId);
  const definition = PROTOTYPE_ACTOR_DEFINITIONS.find(
    ({ id }) => id === placement.definitionId,
  )!;
  return createTilePlacedActor(map, definition, placement);
}

export function createPrototypeMap(): TerrainMap {
  return new TerrainMap({
    width: TILE_COUNT,
    height: TILE_COUNT,
    tileSize: TILE_SIZE,
    createHeight: prototypeHeightAt,
    createTerrain: prototypeTerrainAt,
    terrainTypeIds: ["plain", "path", "rough", "water"],
    createLayers: (x, z) => {
      const terrain = prototypeTerrainAt(x, z);
      const variation = Math.sin(x * 0.23) * 0.025 + Math.cos(z * 0.19) * 0.02;
      const depth =
        1 -
        Math.hypot(x + 0.5 - WATER_CENTER.x, z + 0.5 - WATER_CENTER.z) /
          WATER_HALF_WIDTH;
      const terrainTint =
        terrain.typeId === "path"
          ? [1.08, 0.98, 0.78]
          : terrain.typeId === "rough"
            ? [0.68, 0.78, 0.64]
            : [0.86, 0.9, 0.88];
      const layers: TileLayer[] = [
        {
          type: PROTOTYPE_TILE_TYPES.dirt,
          color: new Color4(
            terrainTint[0] + variation,
            terrainTint[1] + variation,
            terrainTint[2] + variation,
            1,
          ),
        },
      ];

      if (depth > 0) {
        const alpha = waterAlpha(depth);
        layers.push({
          type: PROTOTYPE_TILE_TYPES.water,
          color: new Color4(0.74, 0.94, 0.98, alpha),
        });
        layers.push({
          type: PROTOTYPE_TILE_TYPES.waterRipples,
          color: new Color4(0.82, 0.98, 1, alpha * WATER_RIPPLE_ALPHA),
        });
      }

      if (terrain.typeId === "rough" || Math.sin(x * 0.47 - z * 0.29) > 0.82) {
        layers.push({
          type: PROTOTYPE_TILE_TYPES.clutter,
          color: new Color4(0.99, 0.66, 0.33, 1),
        });
      }

      return layers;
    },
  });
}

/** Authored semantics stay independent of Babylon terrain layers. */
function prototypeTerrainAt(x: number, z: number) {
  const border = x < 3 || z < 3 || x >= TILE_COUNT - 3 || z >= TILE_COUNT - 3;
  const pond =
    Math.hypot(x + 0.5 - WATER_CENTER.x, z + 0.5 - WATER_CENTER.z) <
    WATER_HALF_WIDTH;
  const path =
    (z >= 31 && z <= 34 && x >= 8 && x <= 91) ||
    (z >= 67 && z <= 70 && x >= 20 && x <= 91) ||
    (x >= 82 && x <= 85 && z >= 32 && z <= 69);
  const rough = x >= 40 && x <= 57 && z >= 45 && z <= 61;

  return {
    typeId: pond ? "water" : path ? "path" : rough ? "rough" : "plain",
    outOfBounds: border || undefined,
  };
}

/** A gentle hill plus a high ridge with two deliberately legible crossings. */
function prototypeHeightAt(x: number, z: number): number {
  const hillDistance = Math.hypot(x - 39, z - 47);
  const hill = Math.max(0, 1 - hillDistance / 18) ** 2 * 3.5;
  const inRidge = x >= 61 && x <= 65 && z >= 12 && z <= 88;
  const inCrossing = (z >= 30 && z <= 36) || (z >= 66 && z <= 72);
  const ridge = inRidge && !inCrossing ? 6 : 0;
  const rolling = Math.sin(x * 0.13) * 0.08 + Math.cos(z * 0.11) * 0.07;
  return hill + ridge + rolling;
}

/**
 * Fades the pond towards its banks so its edge reads as a shoreline.
 *
 * @param depth 0 at the bank, 1 at the midline.
 */
function waterAlpha(depth: number): number {
  const eased = depth * depth * (3 - 2 * depth);
  return WATER_SHORE_ALPHA + (WATER_DEEP_ALPHA - WATER_SHORE_ALPHA) * eased;
}
