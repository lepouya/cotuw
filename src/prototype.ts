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
  createActorViewRegistry,
  createMeshAppearance,
  createTerrainMeshes,
} from "./render";
import { createActor } from "./simulation/actor";
import { loadSkinnedActorAppearance } from "./render/skinned-actor-appearance";
import { startSimulationLoop } from "./simulation/loop";
import {
  createMissionSimulation,
  createMissionState,
} from "./simulation/mission";

import type { Scene } from "@babylonjs/core";
import type { TileLayer, TileType } from "./map";
import type { ActorAppearance, GameView, GameViewOptions } from "./render";
import type { Actor, ActorBehavior, ActorDefinition } from "./simulation/actor";

const TILE_COUNT = 100;
const TILE_SIZE = 1;
/** Tiles from the river's midline to its bank. */
const WATER_HALF_WIDTH = 5;
/** Water opacity at the midline and at the last tile before the bank. */
const WATER_DEEP_ALPHA = 0.98;
const WATER_SHORE_ALPHA = 0.06;
/** Ripple opacity, as a fraction of the water beneath it. */
const WATER_RIPPLE_ALPHA = 0.3;
const SIMULATION_TICK_SECONDS = 1 / 60;
const SIMULATION_PUMP_MILLISECONDS = 4;
/** Covers background-tab throttling to one timer callback per second. */
const MAX_CATCH_UP_SECONDS = 5;

/** Unobstructed straight-line motion, until path finding replaces it. */
export const directMoveBehavior: ActorBehavior = {
  handleCommand: (actor, definition, command) => {
    switch (command.kind) {
      case "move":
        if (!definition.movement) {
          return false;
        }
        actor.movement = { target: { ...command.target } };
        return true;
      case "stop":
        delete actor.movement;
        return true;
    }
  },
  update: (actor, definition, seconds) => {
    const target = actor.movement?.target;
    if (!target || !definition.movement) {
      return;
    }

    const xDistance = target.x - actor.worldPosition.x;
    const zDistance = target.z - actor.worldPosition.z;
    const distance = Math.hypot(xDistance, zDistance);
    if (distance === 0) {
      delete actor.movement;
      return;
    }

    actor.facing = Math.atan2(xDistance, zDistance);
    const travel = Math.min(definition.movement.speed * seconds, distance);
    actor.worldPosition.x += (xDistance / distance) * travel;
    actor.worldPosition.z += (zDistance / distance) * travel;

    if (travel === distance) {
      actor.worldPosition = { ...target };
      delete actor.movement;
    }
  },
};

export const PROTOTYPE_ACTOR_BEHAVIORS: ReadonlyMap<string, ActorBehavior> =
  new Map([["direct-move", directMoveBehavior]]);

export const PROTOTYPE_ACTOR_DEFINITIONS = [
  {
    id: "arc-trooper",
    behaviorId: "direct-move",
    movement: { speed: 4 },
    graphics: {
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
  },
  {
    id: "arc-scout",
    behaviorId: "direct-move",
    movement: { speed: 7 },
    graphics: {
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
  },
] satisfies readonly ActorDefinition[];

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
): Promise<GameView> {
  const map = createPrototypeMap();
  const view = createGameView(canvas, map, PROTOTYPE_VIEW_OPTIONS);

  createTerrainMeshes(view.scene, map);
  const simulation = createMissionSimulation({
    state: createMissionState(createPrototypeActors(map)),
    behaviorRegistry: PROTOTYPE_ACTOR_BEHAVIORS,
    bounds: map.worldBounds,
    definitions: PROTOTYPE_ACTOR_DEFINITIONS,
    tickSeconds: SIMULATION_TICK_SECONDS,
  });
  const appearances = createPrototypeStandInAppearances(view.scene);
  const actorViews = createActorViewRegistry(view.scene, map, appearances);
  actorViews.update(simulation.actors, 1);
  const input = createCommandInput(canvas, view.scene, {
    actorIdForMesh: actorViews.actorIdForMesh,
    submitCommand: simulation.submitCommand,
    onSelectionChanged: (actorId) => {
      actorViews.setSelectedActor(actorId);
      minimap.refreshActors();
      canvas.dataset.actorSelected = String(actorId !== undefined);
      canvas.dataset.selectedActor = actorId ?? "";
    },
  });
  const minimap = createMinimap(view.scene, map, view.camera, minimapCanvas, {
    actors: () =>
      simulation.actors.map((actor) => ({
        id: actor.id,
        worldPosition: actor.worldPosition,
        color: appearances.get(actor.definitionId)?.minimapColor,
        selected: actor.id === input.selectedActorId,
      })),
  });
  input.select(undefined);
  let knownActorVersion = simulation.actorVersion;

  const loop = startSimulationLoop(simulation, {
    pumpMilliseconds: SIMULATION_PUMP_MILLISECONDS,
    maxCatchUpSeconds: MAX_CATCH_UP_SECONDS,
    beforeTick: () => actorViews.capturePreviousPoses(simulation.actors),
    onFault: () => {
      canvas.dataset.simulationFault = "true";
    },
    afterTick: (outcomes) => {
      minimap.refreshActors();
      for (const { command, accepted } of outcomes) {
        if (accepted && command.kind === "move") {
          canvas.dataset.actorTarget = `${command.target.x},${command.target.z}`;
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
      minimap.refreshActors();
    }
    actorViews.update(simulation.actors, loop.tickProgress());
  });
  view.scene.onDisposeObservable.add(() => {
    loop.stop();
    input.dispose();
    view.scene.onBeforeRenderObservable.remove(renderObserver);
    actorViews.dispose();
    for (const appearance of appearances.values()) appearance.dispose();
  });

  view.scene.onAfterRenderObservable.addOnce(() => {
    canvas.dataset.terrainReady = "true";
    canvas.dataset.actorReady = "true";
  });

  await Promise.all(
    PROTOTYPE_ACTOR_DEFINITIONS.map(async ({ id, graphics }) => {
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
      actorViews.update(simulation.actors, loop.tickProgress());
      previous?.dispose();
    }),
  );
  return view;
}

function createPrototypeStandInAppearances(
  scene: Scene,
): Map<string, ActorAppearance> {
  return new Map(
    PROTOTYPE_ACTOR_DEFINITIONS.map(({ id, graphics }) => {
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
      material.diffuseColor = new Color3(...graphics.minimapColor);
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
  const positionAt = (x: number, z: number) => {
    const point = map.worldPoint(x, z, 0);
    return { x: point.x, z: point.z };
  };

  return [
    createActor({
      id: "prototype-trooper",
      definitionId: "arc-trooper",
      worldPosition: positionAt(46, 40),
    }),
    createActor({
      id: "prototype-scout",
      definitionId: "arc-scout",
      worldPosition: positionAt(55, 45),
    }),
  ];
}

export function createPrototypeMap(): TerrainMap {
  const mapCenter = TILE_COUNT / 2;
  return new TerrainMap({
    width: TILE_COUNT,
    height: TILE_COUNT,
    tileSize: TILE_SIZE,
    createHeight: (x, z) => {
      const distanceFromCenter = Math.hypot(x - mapCenter, z - mapCenter);
      const ridge = Math.max(0, 1 - distanceFromCenter / 55) * 2.8;
      const rolling = Math.sin(x * 0.16) * 0.65 + Math.cos(z * 0.13) * 0.55;
      const detail = Math.sin((x + z) * 0.37) * 0.2;

      return ridge + rolling + detail;
    },
    createLayers: (x, z) => {
      const variation = Math.sin(x * 0.23) * 0.025 + Math.cos(z * 0.19) * 0.02;
      const waterCenter = 52 + Math.sin(x * 0.08) * 8;
      const depth = 1 - Math.abs(z + 0.5 - waterCenter) / WATER_HALF_WIDTH;
      const layers: TileLayer[] = [
        {
          type: PROTOTYPE_TILE_TYPES.dirt,
          color: new Color4(
            0.86 + variation,
            0.9 + variation,
            0.88 + variation,
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

      if (Math.sin(x * 0.47 - z * 0.29) > 0.78) {
        layers.push({
          type: PROTOTYPE_TILE_TYPES.clutter,
          color: new Color4(0.99, 0.66, 0.33, 1),
        });
      }

      return layers;
    },
  });
}

/**
 * Fades the river towards its banks so its edge reads as a shoreline.
 *
 * @param depth 0 at the bank, 1 at the midline.
 */
function waterAlpha(depth: number): number {
  const eased = depth * depth * (3 - 2 * depth);
  return WATER_SHORE_ALPHA + (WATER_DEEP_ALPHA - WATER_SHORE_ALPHA) * eased;
}
